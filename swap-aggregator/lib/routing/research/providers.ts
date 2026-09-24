import { NATIVE, assetKey, proportionalUsdCeil, rawAmount, sumUsd, validateAsset, validDecimal } from "./amounts.ts";
import { list, object, text } from "./http.ts";
import type { JsonHttp } from "./http.ts";
import type { Asset, GasEstimate, Quote, QuoteFee, QuoteProvider, QuoteRequest } from "./types.ts";

export interface ProviderOptions {
  lifiApiKey?: string;
  relayApiKey?: string;
  /** A controlled benchmark assumption, never inferred from a quote. */
  assumePreapproved?: boolean;
  quoteTtlMs?: number;
}

export function readAsset(value: unknown): Asset {
  const token = object(value);
  const asset = { chainId: token.chainId as number, address: text(token.address), decimals: token.decimals as number,
    ...(typeof token.symbol === "string" ? { symbol: token.symbol } : {}) };
  validateAsset(asset);
  return asset;
}

function assertAsset(actual: Asset, expected: Asset): void {
  if (assetKey(actual) !== assetKey(expected) || actual.decimals !== expected.decimals) throw new Error("Provider returned a different token or decimals");
}

function optionalRaw(value: unknown): string | null {
  try { return rawAmount(value as string, true).toString(); } catch { return null; }
}

function feeDescription(value: unknown): QuoteFee {
  const fee = object(value);
  let token: Asset | undefined;
  try { token = readAsset(fee.token ?? fee.currency); validateAsset(token); } catch { token = undefined; }
  const split = fee.feeSplit && typeof fee.feeSplit === "object" ? object(fee.feeSplit) : {};
  const recipients = Array.isArray(split.recipients) ? split.recipients.flatMap((r) => {
    const recipient = object(r);
    const amountRaw = optionalRaw(recipient.fee);
    return typeof recipient.name === "string" && amountRaw !== null ? [{ name: recipient.name, amountRaw }] : [];
  }) : [];
  return { name: typeof fee.name === "string" ? fee.name : "Provider fee", token,
    amountRaw: optionalRaw(fee.amount), amountUsd: validDecimal(fee.amountUSD ?? fee.amountUsd) ? (fee.amountUSD ?? fee.amountUsd) as string : null,
    included: typeof fee.included === "boolean" ? fee.included : null, recipients };
}

function base(provider: string, req: QuoteRequest, startedAt: number, opts: ProviderOptions): Omit<Quote, "id" | "amountOut" | "minimumOut" | "externalCostUsd" | "missingCosts" | "durationSeconds"> {
  return { provider, from: req.from, to: req.to, amountIn: req.amount, quotedAt: startedAt,
    expiresAt: startedAt + (opts.quoteTtlMs ?? 60000),
    warnings: opts.assumePreapproved ? ["Benchmark assumes sufficient existing allowances for every leg; not checked on chain."] : [] };
}

export function normalizeLifi(body: unknown, req: QuoteRequest, startedAt: number, opts: ProviderOptions = {}): Quote[] {
  return list(object(body).routes).map((item) => {
    const route = object(item);
    assertAsset(readAsset(route.fromToken), req.from);
    assertAsset(readAsset(route.toToken), req.to);
    if (rawAmount(text(route.fromAmount)) !== rawAmount(req.amount) || route.fromChainId !== req.from.chainId || route.toChainId !== req.to.chainId) {
      throw new Error("LI.FI response does not match exact input or chain ids");
    }
    const costs: string[] = [];
    const fees: QuoteFee[] = [];
    const missing: string[] = [];
    let duration = 0;
    let durationKnown = true;
    let gasKnown = true;
    const steps = list(route.steps);
    if (!steps.length) throw new Error("LI.FI route has no steps");
    for (const value of steps) {
      const step = object(value);
      const estimate = object(step.estimate);
      // Top-level step estimates already aggregate includedSteps: never sum both.
      if (!Array.isArray(estimate.gasCosts) || !estimate.gasCosts.length) gasKnown = false;
      else for (const g of estimate.gasCosts) {
        const gas = object(g);
        if (gas.type !== "SEND" || !validDecimal(gas.amountUSD)) gasKnown = false;
        else costs.push(gas.amountUSD);
      }
      if (!Array.isArray(estimate.feeCosts)) missing.push("LI.FI external fee coverage unavailable");
      else for (const f of estimate.feeCosts) {
        const fee = object(f);
        fees.push(feeDescription(fee));
        if (fee.included === true) continue;
        if (fee.included === false && validDecimal(fee.amountUSD)) costs.push(fee.amountUSD);
        else missing.push("LI.FI fee inclusion or USD valuation unknown");
      }
      const action = object(step.action);
      const source = readAsset(action.fromToken);
      if (source.address.toLowerCase() !== NATIVE && !opts.assumePreapproved) missing.push("ERC-20 approval gas not measured");
      if (typeof estimate.executionDuration === "number" && estimate.executionDuration >= 0) duration += estimate.executionDuration;
      else durationKnown = false;
    }
    if (!gasKnown) missing.push("LI.FI source execution gas unavailable");
    return { ...base("lifi", req, startedAt, opts), id: text(route.id), amountOut: text(route.toAmount),
      minimumOut: typeof route.toAmountMin === "string" ? route.toAmountMin : null,
      fees, gasAccounting: "provider_summary",
      externalCostUsd: gasKnown ? sumUsd(costs) : null, missingCosts: [...new Set(missing)], durationSeconds: durationKnown ? duration : null };
  });
}

export function normalizeRelay(body: unknown, req: QuoteRequest, startedAt: number, opts: ProviderOptions = {}): Quote[] {
  const data = object(body);
  const details = object(data.details);
  const input = object(details.currencyIn);
  const output = object(details.currencyOut);
  assertAsset(readAsset(input.currency), req.from);
  assertAsset(readAsset(output.currency), req.to);
  if (rawAmount(text(input.amount)) !== rawAmount(req.amount)) throw new Error("Relay exact input mismatch");
  const fees = object(data.fees);
  const gas = fees.gas ? object(fees.gas) : {};
  const gasToken = gas.currency ? object(gas.currency) : {};
  const recognizedGas = gasToken.chainId === req.from.chainId &&
    typeof gasToken.address === "string" && gasToken.address.toLowerCase() === NATIVE && validDecimal(gas.amountUsd);
  const missing: string[] = [];
  if (!recognizedGas) missing.push("Relay source gas could not be identified as external native-token gas");
  const steps = list(data.steps);
  if (!steps.length) throw new Error("Relay returned no execution steps");
  const estimates: GasEstimate[] = [];
  const spenders = new Set<string>();
  for (const value of steps) {
    const step = object(value);
    if (step.kind !== "transaction" || step.id === "approve" || !Array.isArray(step.items)) continue;
    for (const value of step.items) {
      const item = object(value);
      if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) continue;
      const tx = object(item.data);
      if (tx.chainId === req.from.chainId && typeof tx.to === "string") spenders.add(tx.to.toLowerCase());
    }
  }
  let complete = recognizedGas;
  let approvalCovered = false;
  const reference = optionalRaw(gas.amount);
  const positiveUsd = recognizedGas && /[1-9]/.test(text(gas.amountUsd));
  for (const value of steps) {
    const step = object(value);
    if (step.kind === "signature") continue;
    if (step.kind !== "transaction" || !Array.isArray(step.items) || !step.items.length) { complete = false; continue; }
    for (const value of step.items) {
      const item = object(value);
      if (item.status === "complete") continue;
      if (step.id === "approve" && opts.assumePreapproved) continue;
      try {
        const tx = object(item.data);
        if (tx.chainId !== req.from.chainId || !recognizedGas || !positiveUsd || reference === null || BigInt(reference) === BigInt(0)) {
          throw new Error("No native gas valuation for this transaction chain");
        }
        const units = rawAmount(tx.gas as string);
        const cap = tx.maxFeePerGas !== undefined;
        const price = rawAmount((cap ? tx.maxFeePerGas : tx.gasPrice) as string);
        const amount = units * price;
        estimates.push({ step: typeof step.id === "string" ? step.id : "transaction", chainId: tx.chainId as number,
          gas: units.toString(), priceWei: price.toString(), basis: cap ? "gas_times_max_fee" : "gas_times_gas_price",
          amountRaw: amount.toString(), amountUsd: proportionalUsdCeil(text(gas.amountUsd), amount, BigInt(reference)) });
        // Recognize only an approval of the actual input token for a sufficient amount.
        const calldata = typeof tx.data === "string" ? tx.data : "";
        if (step.id === "approve" && typeof tx.to === "string" && tx.to.toLowerCase() === req.from.address.toLowerCase() &&
            typeof tx.from === "string" && tx.from.toLowerCase() === req.wallet.toLowerCase() &&
            /^0x095ea7b3[0-9a-f]{128}$/i.test(calldata) &&
            spenders.has(`0x${calldata.slice(34, 74)}`.toLowerCase()) &&
            BigInt(`0x${calldata.slice(74)}`) >= rawAmount(req.amount)) approvalCovered = true;
      } catch { complete = false; }
    }
  }
  // The fee summary is a valuation reference, never an additional charge on top of item estimates.
  const useTransactions = complete && estimates.length > 0;
  if (!useTransactions) missing.push("Relay transaction gas coverage unverified");
  if (req.from.address.toLowerCase() !== NATIVE && !opts.assumePreapproved && !(useTransactions && approvalCovered)) missing.push("ERC-20 approval gas not measured");
  const common = base("relay", req, startedAt, opts);
  const embeddedFees = ["relayer", "app"].flatMap((key) => fees[key] ? [feeDescription({ ...object(fees[key]),
    name: key === "relayer" ? "Relay relayer (API aggregate)" : "Relay app fee", included: true })] : []);
  return [{ ...common, id: typeof data.requestId === "string" ? data.requestId : `relay-${startedAt}-${req.amount}`,
    amountOut: text(output.amount), minimumOut: typeof output.minimumAmount === "string" ? output.minimumAmount : null,
    externalCostUsd: useTransactions ? sumUsd(estimates.map((e) => e.amountUsd)) : recognizedGas ? text(gas.amountUsd) : null,
    gasEstimates: useTransactions ? estimates : [], gasAccounting: useTransactions ? "transactions" : "provider_summary",
    fees: embeddedFees, missingCosts: missing,
    warnings: [...common.warnings, ...(useTransactions ? ["Gas estimated from API transaction gas and fee fields; USD conversion uses the rounded provider gas valuation. Hermes has not simulated execution."] : [])],
    durationSeconds: typeof details.timeEstimate === "number" && details.timeEstimate >= 0 ? details.timeEstimate : null }];
}

// Explicit API deployment paths, independent of the UI's curated network list.
const COW_NETWORKS: Record<number, string> = {
  1: "mainnet", 100: "xdai", 42161: "arbitrum_one", 8453: "base", 137: "polygon",
  43114: "avalanche", 59144: "linea", 56: "bnb", 9745: "plasma", 57073: "ink",
};

export function normalizeCow(body: unknown, req: QuoteRequest, startedAt: number, opts: ProviderOptions = {}): Quote[] {
  const data = object(body);
  const q = object(data.quote);
  if (text(q.sellToken).toLowerCase() !== req.from.address.toLowerCase() ||
      text(q.buyToken).toLowerCase() !== req.to.address.toLowerCase() || q.kind !== "sell" ||
      rawAmount(text(q.sellAmount)) + rawAmount(text(q.feeAmount), true) !== rawAmount(req.amount)) {
    throw new Error("CoW response does not match sellAmountBeforeFee or token identities");
  }
  const missing: string[] = [];
  if (!opts.assumePreapproved) missing.push("CoW vault-relayer approval gas not measured");
  if (data.verified !== true) missing.push("CoW quote simulation not verified");
  if (data.protocolFeeBps !== undefined && data.protocolFeeBps !== "0") missing.push("CoW additional protocol fee treatment requires verification");
  const common = base("cow", req, startedAt, opts);
  const expiration = Date.parse(text(data.expiration));
  return [{ ...common, id: `cow-${String(data.id ?? startedAt)}`, amountOut: text(q.buyAmount), minimumOut: null,
    expiresAt: Math.min(common.expiresAt, expiration), externalCostUsd: "0", missingCosts: missing, durationSeconds: null,
    warnings: [...common.warnings, "Solver settlement costs are reflected in the quote; fill and execution price are not guaranteed."] }];
}

export function createProviders(http: JsonHttp, opts: ProviderOptions = {}): QuoteProvider[] {
  return [
    { id: "lifi", supports: () => true, async quote(req, ctx) {
      const started = ctx.now();
      const body = await http("https://li.quest/v1/advanced/routes", {
        fromChainId: req.from.chainId, toChainId: req.to.chainId,
        fromTokenAddress: req.from.address, toTokenAddress: req.to.address,
        fromAmount: req.amount, fromAddress: req.wallet, toAddress: req.wallet,
        options: { integrator: "hermes-route-research", fee: 0, order: "CHEAPEST", allowSwitchChain: true, slippage: req.slippageBps / 10000 },
      }, opts.lifiApiKey ? { "x-lifi-api-key": opts.lifiApiKey } : {}, ctx.signal);
      return normalizeLifi(body, req, started, opts);
    } },
    { id: "relay", supports: () => true, async quote(req, ctx) {
      const started = ctx.now();
      const body = await http("https://api.relay.link/quote/v2", {
        user: req.wallet, recipient: req.wallet, originChainId: req.from.chainId, destinationChainId: req.to.chainId,
        originCurrency: req.from.address, destinationCurrency: req.to.address, amount: req.amount,
        tradeType: "EXACT_INPUT", slippageTolerance: String(req.slippageBps), appFees: [],
        topupGas: false, subsidizeFees: false, useDepositAddress: false,
      }, opts.relayApiKey ? { "x-api-key": opts.relayApiKey } : {}, ctx.signal);
      return normalizeRelay(body, req, started, opts);
    } },
    { id: "cow", supports: (from, to) => from.chainId === to.chainId && Boolean(COW_NETWORKS[from.chainId]) &&
        from.address.toLowerCase() !== NATIVE && to.address.toLowerCase() !== NATIVE,
      async quote(req, ctx) {
        const started = ctx.now();
        const body = await http(`https://api.cow.fi/${COW_NETWORKS[req.from.chainId]}/api/v1/quote`, {
          sellToken: req.from.address, buyToken: req.to.address, sellAmountBeforeFee: req.amount, kind: "sell",
          from: req.wallet, receiver: req.wallet, validFor: 300, signingScheme: "eip712", priceQuality: "verified",
        }, {}, ctx.signal);
        return normalizeCow(body, req, started, opts);
      } },
  ];
}

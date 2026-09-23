import { NATIVE, assetKey, rawAmount, sumUsd, validateAsset, validDecimal } from "./amounts.ts";
import { list, object, text } from "./http.ts";
import type { JsonHttp } from "./http.ts";
import type { Asset, Quote, QuoteProvider, QuoteRequest } from "./types.ts";

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
  if (req.from.address.toLowerCase() !== NATIVE && !opts.assumePreapproved) missing.push("ERC-20 approval gas not measured");
  const steps = list(data.steps);
  if (!steps.length) throw new Error("Relay returned no execution steps");
  // Even a native input can precede another user transaction: coverage must be explicit.
  if (steps.filter((s) => object(s).kind === "transaction").length > 1) missing.push("Relay additional transaction gas coverage unverified");
  return [{ ...base("relay", req, startedAt, opts), id: typeof data.requestId === "string" ? data.requestId : `relay-${startedAt}-${req.amount}`,
    amountOut: text(output.amount), minimumOut: typeof output.minimumAmount === "string" ? output.minimumAmount : null,
    externalCostUsd: recognizedGas ? text(gas.amountUsd) : null, missingCosts: missing,
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

import type { UpdateRouteHook } from "@lifi/sdk";
import { erc20Abi, type Address } from "viem";
import { getAccount, getBalance, readContract, switchChain } from "wagmi/actions";
import { walletConfig } from "../wallet";
import { isAppChainId } from "../chains";
import type { SwapParams } from "../aggregators/lifi/routes";
import { executeLifiRoute } from "../aggregators/lifi/execute";
import type { NormalizedRoute } from "../types/normalized-route";
import { canExecuteQuote, sourceGasAmount } from "./quote";
import { getTokenDetails } from "../tokens/client";
import type { AppToken } from "../tokens/types";
import { getCatalogToken } from "../tokens/catalog";
import { requiresTokenConfirmation, tokenKey, tokenVerification } from "../tokens/validation";
import { routeTokens } from "./details";
import { executeRangoRoute } from "../aggregators/rango/execute";
import type { RangoProgress } from "../aggregators/rango/types";

import { executeOneClickRoute, type OneClickExecutionOptions } from "../aggregators/oneclick/execute";
import { isObservedTokenFlagged, rememberTokenVerdicts } from "../tokens/verdicts";
import { canExecuteNewSwap } from "../release-mode";
import { buildIntentSeed, withIntentExecution } from "../intent/journal";

export class SwapValidationError extends Error {
  constructor(public readonly key: "quote_changed" | "insufficient_balance" | "insufficient_gas" | "token_blocked" | "token_metadata_changed" | "token_confirmation_required" | "tokens_unavailable") { super(key); }
}
export async function executeSwapQuote(route: NormalizedRoute, params: SwapParams, updateRouteHook: UpdateRouteHook, selection: { fromToken: AppToken; toToken: AppToken }, onRangoProgress?: (progress: RangoProgress) => void, oneClick?: OneClickExecutionOptions) {
  if (!canExecuteNewSwap()) throw new Error("execution_disabled");
  const check = () => {
    if (!canExecuteNewSwap()) throw new Error("execution_disabled");
    if (isObservedTokenFlagged(selection.fromToken) || isObservedTokenFlagged(selection.toToken)) throw new SwapValidationError("token_blocked");
    const account = getAccount(walletConfig);
    if (!account.isConnected || account.address?.toLowerCase() !== params.fromAddress.toLowerCase() || !canExecuteQuote(route, params)) {
      throw new SwapValidationError("quote_changed");
    }
  };
  check();
  const tokens = routeTokens(route);
  rememberTokenVerdicts([tokens.fromToken, tokens.toToken]);
  const pairs = [[selection.fromToken, tokens.fromToken], [selection.toToken, tokens.toToken]] as const;
  for (const [selected, quoted] of pairs) {
    if (tokenKey(selected) !== tokenKey(quoted) || selected.decimals !== quoted.decimals) throw new SwapValidationError("token_metadata_changed");
    const known = getCatalogToken(selected.chainId, selected.address);
    if (known && (known.decimals !== selected.decimals || known.symbol !== selected.symbol)) throw new SwapValidationError("token_metadata_changed");
    if (tokenVerification(selected) === "flagged" || tokenVerification(quoted) === "flagged") throw new SwapValidationError("token_blocked");
    if (requiresTokenConfirmation(selected) && !selected.riskAcknowledged) throw new SwapValidationError("token_confirmation_required");
  }
  // Pinned assets use local metadata. Only other contracts need a fresh API
  // check; a flagged verdict in either the selection or quote still blocks all.
  let latest: (AppToken | null)[];
  try { latest = await Promise.all(pairs.map(([token]) =>
    getCatalogToken(token.chainId, token.address) ?? getTokenDetails(token.chainId, token.address, { fresh: true })));
  }
  catch { throw new SwapValidationError("tokens_unavailable"); }
  latest.forEach((token, index) => {
    if (!token) throw new SwapValidationError("tokens_unavailable");
    const selected = pairs[index][0];
    if (tokenKey(token) !== tokenKey(selected) || token.decimals !== selected.decimals) throw new SwapValidationError("token_metadata_changed");
    rememberTokenVerdicts([token]);
    if (tokenVerification(token) === "flagged" || isObservedTokenFlagged(selected)) throw new SwapValidationError("token_blocked");
    if (requiresTokenConfirmation(token) && !selected.riskAcknowledged) throw new SwapValidationError("token_confirmation_required");
  });
  check();
  if (!isAppChainId(params.fromChainId)) throw new SwapValidationError("quote_changed");
  if (getAccount(walletConfig).chainId !== params.fromChainId) await switchChain(walletConfig, { chainId: params.fromChainId });
  check();
  const address = params.fromAddress as Address;
  const native = /^0x0{40}$/i.test(params.fromTokenAddress);
  const [gasBalance, tokenBalance] = await Promise.all([
    getBalance(walletConfig, { address, chainId: params.fromChainId }),
    native ? Promise.resolve(null) : readContract(walletConfig, { chainId: params.fromChainId, address: params.fromTokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  const amount = BigInt(params.fromAmount);
  if ((native ? gasBalance.value : tokenBalance!) < amount) throw new SwapValidationError("insufficient_balance");
  if (gasBalance.value < sourceGasAmount(route) + (native ? amount : BigInt(0)) || gasBalance.value === BigInt(0)) throw new SwapValidationError("insufficient_gas");
  check();
  if (getAccount(walletConfig).chainId !== params.fromChainId) throw new SwapValidationError("quote_changed");
  return withIntentExecution(buildIntentSeed(route, params), async (journal) => {
  if (route.provider === "oneclick") {
    if (!oneClick) throw new SwapValidationError("quote_changed");
    return executeOneClickRoute(route, params, () => { check(); if (getAccount(walletConfig).chainId !== params.fromChainId) throw new SwapValidationError("quote_changed"); }, oneClick, undefined, journal);
  }
  if (route.provider === "rango") return executeRangoRoute(route, params, () => {
    check();
    if (getAccount(walletConfig).chainId !== params.fromChainId) throw new SwapValidationError("quote_changed");
  }, onRangoProgress, undefined, journal);
  const completed = await executeLifiRoute(route.raw, { updateRouteHook: (updated) => {
    journal.saveProviderState(updated);
    updateRouteHook(updated);
  }, acceptExchangeRateUpdateHook: async () => false }, { check, journal });
  const evidence = completed.hermesDelivery;
  if (evidence?.state === "delivered") journal.setStatus("delivered", evidence);
  else if (evidence?.state === "alternative") journal.setStatus("alternative_output", evidence);
  else if (evidence?.state === "refund") journal.setStatus("refund_pending", evidence);
  else journal.setStatus("destination_pending", evidence ?? { reason: "destination_unverified" });
  return completed;
  });
}

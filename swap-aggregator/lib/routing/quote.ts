import type { SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute } from "../types/normalized-route";
import { validateRangoQuote } from "../aggregators/rango/validation";
import { routeFeesAreValid } from "./details";
import { assertLifiExecutionCapability } from "../aggregators/lifi/policy";

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
export function validQuoteOutput(amount: unknown, minimum: unknown): boolean {
  if (typeof amount !== "string" || typeof minimum !== "string" || !/^\d{1,78}$/.test(amount) || !/^\d{1,78}$/.test(minimum)) return false;
  const output = BigInt(amount); const min = BigInt(minimum);
  return min > BigInt(0) && min <= output && output <= MAX_UINT256;
}

export function routeGasIsValid(route: NormalizedRoute): boolean {
  if (route.provider !== "lifi") return true;
  try {
    return route.raw.steps.every(step => (step.estimate.gasCosts ?? []).every(cost =>
      cost && cost.token && Number.isSafeInteger(cost.token.chainId) &&
      typeof cost.token.address === "string" && /^0x[\da-f]{40}$/i.test(cost.token.address) &&
      typeof cost.amount === "string" && /^\d{1,78}$/.test(cost.amount)));
  } catch { return false; }
}

export function quoteKey(params: SwapParams): string {
  return JSON.stringify([params.fromChainId, params.toChainId,
    params.fromTokenAddress.toLowerCase(), params.toTokenAddress.toLowerCase(),
    params.fromAmount, params.fromAddress.toLowerCase()]);
}

export function canExecuteQuote(route: NormalizedRoute | null, params: SwapParams | null, now = Date.now()): boolean {
  if (!route || !params || !params.fromAddress || !["lifi", "rango", "oneclick"].includes(route.provider) || !Number.isFinite(route.expiresAt) || route.expiresAt <= now || quoteKey(route) !== quoteKey(params) || !validQuoteOutput(route.toAmount, route.toAmountMin) || !routeFeesAreValid(route) || !routeGasIsValid(route)) return false;
  if (route.provider === "oneclick") return /^0x[0-9a-f]{40}$/i.test(route.fromAddress) && !/^0x0{40}$/i.test(route.fromTokenAddress) && route.toAmountMin === route.raw.minAmountOut;
  if (route.provider === "rango") {
    try {
      const data = validateRangoQuote(route.raw.quote, params);
      return quoteKey(route.raw.params) === quoteKey(params) && data.route.outputAmount === route.toAmount && data.route.outputAmountMin === route.toAmountMin;
    } catch { return false; }
  }
  const raw = route.raw;
  try { assertLifiExecutionCapability(raw); } catch { return false; }
  return raw.toAmount === route.toAmount && raw.toAmountMin === route.toAmountMin && validQuoteOutput(raw.toAmount, raw.toAmountMin) && quoteKey({ fromChainId: raw.fromChainId, toChainId: raw.toChainId,
    fromTokenAddress: raw.fromToken.address, toTokenAddress: raw.toToken.address,
    fromAmount: raw.fromAmount, fromAddress: raw.fromAddress ?? raw.steps[0]?.action.fromAddress ?? params.fromAddress }) === quoteKey(params) &&
    (!raw.toAddress || raw.toAddress.toLowerCase() === params.fromAddress.toLowerCase());
}

export function sourceGasAmount(route: NormalizedRoute | null): bigint {
  if (!route || route.provider === "oneclick") return BigInt(0);
  if (!routeGasIsValid(route)) return BigInt(0); // Invalid route is never executable.
  if (route.provider === "rango") return route.raw.quote.route.fee.filter((fee) => fee.expenseType === "FROM_SOURCE_WALLET")
    .reduce((sum, fee) => sum + BigInt(fee.amount), BigInt(0));
  return route.raw.steps.flatMap((step) => step.estimate.gasCosts ?? [])
    .filter((cost) => cost.token.chainId === route.fromChainId && /^0x0{40}$/i.test(cost.token.address))
    .reduce((sum, cost) => sum + (/^\d+$/.test(cost.amount) ? BigInt(cost.amount) : BigInt(0)), BigInt(0));
}

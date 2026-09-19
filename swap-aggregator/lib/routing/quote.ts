import type { SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute } from "../types/normalized-route";

export function quoteKey(params: SwapParams): string {
  return JSON.stringify([params.fromChainId, params.toChainId,
    params.fromTokenAddress.toLowerCase(), params.toTokenAddress.toLowerCase(),
    params.fromAmount, params.fromAddress.toLowerCase()]);
}

export function canExecuteQuote(route: NormalizedRoute | null, params: SwapParams | null, now = Date.now()): boolean {
  if (!route || !params || route.provider !== "lifi" || route.expiresAt <= now || quoteKey(route) !== quoteKey(params)) return false;
  const raw = route.raw;
  return quoteKey({ fromChainId: raw.fromChainId, toChainId: raw.toChainId,
    fromTokenAddress: raw.fromToken.address, toTokenAddress: raw.toToken.address,
    fromAmount: raw.fromAmount, fromAddress: raw.fromAddress ?? raw.steps[0]?.action.fromAddress ?? params.fromAddress }) === quoteKey(params) &&
    (!raw.toAddress || raw.toAddress.toLowerCase() === params.fromAddress.toLowerCase());
}

export function sourceGasAmount(route: NormalizedRoute | null): bigint {
  if (!route) return BigInt(0);
  return route.raw.steps.flatMap((step) => step.estimate.gasCosts ?? [])
    .filter((cost) => cost.token.chainId === route.fromChainId && /^0x0{40}$/i.test(cost.token.address))
    .reduce((sum, cost) => sum + (/^\d+$/.test(cost.amount) ? BigInt(cost.amount) : BigInt(0)), BigInt(0));
}

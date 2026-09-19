import type { Route } from "@lifi/sdk";
import type { SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute } from "../types/normalized-route";
import { QUOTE_TTL_MS } from "./config";
import { quoteKey } from "./quote";

export function normalizeLifiRoute(route: Route, params: SwapParams, expiresAt = Date.now() + QUOTE_TTL_MS): NormalizedRoute {
  if (!route.id || !/^\d+$/.test(route.toAmount) || BigInt(route.toAmount) <= BigInt(0) ||
      !/^\d+$/.test(route.toAmountMin) || !route.steps?.length) throw new Error("Invalid LI.FI quote.");
  const result: NormalizedRoute = {
    id: `lifi:${route.id}`, provider: "lifi",
    fromChainId: route.fromChainId, toChainId: route.toChainId,
    fromTokenAddress: route.fromToken.address, toTokenAddress: route.toToken.address,
    fromAddress: route.fromAddress ?? route.steps[0].action.fromAddress ?? params.fromAddress,
    fromAmount: route.fromAmount, toAmount: route.toAmount, toAmountMin: route.toAmountMin,
    gasCostUSD: route.gasCostUSD ?? null,
    toolLabel: [...new Set(route.steps.map((s) => s.toolDetails?.name || s.tool))].join(" → ") || "LI.FI",
    durationSeconds: route.steps.reduce((total, s) => total + (s.estimate?.executionDuration ?? 0), 0),
    expiresAt, raw: route,
  };
  if (quoteKey(result) !== quoteKey(params) ||
      (route.toAddress && route.toAddress.toLowerCase() !== params.fromAddress.toLowerCase())) {
    throw new Error("LI.FI quote does not match the requested swap.");
  }
  return result;
}

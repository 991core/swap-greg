export {
  fetchRoutes,
  fetchSupportedChains,
  fetchTopTokensByChain,
  fetchWalletTokenBalances,
  buildKnownFallbackTokens,
  type AppToken,
  type SwapParams,
  type TokenBalanceEntry,
} from "./aggregators/lifi/routes";
export { executeLifiRoute } from "./aggregators/lifi/execute";
export { getRoutesForSelection as fetchNormalizedRoutes } from "./routing/orchestrator";
export type { NormalizedRoute, ProviderName } from "./types/normalized-route";

import type { Route } from "@lifi/sdk";

export { formatTokenAmount, parseTokenAmount } from "./amounts";

export function estimateRouteSeconds(route: Route): number {
  return route.steps.reduce((acc, step) => acc + (step.estimate?.executionDuration ?? 0), 0);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `~${Math.max(1, Math.round(seconds))}s`;
  }

  if (seconds < 3600) {
    return `~${Math.round(seconds / 60)} min`;
  }

  return `~${(seconds / 3600).toFixed(1)} h`;
}

export function routeToolLabels(route: Route): string {
  const tools = route.steps.map((step) => step.toolDetails?.name || step.tool).filter(Boolean);
  return [...new Set(tools)].join(" → ") || "LI.FI";
}

export { PLATFORM_FEE, SLIPPAGE } from "./routing/config";

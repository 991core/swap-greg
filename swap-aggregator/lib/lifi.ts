export {
  fetchRoutes,
  fetchSupportedChains,
  fetchSupportedTestnetChains,
  fetchTopTokensByChain,
  fetchWalletTokenBalances,
  buildKnownFallbackTokens,
  type AppToken,
  type SwapParams,
  type TokenBalanceEntry,
} from "./aggregators/lifi/routes";
export { setLifiWalletClient } from "./aggregators/lifi/client";
export { executeLifiRoute } from "./aggregators/lifi/execute";
export { getRoutesForSelection as fetchNormalizedRoutes } from "./routing/orchestrator";
export type { NormalizedRoute, ProviderName } from "./types/normalized-route";

import type { Route } from "@lifi/sdk";

export function formatTokenAmount(amount: string, decimals: number, maxFrac = 6): string {
  try {
    const neg = amount.startsWith("-");
    const raw = neg ? amount.slice(1) : amount;
    const padded = raw.padStart(decimals + 1, "0");
    const whole = padded.slice(0, padded.length - decimals) || "0";

    let frac = padded.slice(padded.length - decimals).replace(/0+$/, "");

    if (frac.length > maxFrac) {
      frac = frac.slice(0, maxFrac).replace(/0+$/, "");
    }

    const sign = neg ? "-" : "";
    return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
  } catch {
    return amount;
  }
}

export function parseTokenAmount(human: string, decimals: number): string | null {
  const cleaned = human.trim().replace(/,/g, "");

  if (!cleaned || Number.isNaN(Number(cleaned)) || Number(cleaned) < 0) {
    return null;
  }

  const [wholePart, fracPart = ""] = cleaned.split(".");

  if (fracPart.length > decimals) {
    return null;
  }

  const frac = fracPart.padEnd(decimals, "0");
  const combined = `${wholePart}${frac}`.replace(/^0+(?=\d)/, "");

  return combined || "0";
}

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

export const PLATFORM_FEE = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_PERCENT ?? "0") / 100;

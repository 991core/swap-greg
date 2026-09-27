import { fetchRoutes as fetchLifiRoutes } from "../aggregators/lifi/routes";
import { fetchRangoRoutes, normalizeRangoRoute } from "../aggregators/rango/routes";
import { fetchOneClickRoute } from "../aggregators/oneclick/client";
import type { NormalizedRoute, ProviderSelection } from "../types/normalized-route";

export type RouteSelectionParams = {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress: string;
  fromTokenDecimals: number;
  toTokenDecimals: number;
  providers?: ProviderSelection;
};

function normalizeLifiRoute(route: unknown, params: RouteSelectionParams): NormalizedRoute {
  const lifiRoute = route as {
    id?: string;
    toAmount?: string;
    steps?: Array<{
      tool?: string;
      toolDetails?: { name?: string };
      estimate?: { executionDuration?: number };
    }>;
  };

  const tools = (lifiRoute.steps ?? [])
    .map((step) => step.toolDetails?.name || step.tool)
    .filter(Boolean);

  return {
    id: lifiRoute.id ?? `${params.fromChainId}-${params.toChainId}-${params.fromTokenAddress}-${params.toTokenAddress}`,
    provider: "lifi",
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    toAmount: lifiRoute.toAmount ?? "0",
    toolLabel: [...new Set(tools)].join(" → ") || "LI.FI",
    durationSeconds: (lifiRoute.steps ?? []).reduce((acc, step) => acc + (step.estimate?.executionDuration ?? 0), 0),
    raw: route,
  };
}

export async function getRoutesForSelection(params: RouteSelectionParams): Promise<NormalizedRoute[]> {
  const providers = params.providers ?? { lifi: true, socket: false, rango: true, oneclick: true };
  const [lifiResult, rangoResult, oneclickResult] = await Promise.allSettled([
    providers.lifi ? fetchLifiRoutes(params) : Promise.resolve([]),
    providers.rango ? fetchRangoRoutes(params) : Promise.resolve([]),
    providers.oneclick ? fetchOneClickRoute(params) : Promise.resolve([]),
  ]);

  const normalized: NormalizedRoute[] = [];

  if (lifiResult.status === "fulfilled") {
    normalized.push(...lifiResult.value.map((route) => normalizeLifiRoute(route, params)));
  }
  if (rangoResult.status === "fulfilled") {
    normalized.push(...rangoResult.value.map((route) => normalizeRangoRoute(route, params)));
  }
  if (oneclickResult.status === "fulfilled") normalized.push(...oneclickResult.value);

  return normalized.sort((a, b) => {
    const aNet = BigInt(a.toAmount);
    const bNet = BigInt(b.toAmount);
    if (aNet === bNet) return 0;
    return aNet > bNet ? -1 : 1;
  });
}

import { fetchRoutes as fetchLifiRoutes } from "../aggregators/lifi/routes";
import { fetchRangoRoutes, normalizeRangoRoute } from "../aggregators/rango/routes";
import type { NormalizedRoute, ProviderSelection } from "../types/normalized-route";

export type RouteSelectionParams = {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress: string;
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
  const providers = params.providers ?? { lifi: true, socket: false, rango: true };
  const requests: Promise<unknown>[] = [];

  if (providers.lifi) {
    requests.push(fetchLifiRoutes(params));
  }

  if (providers.rango) {
    requests.push(fetchRangoRoutes(params));
  }

  const results = await Promise.all(requests);

  const normalized: NormalizedRoute[] = [];

  if (providers.lifi && results[0]) {
    normalized.push(...(results[0] as Awaited<ReturnType<typeof fetchLifiRoutes>>).map((route) => normalizeLifiRoute(route, params)));
  }

  if (providers.rango) {
    const rangoIndex = providers.lifi ? 1 : 0;
    const rangoRoutes = results[rangoIndex] as Awaited<ReturnType<typeof fetchRangoRoutes>> | undefined;
    if (rangoRoutes) {
      normalized.push(...rangoRoutes.map((route) => normalizeRangoRoute(route, params)));
    }
  }

  return normalized.sort((a, b) => {
    const aNet = BigInt(a.toAmount);
    const bNet = BigInt(b.toAmount);
    if (aNet === bNet) return 0;
    return aNet > bNet ? -1 : 1;
  });
}

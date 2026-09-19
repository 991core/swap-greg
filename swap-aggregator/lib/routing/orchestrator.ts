import { fetchRoutes, type SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute, ProviderSelection } from "../types/normalized-route";
import { normalizeLifiRoute } from "./normalize";
import { sortRoutes } from "./sort";
import { deduplicateRoutes } from "./deduplicate";

export type RouteSelectionParams = SwapParams & { providers?: ProviderSelection };
export async function getRoutesForSelection(params: RouteSelectionParams, signal?: AbortSignal): Promise<NormalizedRoute[]> {
  if (params.providers?.rango || params.providers?.socket) throw new Error("Rango and Socket are not available yet.");
  if (params.providers && !params.providers.lifi) return [];
  const routes = await fetchRoutes(params, signal);
  return sortRoutes(deduplicateRoutes(routes.map((route) => normalizeLifiRoute(route, params))));
}

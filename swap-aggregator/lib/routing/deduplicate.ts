import type { NormalizedRoute } from "../types/normalized-route";
/** Removes duplicate provider quote IDs, not distinct underlying bridge paths. */
export function deduplicateRoutes(routes: NormalizedRoute[]): NormalizedRoute[] {
  const result = new Map<string, NormalizedRoute>();
  for (const route of routes) {
    const old = result.get(route.id);
    if (!old || BigInt(route.toAmount) > BigInt(old.toAmount)) result.set(route.id, route);
  }
  return [...result.values()];
}

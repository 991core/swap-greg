import type { NormalizedRoute } from "../types/normalized-route";
export function sortRoutes(routes: NormalizedRoute[]): NormalizedRoute[] {
  return [...routes].sort((a, b) => BigInt(a.toAmount) === BigInt(b.toAmount) ? 0 : BigInt(a.toAmount) > BigInt(b.toAmount) ? -1 : 1);
}

import { fetchRoutes, type SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute, ProviderSelection } from "../types/normalized-route";
import { normalizeLifiRoute } from "./normalize";
import { sortRoutes } from "./sort";
import { deduplicateRoutes } from "./deduplicate";
import { fetchRangoRoutes } from "../aggregators/rango/routes";

import { fetchOneClickRoute } from "../aggregators/oneclick/client";
import type { AppToken } from "../tokens/types";
export type RouteSelectionParams = SwapParams & { providers?: ProviderSelection; fromTokenDecimals?: number; toTokenDecimals?: number; fromToken?: AppToken; toToken?: AppToken };
export type ProviderWarning = { provider: "lifi" | "rango" | "oneclick"; message: string };
export async function getRoutesForSelection(params: RouteSelectionParams, signal?: AbortSignal, onWarning?: (warning: ProviderWarning) => void, onProgress?: (routes: NormalizedRoute[]) => void): Promise<NormalizedRoute[]> {
  if (params.providers?.socket) throw new Error("Socket is not available yet.");
  const selection = params.providers ?? { lifi: true, rango: true, socket: false, oneclick: false };
  // UI-only provider controls must not leak into either provider's API payload.
  const request: SwapParams = { fromChainId: params.fromChainId, toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress, toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount, fromAddress: params.fromAddress };
  const jobs: { provider: "lifi" | "rango" | "oneclick"; run: () => Promise<NormalizedRoute[]> }[] = [];
  if (selection.lifi) jobs.push({ provider: "lifi", run: async () => (await fetchRoutes(request, signal)).map((route) => normalizeLifiRoute(route, request)) });
  if (selection.rango) jobs.push({ provider: "rango", run: () => fetchRangoRoutes(request, signal) });
  if (selection.oneclick) jobs.push({ provider: "oneclick", run: () => fetchOneClickRoute(params, signal) });
  const routes: NormalizedRoute[] = [];
  const results = await Promise.allSettled(jobs.map(async (job) => {
    const received = await job.run();
    if (signal?.aborted) return;
    routes.push(...received);
    if (received.length) onProgress?.(sortRoutes(deduplicateRoutes(routes)));
  }));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let failures = 0;
  results.forEach((result, index) => {
    if (result.status === "rejected") { failures++; onWarning?.({ provider: jobs[index].provider, message: "unavailable" }); }
  });
  if (jobs.length && failures === jobs.length) throw new Error("No selected provider is available. Retrying automatically.");
  return sortRoutes(deduplicateRoutes(routes));
}

import { fetchRoutes, type SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute, ProviderSelection } from "../types/normalized-route";
import { normalizeLifiRoute } from "./normalize";
import { logQuoteFailure } from "./diagnostics";
import { sortRoutes } from "./sort";
import { deduplicateRoutes } from "./deduplicate";
import { fetchRangoRoutes } from "../aggregators/rango/routes";

import { fetchOneClickRoute } from "../aggregators/oneclick/client";
import type { AppToken } from "../tokens/types";
export type RouteSelectionParams = SwapParams & { providers?: ProviderSelection; fromTokenDecimals?: number; toTokenDecimals?: number; fromToken?: AppToken; toToken?: AppToken };
export type ProviderFailure = "unavailable" | "quota" | "configuration";
export type ProviderWarning = { provider: "lifi" | "rango" | "oneclick"; message: ProviderFailure };
export class QuoteProvidersError extends Error {
  constructor(public readonly failure: ProviderFailure) { super("Quote providers unavailable"); }
}
function failureKind(error: unknown): ProviderFailure {
  const value = error && typeof error === "object" ? error as { failure?: unknown; status?: unknown; cause?: { status?: unknown }; message?: unknown } : {};
  if (value.failure === "configuration") return "configuration";
  if (value.status === 429 || value.cause?.status === 429) return "quota";
  if (typeof value.message === "string" && /configuration|not configured|platform fees are not configured/i.test(value.message)) return "configuration";
  return "unavailable";
}
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
  const kinds: ProviderFailure[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures++;
      const kind = failureKind(result.reason); kinds.push(kind);
      logQuoteFailure(result.reason, { event: "provider_failed", provider: jobs[index].provider, fromChainId: params.fromChainId, toChainId: params.toChainId });
      onWarning?.({ provider: jobs[index].provider, message: kind });
    }
  });
  if (jobs.length && failures === jobs.length) throw new QuoteProvidersError(kinds.every(kind => kind === "quota") ? "quota" : kinds.every(kind => kind === "configuration") ? "configuration" : "unavailable");
  return sortRoutes(deduplicateRoutes(routes));
}

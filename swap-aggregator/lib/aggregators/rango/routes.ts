import type { SwapParams } from "../lifi/routes";
import type { RangoNormalizedRoute } from "../../types/normalized-route";
import { QUOTE_TTL_MS } from "../../routing/config";
import type { RangoQuote } from "./types";
import { rangoRequest } from "./client";
import { rangoGasUsd, validateRangoQuote } from "./validation";

export function normalizeRangoQuote(data: RangoQuote, params: SwapParams, expiresAt = Date.now() + QUOTE_TTL_MS): RangoNormalizedRoute {
  const quote = validateRangoQuote(data, params);
  return { ...params, id: `rango:${quote.requestId}`, provider: "rango", toAmount: quote.route.outputAmount,
    toAmountMin: quote.route.outputAmountMin, gasCostUSD: rangoGasUsd(quote.route), toolLabel: quote.route.swapper.title || quote.route.swapper.id,
    durationSeconds: quote.route.estimatedTimeInSeconds, expiresAt, raw: { quote, params: { ...params } } };
}
export async function fetchRangoRoutes(params: SwapParams, signal?: AbortSignal): Promise<RangoNormalizedRoute[]> {
  const quote = await rangoRequest<RangoQuote>("quote", { params }, signal);
  if (quote.resultType === "NO_ROUTE" && !quote.error) return [];
  return [normalizeRangoQuote(quote, params)];
}

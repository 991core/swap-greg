import "server-only";
import { PLATFORM_FEE, SLIPPAGE, ROUTE_TIMEOUT_MS } from "../../routing/config";
import type { SwapParams } from "../lifi/routes";
import { isAddress, isRequestId, isUint, rangoAsset, RANGO_CHAINS, validateRangoQuote } from "./validation";
import type { RangoQuote, RangoStatus, RangoSwap } from "./types";

// Published by Rango for integration tests, NOT a secret or a production key.
// https://docs.rango.exchange/api-integration/api-key-and-rate-limits
export const RANGO_PUBLIC_TEST_KEY = "c6381a79-2817-4602-83bf-6a641a409e32";
export class RangoApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const invalid = () => new RangoApiError(400, "Invalid Rango request.");
export function parseRangoParams(value: unknown): SwapParams {
  if (!value || typeof value !== "object") throw invalid();
  const p = value as SwapParams;
  if (!Number.isInteger(p.fromChainId) || !Number.isInteger(p.toChainId) || !RANGO_CHAINS[p.fromChainId] || !RANGO_CHAINS[p.toChainId] ||
      !isAddress(p.fromTokenAddress) || !isAddress(p.toTokenAddress) || !isAddress(p.fromAddress) ||
      !isUint(p.fromAmount) || BigInt(p.fromAmount) <= BigInt(0) ||
      (p.fromChainId === p.toChainId && p.fromTokenAddress.toLowerCase() === p.toTokenAddress.toLowerCase())) throw invalid();
  return { fromChainId: p.fromChainId, toChainId: p.toChainId, fromTokenAddress: p.fromTokenAddress,
    toTokenAddress: p.toTokenAddress, fromAmount: p.fromAmount, fromAddress: p.fromAddress };
}
export function rangoQuery(operation: string, body: Record<string, unknown>): URL {
  if (!["quote", "swap", "status"].includes(operation)) throw invalid();
  const apiKey = process.env.RANGO_API_KEY?.trim() || RANGO_PUBLIC_TEST_KEY;
  const url = new URL(`/basic/${operation}`, apiKey === RANGO_PUBLIC_TEST_KEY ? "https://public-api.rango.exchange" : "https://api.rango.exchange");
  url.searchParams.set("apiKey", apiKey);
  if (operation === "status") {
    if (!isRequestId(body.requestId) || typeof body.txId !== "string" || !/^0x[\da-f]{64}$/i.test(body.txId)) throw invalid();
    url.searchParams.set("requestId", body.requestId); url.searchParams.set("txId", body.txId);
    return url;
  }
  const params = parseRangoParams(body.params);
  const referrer = process.env.RANGO_REFERRER_ADDRESS?.trim();
  if (PLATFORM_FEE > 0.03 || (PLATFORM_FEE > 0 && !isAddress(referrer))) throw new RangoApiError(503, "Rango fee configuration is incomplete.");
  const query: Record<string, string> = {
    from: rangoAsset(params.fromChainId, params.fromTokenAddress), to: rangoAsset(params.toChainId, params.toTokenAddress),
    amount: params.fromAmount, slippage: String(SLIPPAGE * 100), referrerFee: String(PLATFORM_FEE * 100),
    avoidNativeFee: "true", enableCentralizedSwappers: "false",
  };
  if (operation === "swap") {
    if (typeof body.swapper !== "string" || !/^[\w .()-]{1,100}$/.test(body.swapper)) throw invalid();
    Object.assign(query, { fromAddress: params.fromAddress, toAddress: params.fromAddress,
      swappers: body.swapper, swappersExclude: "false", infiniteApprove: "false", disableEstimate: "false" });
    if (PLATFORM_FEE > 0) query.referrerAddress = referrer!;
  }
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

// Separate buckets preserve tracking capacity when quote traffic reaches its cap.
const budgets = { quote: { window: 0, count: 0 }, swap: { window: 0, count: 0 }, status: { window: 0, count: 0 } };
export async function requestRangoOnServer(operation: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const url = rangoQuery(operation, body);
  const bucket = budgets[operation as keyof typeof budgets];
  const now = Date.now();
  if (now - bucket.window >= 60_000) { bucket.window = now; bucket.count = 0; }
  if (++bucket.count > (operation === "status" ? 120 : 60)) throw new RangoApiError(429, "Rango rate limit reached.");
  const timeout = AbortSignal.timeout(ROUTE_TIMEOUT_MS - 1000);
  let response: Response;
  try { response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store", redirect: "error" }); }
  catch { throw new RangoApiError(502, "Rango is unavailable."); }
  if (!response.ok) throw new RangoApiError(response.status === 429 ? 429 : 502, "Rango is unavailable.");
  const data = await response.json();
  if (operation === "status") {
    const status = data as RangoStatus;
    if (![null, "running", "success", "failed"].includes(status.status)) throw new RangoApiError(502, "Invalid Rango status.");
    return { status: status.status, output: status.output ?? null, error: status.error ? "Rango reported a transaction issue." : null };
  }
  const quote = data as RangoQuote;
  if (operation === "quote" && quote.resultType === "NO_ROUTE" && !quote.error) return { resultType: "NO_ROUTE", route: null, error: null };
  try { validateRangoQuote(quote, parseRangoParams(body.params)); }
  catch { throw new RangoApiError(502, "Rango did not return an executable route."); }
  // Do not forward upstream error/trace details (URLs can contain private keys).
  return { requestId: quote.requestId, resultType: quote.resultType, route: quote.route, error: null,
    ...(operation === "swap" ? { tx: (data as RangoSwap).tx } : {}) };
}

import "server-only";
import { readBoundedText, serverCanPrepareExecution } from "../../server/api";
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
function safeDiagnosticUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return;
    for (const name of url.searchParams.keys()) if (/key|secret|auth|jwt|token/i.test(name)) return;
    return url.href;
  } catch { return; }
}
/** Retain documented proof fields only; never forward unknown diagnostic payloads. */
function statusDiagnostics(status: RangoStatus) {
  const bridge: Record<string, string | number | null> = {};
  if (status.bridgeData && typeof status.bridgeData === "object" && !Array.isArray(status.bridgeData)) {
    const raw = status.bridgeData as Record<string, unknown>;
    for (const prefix of ["src", "dest"]) {
      const chain = raw[`${prefix}ChainId`]; const decimals = raw[`${prefix}TokenDecimals`];
      if (typeof chain === "number" && Number.isSafeInteger(chain) && chain > 0) bridge[`${prefix}ChainId`] = chain;
      if (typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255) bridge[`${prefix}TokenDecimals`] = decimals;
      const hash = raw[`${prefix}TxHash`]; const token = raw[`${prefix}Token`]; const amount = raw[`${prefix}TokenAmt`];
      if (hash === null || (typeof hash === "string" && /^0x[\da-f]{64}$/i.test(hash))) bridge[`${prefix}TxHash`] = hash;
      if (token === null || isAddress(token)) bridge[`${prefix}Token`] = token as string | null;
      if (amount === null || isUint(amount)) bridge[`${prefix}TokenAmt`] = amount as string | null;
    }
  }
  const diagnosisUrl = safeDiagnosticUrl(status.diagnosisUrl);
  const explorer = status.explorerUrl as unknown;
  const explorerUrl = Array.isArray(explorer) && explorer.length <= 16 ? explorer.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const url = safeDiagnosticUrl(item.url);
    const description = typeof item.description === "string" && /^(Inbound|Outbound)$/i.test(item.description) ? item.description : undefined;
    return url ? [{ url, ...(description ? { description } : {}) }] : [];
  }) : safeDiagnosticUrl(explorer);
  return { ...(Object.keys(bridge).length ? { bridgeData: bridge } : {}), ...(diagnosisUrl ? { diagnosisUrl } : {}), ...(explorerUrl ? { explorerUrl } : {}) };
}
export function parseRangoParams(value: unknown, allowAnonymous = false): SwapParams {
  if (!value || typeof value !== "object") throw invalid();
  const p = value as SwapParams;
  if (!Number.isInteger(p.fromChainId) || !Number.isInteger(p.toChainId) || !RANGO_CHAINS[p.fromChainId] || !RANGO_CHAINS[p.toChainId] ||
      !isAddress(p.fromTokenAddress) || !isAddress(p.toTokenAddress) || !(isAddress(p.fromAddress) || (allowAnonymous && p.fromAddress === "")) ||
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
  const params = parseRangoParams(body.params, operation === "quote");
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
const budgets = { quote: { window: 0, count: 0, active: 0 }, swap: { window: 0, count: 0, active: 0 }, status: { window: 0, count: 0, active: 0 } };
export async function requestRangoOnServer(operation: string, body: Record<string, unknown>, signal?: AbortSignal) {
  if (operation === "swap" && !serverCanPrepareExecution()) throw new RangoApiError(403, "New execution preparation is disabled.");
  const url = rangoQuery(operation, body);
  const bucket = budgets[operation as keyof typeof budgets];
  const now = Date.now();
  if (now - bucket.window >= 60_000) { bucket.window = now; bucket.count = 0; }
  if (++bucket.count > (operation === "status" ? 120 : 60)) throw new RangoApiError(429, "Rango rate limit reached.");
  if (bucket.active >= (operation === "swap" ? 4 : 8)) throw new RangoApiError(429, "Rango is busy.");
  bucket.active++;
  try {
  const timeout = AbortSignal.timeout(ROUTE_TIMEOUT_MS - 1000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try { response = await fetch(url, { signal: requestSignal, cache: "no-store", redirect: "error" }); }
  catch { throw new RangoApiError(502, "Rango is unavailable."); }
  if (!response.ok) { void response.body?.cancel(); throw new RangoApiError(response.status === 429 ? 429 : 502, "Rango is unavailable."); }
  let data: unknown;
  try { data = JSON.parse(await readBoundedText(response, 2 * 1024 * 1024, { upstream: true, signal: requestSignal, timeoutMs: ROUTE_TIMEOUT_MS - 1000 })); }
  catch { throw new RangoApiError(502, "Rango is unavailable."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new RangoApiError(502, "Invalid Rango response.");
  if (operation === "status") {
    const status = data as RangoStatus;
    if (![null, "running", "success", "failed"].includes(status.status)) throw new RangoApiError(502, "Invalid Rango status.");
    return { status: status.status, output: status.output ?? null, error: status.error ? "Rango reported a transaction issue." : null, ...statusDiagnostics(status) };
  }
  const quote = data as RangoQuote;
  if (operation === "quote" && quote.resultType === "NO_ROUTE" && !quote.error) return { resultType: "NO_ROUTE", route: null, error: null };
  try { validateRangoQuote(quote, parseRangoParams(body.params, operation === "quote")); }
  catch { throw new RangoApiError(502, "Rango did not return an executable route."); }
  // Do not forward upstream error/trace details (URLs can contain private keys).
  return { requestId: quote.requestId, resultType: quote.resultType, route: quote.route, error: null,
    ...(operation === "swap" ? { tx: (data as RangoSwap).tx } : {}) };
  } finally { bucket.active--; }
}

import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

export class ApiBoundaryError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export const API_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
type Policy = { perClient: number; total: number; concurrent: number };
const policies: Record<string, Policy> = {
  "rango.quote": { perClient: 20, total: 60, concurrent: 8 },
  "rango.swap": { perClient: 12, total: 60, concurrent: 4 },
  "rango.status": { perClient: 60, total: 120, concurrent: 8 },
  "oneclick.quote": { perClient: 20, total: 60, concurrent: 8 },
  "oneclick.status": { perClient: 90, total: 240, concurrent: 8 },
  "oneclick.tokens": { perClient: 20, total: 60, concurrent: 4 },
  "tokens.search": { perClient: 40, total: 240, concurrent: 16 },
  // Browser enrichment polls at most once per 5 seconds, independently of upstream cache.
  "tokens.universe": { perClient: 15, total: 240, concurrent: 4 },
};
type Bucket = { start: number; count: number; active: number; clients: Map<string, { start: number; count: number }> };
const buckets = new Map<string, Bucket>();
const salt = randomBytes(32);
const metrics = new Map<string, { requests: number; errors: number; limited: number; latencyMs: number; cacheHits: number; cacheMisses: number }>();
function metric(operation: string) {
  let value = metrics.get(operation);
  if (!value) { value = { requests: 0, errors: 0, limited: 0, latencyMs: 0, cacheHits: 0, cacheMisses: 0 }; metrics.set(operation, value); }
  return value;
}
/** Aggregate process-local counters only. Never contains wallets, URLs, bodies or IPs. */
export function apiMetricsSnapshot() { return Object.fromEntries([...metrics].map(([key, value]) => [key, { ...value }])); }
export function observeApiCache(operation: string, hit: boolean) { const value = metric(operation); if (hit) value.cacheHits++; else value.cacheMisses++; }
let lifiWindowStart = 0; let lifiUsed = 0;
/** Shared by server search AND universe/enrichment, before an actual fetch. */
export function reserveLifiUpstream() {
  const configured = Number(process.env.LIFI_SERVER_REQUESTS_PER_MINUTE ?? 120);
  const limit = Number.isInteger(configured) && configured >= 1 && configured <= 1000 ? configured : 120;
  if (Date.now() - lifiWindowStart >= 60_000) { lifiWindowStart = Date.now(); lifiUsed = 0; }
  if (lifiUsed >= limit) throw new ApiBoundaryError(429, "rate_limited");
  lifiUsed++;
}

/** PUBLIC_ORIGIN is the canonical origin; forwarded headers never define authority. */
export function validateApiOrigin(request: Request) {
  const configured = process.env.HERMES_PUBLIC_ORIGIN;
  let expected: URL;
  try {
    expected = new URL(configured || request.url);
    if (!/^https?:$/.test(expected.protocol) || expected.username || expected.password ||
        (configured && (expected.pathname !== "/" || expected.search || expected.hash))) throw new Error();
  } catch { throw new ApiBoundaryError(503, "invalid_public_origin_configuration"); }
  const host = request.headers.get("host");
  if (configured && host && host.toLowerCase() !== expected.host.toLowerCase()) throw new ApiBoundaryError(403, "invalid_host");
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiBoundaryError(403, "cross_origin_rejected");
  if (!origin) return; // Non-browser callers still face quotas. Origin is not authentication.
  let source: URL;
  try { source = new URL(origin); } catch { throw new ApiBoundaryError(403, "invalid_origin"); }
  if (source.origin !== expected.origin || source.username || source.password || source.pathname !== "/" || source.search || source.hash) throw new ApiBoundaryError(403, "cross_origin_rejected");
}
function clientKey(request: Request) {
  // Safe only when direct access is impossible and the proxy overwrites this one header.
  // Never parse client-controlled X-Forwarded-For, even with trust enabled.
  if (process.env.HERMES_TRUST_PROXY !== "true") return "unattributed";
  const ip = request.headers.get("x-hermes-client-ip") ?? "";
  if (!isIP(ip)) throw new ApiBoundaryError(403, "trusted_client_ip_required");
  return createHmac("sha256", salt).update(ip).digest("hex");
}
function reserve(operation: string, request: Request): () => void {
  if (!Object.hasOwn(policies, operation)) throw new ApiBoundaryError(400, "invalid_operation");
  const policy = policies[operation];
  if (!policy) throw new ApiBoundaryError(400, "invalid_operation");
  const now = Date.now(); const key = clientKey(request);
  let bucket = buckets.get(operation);
  if (!bucket) { bucket = { start: now, count: 0, active: 0, clients: new Map() }; buckets.set(operation, bucket); }
  if (now - bucket.start >= 60_000) { bucket.start = now; bucket.count = 0; }
  for (const [identity, value] of bucket.clients) if (now - value.start >= 60_000) bucket.clients.delete(identity);
  let client = bucket.clients.get(key);
  if (!client) {
    // Do not evict live identities to let an attacker reset quotas by churning IPs.
    if (bucket.clients.size >= 4096) throw new ApiBoundaryError(429, "rate_limited");
    client = { start: now, count: 0 }; bucket.clients.set(key, client);
  }
  // Unattributed clients share the upstream-safe global allowance. Proxy validation
  // is a deployment gate for real per-client isolation.
  const limit = key === "unattributed" ? policy.total : policy.perClient;
  if (client.count >= limit || bucket.count >= policy.total || bucket.active >= policy.concurrent) throw new ApiBoundaryError(429, "rate_limited");
  client.count++; bucket.count++; bucket.active++;
  return () => { bucket!.active--; };
}
export function apiErrorResponse(error: unknown): Response {
  const known = error instanceof ApiBoundaryError ? error : new ApiBoundaryError(503, "api_unavailable");
  return Response.json({ error: known.code }, { status: known.status, headers: { ...API_HEADERS, ...(known.status === 429 ? { "Retry-After": "60" } : {}) } });
}
export async function withApiGuard(operation: string, request: Request, action: () => Promise<Response>): Promise<Response> {
  const metricOperation = Object.hasOwn(policies, operation) ? operation : "invalid";
  const started = Date.now(); let release: (() => void) | undefined; let status = 503;
  try {
    if (request.url.length > 2048) throw new ApiBoundaryError(414, "request_url_too_long");
    validateApiOrigin(request); release = reserve(operation, request);
    if (request.signal.aborted) throw new ApiBoundaryError(499, "request_cancelled");
    const response = await action();
    if (request.signal.aborted) throw new ApiBoundaryError(499, "request_cancelled");
    status = response.status; return response;
  } catch (error) { const response = apiErrorResponse(error); status = response.status; return response; }
  finally {
    release?.(); const value = metric(metricOperation); const elapsed = Math.max(0, Date.now() - started);
    value.requests++; value.latencyMs += elapsed; if (status >= 400) value.errors++; if (status === 429) value.limited++;
    if (process.env.HERMES_API_LOGS === "true") console.info(JSON.stringify({ event: "api_request", operation: metricOperation, status, latencyMs: elapsed, counters: { ...value } }));
  }
}

/** Bound byte accumulation and elapsed read time, including slow/chunked bodies. */
export async function readBoundedText(source: Request | Response, limit: number, options: { timeoutMs?: number; signal?: AbortSignal; upstream?: boolean } = {}): Promise<string> {
  const invalid = () => new ApiBoundaryError(options.upstream ? 502 : 413, options.upstream ? "upstream_response_too_large" : "request_too_large");
  const length = source.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { void source.body?.cancel(); throw invalid(); }
  if (!source.body) return "";
  const reader = source.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 5000)]) : AbortSignal.timeout(options.timeoutMs ?? 5000);
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { void reader.cancel().catch(() => {}); rejectAbort(new ApiBoundaryError(options.upstream ? 502 : 408, options.upstream ? "upstream_timeout" : "request_timeout")); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let size = 0; let text = "";
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw invalid(); }
      text += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) throw new ApiBoundaryError(options.upstream ? 502 : 408, "request_timeout");
    return text + decoder.decode();
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
export async function readApiJson(request: Request, limit = 4096): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiBoundaryError(415, "json_required");
  const text = await readBoundedText(request, limit, { signal: request.signal });
  try { return JSON.parse(text); } catch { throw new ApiBoundaryError(400, "invalid_json"); }
}
/** Build mode closes preparation too; runtime incident switch can close an enabled image. */
export function serverCanPrepareExecution() {
  return process.env.NEXT_PUBLIC_RELEASE_MODE === "enabled" && process.env.HERMES_EXECUTION_DISABLED !== "true";
}

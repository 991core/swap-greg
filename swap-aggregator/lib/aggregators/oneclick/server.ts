import "server-only";
import { NextResponse } from "next/server";
import { ONECLICK_CHAINS, isOneClickTokenEvidence, type OneClickTokenEvidence } from "./validation";
export { ONECLICK_CHAINS } from "./validation";
export type OneClickToken = OneClickTokenEvidence;
export const ONECLICK_API = "https://1click.chaindefuser.com/v0";
export const ONECLICK_TIMEOUT_MS = 14_000;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
export class OneClickApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const ONECLICK_RESPONSE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export function oneClickErrorResponse(error: unknown) {
  const safe = error instanceof OneClickApiError ? error : new OneClickApiError(502, "1Click is unavailable.");
  return NextResponse.json({ error: safe.message }, { status: safe.status, headers: {
    ...ONECLICK_RESPONSE_HEADERS, ...(safe.status === 429 ? { "Retry-After": "60" } : {}),
  } });
}
export function validateOneClickOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const target = new URL(request.url);
  const host = request.headers.get("host") ?? target.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? target.protocol.slice(0, -1);
  let source: URL;
  try { source = new URL(origin); } catch { throw new OneClickApiError(403, "Invalid origin."); }
  if (source.host.toLowerCase() !== host.toLowerCase() || source.protocol !== `${protocol}:` ||
      !["http", "https"].includes(protocol) || source.username || source.password || source.pathname !== "/" || source.search || source.hash) {
    throw new OneClickApiError(403, "Cross-origin request rejected.");
  }
}
async function readBoundedBody(response: Request | Response, limit: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new OneClickApiError(413, "Request too large.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new OneClickApiError(413, "Request too large."); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
export async function readOneClickJson(request: Request): Promise<unknown> {
  validateOneClickOrigin(request);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new OneClickApiError(415, "JSON required.");
  const text = await readBoundedBody(request, 4096);
  try { return JSON.parse(text); } catch { throw new OneClickApiError(400, "Invalid JSON."); }
}
export function oneClickHeaders(): HeadersInit {
  const apiKey = process.env.NEAR_1CLICK_API_KEY;
  const jwt = process.env.NEAR_1CLICK_JWT;
  return { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}), ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
}
export async function oneClickRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (path !== "/quote" && path !== "/tokens" && !/^\/status\?depositAddress=0x[0-9a-fA-F]{40}$/.test(path)) throw new OneClickApiError(400, "Invalid operation.");
  try {
    const response = await fetch(`${ONECLICK_API}${path}`, {
      ...init, headers: oneClickHeaders(), cache: "no-store", redirect: "error",
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ONECLICK_TIMEOUT_MS)]) : AbortSignal.timeout(ONECLICK_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new OneClickApiError(response.status === 429 ? 429 : 502, response.status === 429 ? "1Click rate limit reached." : "1Click is unavailable.");
    }
    return JSON.parse(await readBoundedBody(response, RESPONSE_LIMIT));
  } catch (error) {
    if (error instanceof OneClickApiError && error.status === 429) throw error;
    throw new OneClickApiError(502, "1Click is unavailable.");
  }
}

type Operation = "quote" | "status" | "tokens";
const limits: Record<Operation, { perMinute: number; concurrency: number }> = {
  quote: { perMinute: 60, concurrency: 8 }, status: { perMinute: 240, concurrency: 8 }, tokens: { perMinute: 60, concurrency: 2 },
};
const state: Record<Operation, { start: number; count: number; active: number; pending: Map<string, Promise<unknown>> }> = {
  quote: { start: 0, count: 0, active: 0, pending: new Map() },
  status: { start: 0, count: 0, active: 0, pending: new Map() },
  tokens: { start: 0, count: 0, active: 0, pending: new Map() },
};
/** Separate per-process budgets; shared work never inherits one browser's abort. */
export async function runOneClickOperation<T>(operation: Operation, key: string, task: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
  if (callerSignal?.aborted) throw new OneClickApiError(499, "Request cancelled.");
  const bucket = state[operation];
  if (Date.now() - bucket.start >= 60_000) { bucket.start = Date.now(); bucket.count = 0; }
  if (++bucket.count > limits[operation].perMinute) throw new OneClickApiError(429, "1Click rate limit reached.");
  let pending = bucket.pending.get(key) as Promise<T> | undefined;
  if (!pending) {
    if (bucket.active >= limits[operation].concurrency) throw new OneClickApiError(429, "1Click is busy.");
    bucket.active++;
    pending = Promise.resolve().then(() => task(AbortSignal.timeout(ONECLICK_TIMEOUT_MS))).finally(() => { bucket.active--; bucket.pending.delete(key); });
    bucket.pending.set(key, pending);
  }
  if (!callerSignal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new OneClickApiError(499, "Request cancelled."));
    callerSignal.addEventListener("abort", abort, { once: true });
    pending!.then(resolve, reject).finally(() => callerSignal.removeEventListener("abort", abort));
    if (callerSignal.aborted) abort();
  });
}
let tokenCache: { expires: number; tokens: OneClickToken[] } | undefined;
let tokenPending: Promise<OneClickToken[]> | undefined;
export async function getOneClickTokens(signal?: AbortSignal): Promise<OneClickToken[]> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.tokens;
  // Registry callers coalesce independently of quote/status calls.
  if (!tokenPending) tokenPending = (async () => {
    const data = await oneClickRequest("/tokens");
    if (!Array.isArray(data) || data.length > 5000) throw new OneClickApiError(502, "Invalid 1Click token registry.");
    const identities = new Map<string, OneClickToken>();
    const assets = new Map<string, string>();
    for (const item of data) {
      if (!item || typeof item !== "object" || !Object.values(ONECLICK_CHAINS).includes(item.blockchain)) continue;
      if (!isOneClickTokenEvidence(item)) throw new OneClickApiError(502, "Invalid 1Click token registry.");
      const token: OneClickToken = { assetId: item.assetId, blockchain: item.blockchain, contractAddress: item.contractAddress.toLowerCase(), decimals: item.decimals, symbol: item.symbol };
      const identity = `${token.blockchain}:${token.contractAddress}`;
      const previous = identities.get(identity);
      if ((previous && JSON.stringify(previous) !== JSON.stringify(token)) || (assets.has(token.assetId) && assets.get(token.assetId) !== identity)) throw new OneClickApiError(502, "Conflicting 1Click token registry.");
      identities.set(identity, token); assets.set(token.assetId, identity);
    }
    const tokens = [...identities.values()].sort((a, b) => `${a.blockchain}:${a.contractAddress}`.localeCompare(`${b.blockchain}:${b.contractAddress}`));
    if (!tokens.length) throw new OneClickApiError(502, "Invalid 1Click token registry.");
    tokenCache = { expires: Date.now() + 5 * 60_000, tokens };
    return tokens;
  })().finally(() => { tokenPending = undefined; });
  if (!signal) return tokenPending;
  if (signal.aborted) throw new OneClickApiError(499, "Request cancelled.");
  return new Promise((resolve, reject) => {
    const abort = () => reject(new OneClickApiError(499, "Request cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    tokenPending!.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function findOneClickToken(tokens: OneClickToken[], chainId: number, address: string) {
  return tokens.find(token => token.blockchain === ONECLICK_CHAINS[chainId] && token.contractAddress.toLowerCase() === address.toLowerCase());
}

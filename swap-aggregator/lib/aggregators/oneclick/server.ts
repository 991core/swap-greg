import "server-only";
import { ApiBoundaryError, readApiJson, readBoundedText, validateApiOrigin, observeApiCache, serverCanPrepareExecution } from "../../server/api";
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
  try { validateApiOrigin(request); } catch (error) {
    if (error instanceof ApiBoundaryError) throw new OneClickApiError(error.status, error.code);
    throw error;
  }
}
export async function readOneClickJson(request: Request): Promise<unknown> {
  validateOneClickOrigin(request);
  try { return await readApiJson(request); } catch (error) {
    if (error instanceof ApiBoundaryError) throw new OneClickApiError(error.status, error.code);
    throw error;
  }
}
export function oneClickHeaders(): HeadersInit {
  const apiKey = process.env.NEAR_1CLICK_API_KEY;
  const jwt = process.env.NEAR_1CLICK_JWT;
  return { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}), ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
}
export async function oneClickRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (path !== "/quote" && path !== "/tokens" && !/^\/status\?depositAddress=0x[0-9a-fA-F]{40}$/.test(path)) throw new OneClickApiError(400, "Invalid operation.");
  if (path === "/quote") {
    let body: unknown;
    try { body = JSON.parse(typeof init?.body === "string" ? init.body : ""); } catch { throw new OneClickApiError(400, "Invalid quote body."); }
    if (!body || typeof body !== "object" || !("dry" in body) || typeof body.dry !== "boolean") throw new OneClickApiError(400, "Invalid quote body.");
    if (!body.dry && !serverCanPrepareExecution()) throw new OneClickApiError(403, "New execution preparation is disabled.");
  }
  try {
    const response = await fetch(`${ONECLICK_API}${path}`, {
      ...init, headers: oneClickHeaders(), cache: "no-store", redirect: "error",
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ONECLICK_TIMEOUT_MS)]) : AbortSignal.timeout(ONECLICK_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new OneClickApiError(response.status === 429 ? 429 : 502, response.status === 429 ? "1Click rate limit reached." : "1Click is unavailable.");
    }
    return JSON.parse(await readBoundedText(response, RESPONSE_LIMIT, { timeoutMs: ONECLICK_TIMEOUT_MS, signal: init?.signal ?? undefined, upstream: true }));
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
  if (tokenCache && tokenCache.expires > Date.now()) { observeApiCache("oneclick.tokens", true); return tokenCache.tokens; }
  observeApiCache("oneclick.tokens", false);
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

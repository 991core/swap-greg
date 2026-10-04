import "server-only";
import { SecurityProviderError, type MarketProvider } from "./types";
import type { TokenProvider } from "../types";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CACHE = 256;
const CACHE_TTL_MS = 60_000;
const origins: Record<TokenProvider, readonly string[]> = {
  coingecko: ["https://api.coingecko.com", "https://pro-api.coingecko.com"],
  coinmarketcap: ["https://pro-api.coinmarketcap.com"], lifi: ["https://li.quest"],
};
const paths: Record<TokenProvider, RegExp> = {
  coingecko: /^\/api\/v3\/coins\/(?:markets|list|[a-z0-9][a-z0-9-]{0,127})$/,
  coinmarketcap: /^(?:\/public-api)?\/(?:v1\/cryptocurrency\/listings\/latest|v3\/cryptocurrency\/listings\/latest|v2\/cryptocurrency\/info)$/,
  lifi: /^\/v1\/(?:token|tokens)$/,
};
const budgets: Record<TokenProvider, { start: number; count: number; pending: Map<string, Promise<unknown>> }> = {
  coingecko: { start: 0, count: 0, pending: new Map() }, coinmarketcap: { start: 0, count: 0, pending: new Map() }, lifi: { start: 0, count: 0, pending: new Map() },
};
const cache = new Map<string, { expiresAt: number; data: unknown }>();
export function marketProviderUrl(provider: MarketProvider, path: string): URL {
  if (provider === "coingecko") return new URL(`/api/v3${path}`, process.env.CG_API_KEY && process.env.CG_API_TIER === "pro" ? origins.coingecko[1] : origins.coingecko[0]);
  return new URL(`${process.env.CMC_API_KEY ? "" : "/public-api"}${path}`, origins.coinmarketcap[0]);
}
function providerHeaders(provider: TokenProvider): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (provider === "coingecko" && process.env.CG_API_KEY) headers[process.env.CG_API_TIER === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = process.env.CG_API_KEY;
  if (provider === "coinmarketcap" && process.env.CMC_API_KEY) headers["X-CMC_PRO_API_KEY"] = process.env.CMC_API_KEY;
  if (provider === "lifi" && process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  return headers;
}
async function boundedJson(response: Response, provider: TokenProvider, limit = MAX_BYTES): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new SecurityProviderError(provider, "response_too_large"); }
  if (!response.body) throw new SecurityProviderError(provider, "invalid_response");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0; let text = "";
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new SecurityProviderError(provider, "response_too_large"); } text += decoder.decode(value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } catch (error) { if (error instanceof SecurityProviderError) throw error; throw new SecurityProviderError(provider, "invalid_response"); }
  finally { reader.releaseLock(); }
}
/** Fixed endpoints, redacted errors, bounded response/cache/quota and request coalescing. */
export async function requestSecurityProvider(provider: TokenProvider, url: URL, options: { fresh?: boolean; ttlMs?: number } = {}): Promise<unknown> {
  if (!origins[provider].includes(url.origin) || !paths[provider].test(url.pathname) || url.username || url.password || url.hash || url.href.length > 2048) throw new SecurityProviderError(provider, "invalid_endpoint", 400);
  for (const key of url.searchParams.keys()) if (/key|secret|auth|token/i.test(key) && !(provider === "lifi" && key === "token")) throw new SecurityProviderError(provider, "invalid_endpoint", 400);
  const key = `${provider}:${url.href}`; const cached = cache.get(key);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.data;
  const budget = budgets[provider]; const shared = budget.pending.get(key); if (shared) return shared;
  if (Date.now() - budget.start >= 60_000) { budget.start = Date.now(); budget.count = 0; }
  if (budget.pending.size >= 8 || budget.count >= 120) throw new SecurityProviderError(provider, "rate_limited", 429);
  budget.count++;
  const promise = (async () => {
    try {
      const response = await fetch(url.href, { headers: providerHeaders(provider), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
      if (!response.ok) { await response.body?.cancel(); throw new SecurityProviderError(provider, response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "access_unavailable" : "upstream_unavailable", response.status === 429 ? 429 : 503); }
      // The global CG platform map is the only bulk endpoint allowed 8 MiB.
      const limit = provider === "coingecko" && url.pathname === "/api/v3/coins/list" ? 8 * 1024 * 1024 : MAX_BYTES;
      const data = await boundedJson(response, provider, limit); cache.delete(key); if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { expiresAt: Date.now() + (options.ttlMs ?? CACHE_TTL_MS), data }); return data;
    } catch (error) { if (error instanceof SecurityProviderError) throw error; throw new SecurityProviderError(provider, "upstream_unavailable"); }
  })().finally(() => { budget.pending.delete(key); });
  budget.pending.set(key, promise); return promise;
}

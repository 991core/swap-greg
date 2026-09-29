import "server-only";
import { ChainType, createClient, getToken, getTokens } from "@lifi/sdk";
import { SEARCH_LIMITS, TOKEN_CACHE_TTL_MS, TokenSearchError, type TokenSearchResult } from "./types";
import { looksLikeAddress, uniqueTokens, validateToken, type TokenSearchInput } from "./validation";

const MAX_CACHE_ENTRIES = 256;
const MAX_IN_FLIGHT = 8;
const cache = new Map<string, { expiresAt: number; result: TokenSearchResult }>();
const pending = new Map<string, Promise<TokenSearchResult>>();
let windowStart = 0;
let requestsInWindow = 0;
let client: ReturnType<typeof createClient> | undefined;

function getClient() {
  return client ??= createClient({
    integrator: "hermes-hms", apiKey: process.env.LIFI_API_KEY || undefined, preloadChains: false,
    requestInterceptor: (options) => ({ ...options, cache: "no-store", retries: 0 }),
  });
}

function reserveRequest() {
  const configured = Number(process.env.TOKEN_SEARCH_REQUESTS_PER_MINUTE ?? 60);
  const budget = Number.isInteger(configured) && configured > 0 && configured <= 1000 ? configured : 60;
  if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requestsInWindow = 0; }
  if (pending.size >= MAX_IN_FLIGHT || requestsInWindow >= budget) throw new TokenSearchError("rate_limited", 429);
  requestsInWindow += 1;
}

function upstreamStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: number; cause?: { status?: number } };
  return value.cause?.status ?? value.status;
}

async function load(input: TokenSearchInput): Promise<TokenSearchResult> {
  const { chainId, query, limit } = input;
  const exact = looksLikeAddress(query);
  let raw: unknown[];
  try {
    const options = { signal: AbortSignal.timeout(8_000) };
    if (exact) raw = [await getToken(getClient(), chainId, query, options)];
    else {
      const result = await getTokens(getClient(), {
        chains: [chainId], chainTypes: [ChainType.EVM], extended: true, minPriceUSD: 0,
        orderBy: "marketCapUSD", limit: limit + 1, ...(query ? { search: query } : {}),
      }, options);
      if (!Array.isArray(result.tokens?.[chainId])) throw new TokenSearchError("tokens_unavailable");
      raw = result.tokens[chainId];
    }
  } catch (error) {
    if (exact && upstreamStatus(error) === 404) raw = [];
    else throw new TokenSearchError(upstreamStatus(error) === 429 ? "rate_limited" : "tokens_unavailable", upstreamStatus(error) === 429 ? 429 : 503);
  }
  const validated = raw.map((token) => validateToken(token, chainId, exact ? query : undefined));
  if (exact && raw.length && !validated[0]) throw new TokenSearchError("tokens_unavailable");
  const tokens = uniqueTokens(validated.filter((token) => token !== null));
  const truncated = !exact && raw.length > limit;
  return { chainId, query, tokens: tokens.slice(0, limit), limit, truncated,
    hasMore: truncated && limit < SEARCH_LIMITS[SEARCH_LIMITS.length - 1], checkedAt: Date.now() };
}

/** Bounded per-process cache and quota; no wallet data or arbitrary upstream URLs. */
export async function searchTokensOnServer(input: TokenSearchInput): Promise<TokenSearchResult> {
  const key = `${input.chainId}:${input.query}:${looksLikeAddress(input.query) ? 1 : input.limit}`;
  const existing = cache.get(key);
  if (!input.fresh && existing && existing.expiresAt > Date.now()) return existing.result;
  const running = pending.get(key);
  if (running) return running;
  reserveRequest();
  const request = load(input).then((result) => {
    cache.delete(key);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { result, expiresAt: Date.now() + (result.tokens.length ? TOKEN_CACHE_TTL_MS : 10_000) });
    return result;
  }).finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}

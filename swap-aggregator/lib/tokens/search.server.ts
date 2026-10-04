import "server-only";
import { ApiBoundaryError, readBoundedText, observeApiCache, reserveLifiUpstream } from "../server/api";
import { SEARCH_LIMITS, TOKEN_CACHE_TTL_MS, TokenSearchError, type TokenSearchResult } from "./types";
import { looksLikeAddress, uniqueTokens, validateToken, type TokenSearchInput } from "./validation";
import { sortTokenResults } from "./ranking";

const MAX_CACHE_ENTRIES = 256;
const MAX_IN_FLIGHT = 8;
const cache = new Map<string, { expiresAt: number; result: TokenSearchResult }>();
const pending = new Map<string, Promise<TokenSearchResult>>();
let windowStart = 0;
let requestsInWindow = 0;


/** Same fixed endpoints/parameters as SDK 4.7 actions, with byte bounds before JSON. */
async function requestTokens(input: TokenSearchInput, exact: boolean): Promise<unknown> {
  const url = new URL(exact ? "https://li.quest/v1/token" : "https://li.quest/v1/tokens");
  url.search = new URLSearchParams(exact ? { chain: String(input.chainId), token: input.query } : {
    chains: String(input.chainId), chainTypes: "EVM", extended: "true", minPriceUSD: "0",
    orderBy: "volumeUSD24H", limit: String(input.limit + 1), ...(input.query ? { search: input.query } : {}),
  }).toString();
  const signal = AbortSignal.timeout(8000);
  reserveLifiUpstream();
  const response = await fetch(url.href, { cache: "no-store", redirect: "error", signal,
    headers: { "x-lifi-integrator": "hermes-hms", ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}) } });
  if (!response.ok) {
    void response.body?.cancel();
    if (exact && response.status === 404) return undefined;
    throw new TokenSearchError(response.status === 429 ? "rate_limited" : "tokens_unavailable", response.status === 429 ? 429 : 503);
  }
  return JSON.parse(await readBoundedText(response, 2 * 1024 * 1024, { upstream: true, signal, timeoutMs: 8000 }));
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
    const result = await requestTokens(input, exact);
    if (exact) raw = result === undefined ? [] : [result];
    else {
      if (!result || typeof result !== "object" || !("tokens" in result) || !result.tokens || typeof result.tokens !== "object") throw new TokenSearchError("tokens_unavailable");
      const rows = (result.tokens as Record<number, unknown>)[chainId];
      if (!Array.isArray(rows) || rows.length > 10_000) throw new TokenSearchError("tokens_unavailable");
      raw = rows;
    }
  } catch (error) {
    if (error instanceof ApiBoundaryError && error.status === 429) throw new TokenSearchError("rate_limited", 429);
    if (exact && upstreamStatus(error) === 404) raw = [];
    else throw new TokenSearchError(upstreamStatus(error) === 429 ? "rate_limited" : "tokens_unavailable", upstreamStatus(error) === 429 ? 429 : 503);
  }
  const validated = raw.map((token) => validateToken(token, chainId, exact ? query : undefined));
  if (exact && raw.length && !validated[0]) throw new TokenSearchError("tokens_unavailable");
  const tokens = sortTokenResults(uniqueTokens(validated.filter((token) => token !== null)), query);
  const truncated = !exact && raw.length > limit;
  return { chainId, query, tokens: tokens.slice(0, limit), limit, truncated,
    hasMore: truncated && limit < SEARCH_LIMITS[SEARCH_LIMITS.length - 1], checkedAt: Date.now() };
}

/** Bounded per-process cache and quota; no wallet data or arbitrary upstream URLs. */
export async function searchTokensOnServer(input: TokenSearchInput): Promise<TokenSearchResult> {
  const key = `${input.chainId}:${input.query}:${looksLikeAddress(input.query) ? 1 : input.limit}`;
  const existing = cache.get(key);
  if (!input.fresh && existing && existing.expiresAt > Date.now()) { observeApiCache("tokens.search", true); return existing.result; }
  observeApiCache("tokens.search", false);
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

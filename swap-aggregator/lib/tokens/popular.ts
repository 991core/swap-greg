import { isAppChainId } from "../chains";
import { searchTokens } from "./client";
import { POPULAR_TOKEN_LIMIT, TOKEN_CACHE_TTL_MS, TokenSearchError, type TokenSearchErrorCode, type TokenSearchResult } from "./types";
import { rememberTokenVerdicts } from "./verdicts";
import { fetchMarketUniverse, marketUniverseSnapshot } from "./market-universe";
import { rankTokenResults } from "./ranking";

export type PopularTokenState = {
  status: "loading" | "ready" | "error";
  result?: TokenSearchResult;
  error?: TokenSearchErrorCode;
};
const EMPTY: Readonly<Record<number, PopularTokenState>> = Object.freeze({});
let snapshot = EMPTY;
const listeners = new Set<() => void>();
const pending = new Map<number, { promise: Promise<void>; controller: AbortController }>();
let generation = 0;

export const popularTokensSnapshot = () => snapshot;
export const serverPopularTokensSnapshot = () => EMPTY;
export function subscribePopularTokens(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(chainId: number, state: PopularTokenState) {
  snapshot = Object.freeze({ ...snapshot, [chainId]: state });
  listeners.forEach(listener => listener());
}
function mergeMarket(chainId: number, result: TokenSearchResult): TokenSearchResult {
  const universe = marketUniverseSnapshot().result;
  return universe ? { ...result, tokens: rankTokenResults([], universe.tokens[chainId] ?? [], result.tokens) } : result;
}

async function loadPopularTokens(chainId: number) {
  const cached = snapshot[chainId];
  if (cached?.status === "ready" && cached.result && Date.now() - cached.result.checkedAt < TOKEN_CACHE_TTL_MS) return;
  const running = pending.get(chainId);
  if (running) return running.promise;
  const controller = new AbortController();
  const currentGeneration = generation;
  publish(chainId, { status: "loading", result: cached?.result });
  const promise = (async () => {
    try {
      const result = await searchTokens(chainId, "", { limit: POPULAR_TOKEN_LIMIT, signal: controller.signal });
      if (result.chainId !== chainId || result.query !== "") throw new TokenSearchError("tokens_unavailable");
      if (generation === currentGeneration && !controller.signal.aborted) {
        rememberTokenVerdicts(result.tokens);
        publish(chainId, { status: "ready", result: mergeMarket(chainId, result) });
      }
    } catch (error) {
      if (generation === currentGeneration && !controller.signal.aborted) publish(chainId, {
        status: "error", result: cached?.result,
        error: error instanceof TokenSearchError ? error.code : "tokens_unavailable",
      });
    } finally {
      if (generation === currentGeneration) pending.delete(chainId);
    }
  })();
  pending.set(chainId, { promise, controller });
  return promise;
}

/** Bootstrap discovery independently of picker opening or wallet selection.
 * Two workers bound traffic. Failed chains do not prevent the others loading.
 * A caller leaving stops its queue, but an already shared discovery request can
 * finish in the cache; it contains no wallet state and never signs.
 */
export async function preloadPopularTokens(chainIds: readonly number[], signal?: AbortSignal) {
  const queue = [...new Set(chainIds)].filter(isAppChainId);
  let index = 0;
  const currentGeneration = generation;
  const market = fetchMarketUniverse().then(result => {
    if (signal?.aborted || generation !== currentGeneration) return;
    for (const chainId of queue) {
      const state = snapshot[chainId];
      const tokens = rankTokenResults([], result.tokens[chainId] ?? [], state?.result?.tokens ?? []);
      if (tokens.length) publish(chainId, { status: "ready", result: {
        chainId, query: "", tokens, limit: POPULAR_TOKEN_LIMIT, hasMore: false, truncated: false, checkedAt: Date.now(),
      } });
    }
  });
  const discovery = Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (!signal?.aborted && index < queue.length) await loadPopularTokens(queue[index++]);
  }));
  await Promise.allSettled([market, discovery]);
}

export function resetPopularTokensForTests() {
  if (process.env.NODE_ENV !== "test") throw new Error("test_only");
  generation += 1;
  pending.forEach(({ controller }) => controller.abort());
  pending.clear();
  snapshot = EMPTY;
  listeners.forEach(listener => listener());
}

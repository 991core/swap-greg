import { TokenSearchError, type AppToken, type TokenSearchResult } from "./types";
import { parseTokenSearch, uniqueTokens, validateToken, looksLikeAddress } from "./validation";

export async function searchTokens(chainId: number, query = "", options: { signal?: AbortSignal; limit?: number; fresh?: boolean } = {}): Promise<TokenSearchResult> {
  const params = new URLSearchParams({ chainId: String(chainId), query, limit: String(options.limit ?? 25), fresh: options.fresh ? "1" : "0" });
  const input = parseTokenSearch(params);
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(`/api/tokens/search?${params}`, { cache: "no-store",
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  if (!response.ok) throw new TokenSearchError(response.status === 429 ? "rate_limited" : "tokens_unavailable", response.status);
  const data = await response.json();
  if (data.chainId !== chainId || data.query !== input.query || !Array.isArray(data.tokens) || !Number.isFinite(data.checkedAt)) throw new TokenSearchError("tokens_unavailable");
  const tokens = uniqueTokens(data.tokens.slice(0, input.limit).map((token: unknown) => validateToken(token, chainId, looksLikeAddress(input.query) ? input.query : undefined)).filter((token: AppToken | null): token is AppToken => token !== null));
  return { chainId, query: input.query, tokens, limit: input.limit, hasMore: data.hasMore === true, truncated: data.truncated === true, checkedAt: data.checkedAt };
}

export async function getTokenDetails(chainId: number, address: string, options: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<AppToken | null> {
  if (!looksLikeAddress(address)) throw new TokenSearchError("invalid_address", 400);
  return (await searchTokens(chainId, address, options)).tokens[0] ?? null;
}

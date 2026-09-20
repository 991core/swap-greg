import type { Token } from "@lifi/sdk";

export type AppToken = Token & {
  /** Local UI consent for this chain/address/metadata; never supplied by the API. */
  riskAcknowledged?: boolean;
};

export const SEARCH_LIMITS = [25, 50, 100, 200] as const;
export const TOKEN_CACHE_TTL_MS = 60_000;
export type TokenSearchResult = {
  chainId: number;
  query: string;
  tokens: AppToken[];
  limit: number;
  hasMore: boolean;
  truncated: boolean;
  checkedAt: number;
};

export type TokenSearchErrorCode = "invalid_search" | "invalid_address" | "rate_limited" | "tokens_unavailable";
export class TokenSearchError extends Error {
  constructor(public readonly code: TokenSearchErrorCode, public readonly status = 503) { super(code); }
}

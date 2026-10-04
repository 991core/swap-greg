import type { TokenProvider, TokenSourceResult } from "../types";
export type MarketProvider = Extract<TokenProvider, "coingecko" | "coinmarketcap">;
export type TopAsset = {
  provider: MarketProvider; providerAssetId: string; symbol: string; name: string;
  marketCap: number; marketCapRank: number;
};
export type ProviderFailure = { provider: TokenProvider; chainId: number; reason: string };
export type ProviderResolution = { results: TokenSourceResult[]; unavailable: ProviderFailure[] };
export class SecurityProviderError extends Error {
  constructor(public provider: TokenProvider, public reason: string, public status = 503) { super(`Token provider ${provider}: ${reason}`); }
}
export function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function safeText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value);
}
export function normalizeAddress(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !/^0x[\da-f]{40}$/i.test(value)) return undefined;
  return /^0x0{40}$/i.test(value) ? null : value.toLowerCase();
}
export function validDecimals(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255; }

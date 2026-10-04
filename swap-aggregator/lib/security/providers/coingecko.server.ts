import "server-only";
import type { TokenSourceResult } from "../types";
import { APP_CHAIN_IDS } from "../../chains";
import { marketProviderUrl, requestSecurityProvider } from "./transport.server";
import { isRecord, normalizeAddress, safeText, SecurityProviderError, validDecimals, type TopAsset } from "./types";
export const CG_PLATFORMS: Record<number, string> = { 1: "ethereum", 10: "optimistic-ethereum", 56: "binance-smart-chain", 100: "xdai", 137: "polygon-pos", 8453: "base", 42161: "arbitrum-one", 43114: "avalanche", 1088: "metis-andromeda" };
function validId(id: string) { if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) throw new SecurityProviderError("coingecko", "invalid_asset_id", 400); }
export async function getCoinGeckoTopAssets(limit: number): Promise<TopAsset[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new SecurityProviderError("coingecko", "invalid_limit", 400);
  const url = marketProviderUrl("coingecko", "/coins/markets"); url.search = new URLSearchParams({ vs_currency: "usd", order: "market_cap_desc", per_page: String(limit), page: "1", sparkline: "false" }).toString();
  const data = await requestSecurityProvider("coingecko", url, { ttlMs: 300_000 });
  if (!Array.isArray(data) || data.length > limit) throw new SecurityProviderError("coingecko", "invalid_response");
  const ids = new Set<string>(); const results: TopAsset[] = [];
  for (const item of data) {
    if (!isRecord(item) || !safeText(item.id, 128) || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(item.id) || !safeText(item.symbol, 64) || !safeText(item.name, 128) || typeof item.market_cap !== "number" || !Number.isFinite(item.market_cap) || item.market_cap < 0 || !Number.isSafeInteger(item.market_cap_rank) || Number(item.market_cap_rank) < 1 || ids.has(item.id)) throw new SecurityProviderError("coingecko", "invalid_response");
    ids.add(item.id); results.push({ provider: "coingecko", providerAssetId: item.id, symbol: item.symbol, name: item.name, marketCap: item.market_cap, marketCapRank: Number(item.market_cap_rank) });
  }
  if (!results.length) throw new SecurityProviderError("coingecko", "empty_universe");
  return results.sort((a, b) => a.marketCapRank - b.marketCapRank || a.providerAssetId.localeCompare(b.providerAssetId));
}
/** This bounded map provides discovery evidence only, never an identity crosswalk. */
export async function getCoinGeckoPlatformList() {
  const url = marketProviderUrl("coingecko", "/coins/list"); url.searchParams.set("include_platform", "true");
  const data = await requestSecurityProvider("coingecko", url, { ttlMs: 300_000 });
  if (!Array.isArray(data) || data.length > 30_000) throw new SecurityProviderError("coingecko", "invalid_response");
  const result = new Map<string, Record<number, string | null>>();
  for (const item of data) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(item.id) || !isRecord(item.platforms)) continue;
    if (result.has(item.id)) throw new SecurityProviderError("coingecko", "ambiguous_asset");
    const platforms: Record<number, string | null> = {};
    for (const chainId of APP_CHAIN_IDS) { const raw = item.platforms[CG_PLATFORMS[chainId]]; if (raw === undefined || raw === "") continue; const address = normalizeAddress(raw); if (address === undefined) throw new SecurityProviderError("coingecko", "invalid_address"); platforms[chainId] = address; }
    result.set(item.id, platforms);
  }
  return result;
}
export async function getCoinGeckoMetadata(id: string, fresh = false): Promise<Record<string, unknown>> {
  validId(id);
  const url = marketProviderUrl("coingecko", `/coins/${id}`); url.search = new URLSearchParams({ localization: "false", tickers: "false", market_data: "false", community_data: "false", developer_data: "false" }).toString();
  const data = await requestSecurityProvider("coingecko", url, { fresh });
  if (!isRecord(data) || data.id !== id) throw new SecurityProviderError("coingecko", "asset_id_mismatch");
  return data;
}
export function normalizeCoinGeckoAsset(id: string, chainId: number, data: Record<string, unknown>, nativeBinding = false): TokenSourceResult {
  validId(id); if (!CG_PLATFORMS[chainId] || data.id !== id) throw new SecurityProviderError("coingecko", "asset_id_mismatch");
  const base = { provider: "coingecko" as const, providerAssetId: id, chainId, ...(safeText(data.symbol, 64) ? { symbol: data.symbol } : {}), fetchedAt: new Date().toISOString(), lookupMode: "asset-id" as const };
  if (nativeBinding) {
    if (data.asset_platform_id !== null) throw new SecurityProviderError("coingecko", "native_asset_mismatch");
    return { ...base, tokenType: "native", address: null };
  }
  const platform = CG_PLATFORMS[chainId]; const raw = isRecord(data.detail_platforms) ? data.detail_platforms[platform] : undefined;
  if (!isRecord(raw)) throw new SecurityProviderError("coingecko", "chain_deployment_unavailable");
  const address = normalizeAddress(raw.contract_address); if (address === undefined) throw new SecurityProviderError("coingecko", "invalid_address");
  const listAddress = isRecord(data.platforms) ? normalizeAddress(data.platforms[platform]) : undefined;
  if (listAddress !== undefined && listAddress !== address) throw new SecurityProviderError("coingecko", "ambiguous_deployment");
  return { ...base, tokenType: address === null ? "native" : "contract", address, ...(validDecimals(raw.decimal_place) ? { decimals: raw.decimal_place } : {}) };
}
export async function resolveCoinGeckoAsset(id: string, chainId: number, options: { nativeBinding?: boolean; fresh?: boolean } = {}): Promise<TokenSourceResult> {
  return normalizeCoinGeckoAsset(id, chainId, await getCoinGeckoMetadata(id, options.fresh), options.nativeBinding);
}

import "server-only";
import type { TokenSourceResult } from "../types";
import { marketProviderUrl, requestSecurityProvider } from "./transport.server";
import { isRecord, normalizeAddress, safeText, SecurityProviderError, type TopAsset } from "./types";
// Protocol platform identifiers, not ticker matches. Unknown platforms remain unavailable.
export const CMC_PLATFORM_SLUGS: Record<number, readonly string[]> = { 1: ["ethereum"], 10: ["optimism"], 56: ["bnb", "binance-coin"], 100: ["xdai", "gnosis"], 137: ["polygon", "polygon-ecosystem-token"], 8453: ["base"], 42161: ["arbitrum"], 43114: ["avalanche"], 1088: ["metisdao", "metis"] };
function assertId(id: string) { if (!/^[1-9]\d{0,11}$/.test(id)) throw new SecurityProviderError("coinmarketcap", "invalid_asset_id", 400); }
function validEnvelope(data: unknown): asserts data is Record<string, unknown> & { data: unknown } {
  if (!isRecord(data) || !isRecord(data.status) || data.status.error_code !== 0) throw new SecurityProviderError("coinmarketcap", "invalid_response");
}
export async function getCoinMarketCapTopAssets(limit: number): Promise<TopAsset[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new SecurityProviderError("coinmarketcap", "invalid_limit", 400);
  const url = marketProviderUrl("coinmarketcap", process.env.CMC_API_KEY ? "/v1/cryptocurrency/listings/latest" : "/v3/cryptocurrency/listings/latest");
  url.search = new URLSearchParams({ start: "1", limit: String(limit), convert: "USD", sort: "market_cap", sort_dir: "desc" }).toString();
  const data = await requestSecurityProvider("coinmarketcap", url, { ttlMs: 300_000 }); validEnvelope(data);
  if (!Array.isArray(data.data) || data.data.length > limit) throw new SecurityProviderError("coinmarketcap", "invalid_response");
  const ids = new Set<string>(); const result: TopAsset[] = [];
  for (const item of data.data) {
    if (!isRecord(item) || !Number.isSafeInteger(item.id) || Number(item.id) < 1 || !safeText(item.symbol, 64) || !safeText(item.name, 128) || !Number.isSafeInteger(item.cmc_rank) || Number(item.cmc_rank) < 1) throw new SecurityProviderError("coinmarketcap", "invalid_response");
    const id = String(item.id); assertId(id); if (ids.has(id)) throw new SecurityProviderError("coinmarketcap", "ambiguous_asset"); ids.add(id);
    const usd = isRecord(item.quote) ? item.quote.USD : Array.isArray(item.quote) ? item.quote.filter(value => isRecord(value) && value.id === 2781) : undefined;
    const quote = Array.isArray(usd) && usd.length === 1 ? usd[0] : usd;
    if (!isRecord(quote) || typeof quote.market_cap !== "number" || !Number.isFinite(quote.market_cap) || quote.market_cap < 0) throw new SecurityProviderError("coinmarketcap", "invalid_response");
    result.push({ provider: "coinmarketcap", providerAssetId: id, symbol: item.symbol, name: item.name, marketCap: quote.market_cap, marketCapRank: Number(item.cmc_rank) });
  }
  if (!result.length) throw new SecurityProviderError("coinmarketcap", "empty_universe");
  return result.sort((a, b) => a.marketCapRank - b.marketCapRank || Number(a.providerAssetId) - Number(b.providerAssetId));
}
export async function getCoinMarketCapMetadata(id: string, fresh = false): Promise<Record<string, unknown>> {
  assertId(id);
  const url = marketProviderUrl("coinmarketcap", "/v2/cryptocurrency/info"); url.search = new URLSearchParams({ id, aux: "platform", skip_invalid: "false" }).toString();
  const data = await requestSecurityProvider("coinmarketcap", url, { fresh }); validEnvelope(data);
  if (!isRecord(data.data)) throw new SecurityProviderError("coinmarketcap", "invalid_response");
  const raw = data.data[id]; const item = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (!isRecord(item) || String(item.id) !== id) throw new SecurityProviderError("coinmarketcap", Array.isArray(raw) ? "ambiguous_deployment" : "asset_id_mismatch");
  return item;
}
export function normalizeCoinMarketCapAsset(id: string, chainId: number, item: Record<string, unknown>, nativeBinding = false): TokenSourceResult {
  assertId(id); if (!CMC_PLATFORM_SLUGS[chainId] || String(item.id) !== id) throw new SecurityProviderError("coinmarketcap", "asset_id_mismatch");
  const base = { provider: "coinmarketcap" as const, providerAssetId: id, chainId, fetchedAt: new Date().toISOString(), lookupMode: "asset-id" as const, ...(safeText(item.symbol, 64) ? { symbol: item.symbol } : {}) };
  if (nativeBinding) {
    if (item.platform !== null || item.category !== "coin") throw new SecurityProviderError("coinmarketcap", "native_asset_mismatch");
    return { ...base, tokenType: "native", address: null };
  }
  const addresses = new Set<string | null>();
  if (isRecord(item.platform) && typeof item.platform.slug === "string" && CMC_PLATFORM_SLUGS[chainId].includes(item.platform.slug)) {
    const address = normalizeAddress(item.platform.token_address); if (address === undefined) throw new SecurityProviderError("coinmarketcap", "invalid_address"); addresses.add(address);
  }
  // Current public v2 info also supplies deployment rows keyed by platform.coin.slug.
  // Multiple addresses on one protocol are never resolved by rank, symbol or order.
  if (item.contract_address !== undefined) {
    if (!Array.isArray(item.contract_address) || item.contract_address.length > 256) throw new SecurityProviderError("coinmarketcap", "invalid_response");
    for (const row of item.contract_address) {
      if (!isRecord(row) || !isRecord(row.platform) || !isRecord(row.platform.coin) || typeof row.platform.coin.slug !== "string" || !CMC_PLATFORM_SLUGS[chainId].includes(row.platform.coin.slug)) continue;
      const address = normalizeAddress(row.contract_address); if (address === undefined) throw new SecurityProviderError("coinmarketcap", "invalid_address"); addresses.add(address);
    }
  }
  if (addresses.size !== 1) throw new SecurityProviderError("coinmarketcap", addresses.size ? "ambiguous_deployment" : "chain_deployment_unavailable");
  const address = [...addresses][0];
  return { ...base, tokenType: address === null ? "native" : "contract", address };
}
export async function resolveCoinMarketCapAsset(id: string, chainId: number, options: { nativeBinding?: boolean; fresh?: boolean } = {}): Promise<TokenSourceResult> {
  return normalizeCoinMarketCapAsset(id, chainId, await getCoinMarketCapMetadata(id, options.fresh), options.nativeBinding);
}

/** One bounded stable-ID metadata batch avoids N provider requests during discovery. */
export async function getCoinMarketCapMetadataBatch(ids: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length || ids.length > 250 || new Set(ids).size !== ids.length) throw new SecurityProviderError("coinmarketcap", "invalid_asset_id", 400);
  ids.forEach(assertId); const url = marketProviderUrl("coinmarketcap", "/v2/cryptocurrency/info");
  url.search = new URLSearchParams({ id: ids.join(","), aux: "platform", skip_invalid: "true" }).toString();
  const data = await requestSecurityProvider("coinmarketcap", url); validEnvelope(data);
  if (!isRecord(data.data)) throw new SecurityProviderError("coinmarketcap", "invalid_response");
  const result = new Map<string, Record<string, unknown>>();
  for (const id of ids) { const item = data.data[id]; if (isRecord(item) && String(item.id) === id) result.set(id, item); }
  return result;
}

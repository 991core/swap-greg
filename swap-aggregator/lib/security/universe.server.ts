import "server-only";
import { APP_CHAIN_IDS } from "../chains";
import type { AppToken } from "../tokens/types";
import { getPopularTokens } from "../tokens/catalog";
import { uniqueTokens } from "../tokens/validation";
import { getCoinGeckoTopAssets, getCoinGeckoPlatformList, getCoinGeckoMetadata, normalizeCoinGeckoAsset } from "./providers/coingecko.server";
import { getCoinMarketCapTopAssets, getCoinMarketCapMetadataBatch, normalizeCoinMarketCapAsset } from "./providers/coinmarketcap.server";
import { getLiFiDiscovery, getLiFiTokenByAddress } from "./providers/lifi.server";
import { SecurityProviderError, type MarketProvider, type ProviderFailure, type TopAsset } from "./providers/types";
import type { TokenSourceResult } from "./types";
export type MarketUniverse = {
  source: MarketProvider | null; fetchedAt: string; assets: TopAsset[]; targetSize: number; fetchLimit: number;
  tokens: Record<number, AppToken[]>; resolutions: Array<{ assetId: string; providerAssetId: string; chainId: number; status: "manual_review"; sources: TokenSourceResult[]; unavailable: ProviderFailure[] }>;
  failures: ProviderFailure[]; enriching: boolean;
};
function positiveConfig(name: string, fallback: number, maximum: number) {
  const text = process.env[name] ?? String(fallback); const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new SecurityProviderError("coingecko", "invalid_configuration", 503);
  return value;
}
export function universeConfiguration(): { primary: MarketProvider; fetchLimit: number; targetSize: number } {
  const primary = process.env.TOP_ASSET_PRIMARY_PROVIDER ?? "coingecko";
  if (primary !== "coingecko" && primary !== "coinmarketcap") throw new SecurityProviderError("coingecko", "invalid_configuration");
  const fetchLimit = positiveConfig("TOP_ASSET_FETCH_LIMIT", 120, 250); const targetSize = positiveConfig("TARGET_UNIVERSE_SIZE", 100, 250);
  if (targetSize > fetchLimit) throw new SecurityProviderError(primary, "invalid_configuration");
  return { primary, fetchLimit, targetSize };
}
/** One market ranking, an explicitly reported fallback, and no LI.FI ranking votes. */
export async function getTopAssets(): Promise<{ source: MarketProvider; fetchedAt: string; assets: TopAsset[]; targetSize: number; fetchLimit: number; failures: ProviderFailure[] }> {
  const { primary, fetchLimit, targetSize } = universeConfiguration(); const fallback = primary === "coingecko" ? "coinmarketcap" : "coingecko";
  const failures: ProviderFailure[] = [];
  for (const provider of [primary, fallback] as const) {
    try {
      const assets = provider === "coingecko" ? await getCoinGeckoTopAssets(fetchLimit) : await getCoinMarketCapTopAssets(fetchLimit);
      return { source: provider, fetchedAt: new Date().toISOString(), assets, targetSize, fetchLimit, failures };
    } catch (error) { failures.push({ provider, chainId: 0, reason: error instanceof SecurityProviderError ? error.reason : "upstream_unavailable" }); }
  }
  throw new SecurityProviderError(primary, "market_universe_unavailable");
}
let cache: { expiresAt: number; result: MarketUniverse; config: string } | undefined;
let pending: { config: string; promise: Promise<MarketUniverse> } | undefined;
/** Discovery output is untrusted display data. No source can grant registry trust. */
export async function getMarketUniverse(): Promise<MarketUniverse> {
  const config = JSON.stringify(universeConfiguration());
  if (cache && cache.config === config && (cache.expiresAt > Date.now() || cache.result.enriching)) return cache.result;
  if (pending?.config === config) return pending.promise;
  if (pending) throw new SecurityProviderError("coingecko", "universe_busy", 429);
  const promise = (async () => {
    const initialConfiguration = universeConfiguration();
    const platformPromise = initialConfiguration.primary === "coingecko" ? getCoinGeckoPlatformList().then(value => ({ value }), error => ({ error })) : undefined;
    const topPromise = getTopAssets(); const discoveryPromise = getLiFiDiscovery();
    const [topResult, discoveryResult] = await Promise.allSettled([topPromise, discoveryPromise]);
    const configuration = universeConfiguration();
    const top = topResult.status === "fulfilled" ? topResult.value : {
      source: null, fetchedAt: new Date().toISOString(), assets: [] as TopAsset[], targetSize: configuration.targetSize, fetchLimit: configuration.fetchLimit,
      failures: (["coingecko", "coinmarketcap"] as const).map(provider => ({ provider, chainId: 0, reason: "market_universe_unavailable" })),
    };
    const failures = [...top.failures];
    const rankingSource = top.source ?? "coingecko";
    const tokens: Record<number, AppToken[]> = Object.fromEntries(APP_CHAIN_IDS.map(chainId => [chainId, getPopularTokens(chainId)]));
    if (discoveryResult.status === "fulfilled") {
      for (const chainId of APP_CHAIN_IDS) tokens[chainId] = uniqueTokens([...tokens[chainId], ...discoveryResult.value.tokens[chainId].map(token => {
        // Market ranking is supplied only by the selected market provider; LI.FI metrics do not create an average.
        const { marketCapUSD: _marketCap, volumeUSD24H: _volume, ...display } = token; return display;
      })]);
    } else failures.push({ provider: "lifi", chainId: 0, reason: discoveryResult.reason instanceof SecurityProviderError ? discoveryResult.reason.reason : "upstream_unavailable" });
    const resolutions: MarketUniverse["resolutions"] = [];
    let platforms: Awaited<ReturnType<typeof getCoinGeckoPlatformList>> | undefined;
    const metadata = new Map<string, Record<string, unknown>>();
    if (top.source === "coingecko") {
      const platformResult = platformPromise ? await platformPromise : await getCoinGeckoPlatformList().then(value => ({ value }), error => ({ error }));
      if ("value" in platformResult) platforms = platformResult.value;
      else {
        failures.push({ provider: "coingecko", chainId: 0, reason: platformResult.error instanceof SecurityProviderError ? platformResult.error.reason : "platforms_unavailable" });
        // One bounded wave, rather than 120 cold requests consuming the whole quota.
        await Promise.all(top.assets.slice(0, 4).map(async asset => {
          try { metadata.set(asset.providerAssetId, await getCoinGeckoMetadata(asset.providerAssetId)); } catch { /* Explicit unavailable below. */ }
        }));
      }
    } else if (top.source === "coinmarketcap") {
      try { for (const [id, item] of await getCoinMarketCapMetadataBatch(top.assets.map(asset => asset.providerAssetId))) metadata.set(id, item); }
      catch (error) { failures.push({ provider: "coinmarketcap", chainId: 0, reason: error instanceof SecurityProviderError ? error.reason : "metadata_unavailable" }); }
    }
    // Display-only protocol/native bindings, sourced from chain metadata and stable market IDs.
    // They never enter providerAssetIds, consensus, or the trusted registry.
    const nativeIds: Record<MarketProvider, Record<number, string>> = {
      coingecko: { 1: "ethereum", 10: "ethereum", 8453: "ethereum", 42161: "ethereum", 56: "binancecoin", 137: "polygon-ecosystem-token", 43114: "avalanche-2", 1088: "metis-token", 100: "xdai" },
      coinmarketcap: { 1: "1027", 10: "1027", 8453: "1027", 42161: "1027", 56: "1839", 137: "28321", 43114: "5805" },
    };
    const identities = new Map<string, TopAsset | null>();
    const missingDisplay: Array<{ chainId: number; address: string | null }> = [];
    for (const asset of top.assets) {
      const assetId = `${top.source}:${asset.providerAssetId}`;
      for (const chainId of APP_CHAIN_IDS) {
        const sources: TokenSourceResult[] = []; const unavailable: ProviderFailure[] = [];
        try {
          let primary: TokenSourceResult;
          if (nativeIds[rankingSource][chainId] === asset.providerAssetId) primary = { provider: rankingSource, providerAssetId: asset.providerAssetId, chainId, tokenType: "native", address: null, symbol: asset.symbol, fetchedAt: top.fetchedAt, lookupMode: "local-binding" };
          else if (top.source === "coingecko" && platforms) {
            const address = platforms.get(asset.providerAssetId)?.[chainId];
            if (address === undefined) throw new SecurityProviderError("coingecko", "chain_deployment_unavailable");
            primary = { provider: "coingecko", providerAssetId: asset.providerAssetId, chainId, tokenType: address === null ? "native" : "contract", address, symbol: asset.symbol, fetchedAt: top.fetchedAt, lookupMode: "asset-id" };
          } else {
            const item = metadata.get(asset.providerAssetId); if (!item) throw new SecurityProviderError(rankingSource, "metadata_unavailable");
            primary = top.source === "coingecko" ? normalizeCoinGeckoAsset(asset.providerAssetId, chainId, item) : normalizeCoinMarketCapAsset(asset.providerAssetId, chainId, item);
          }
          sources.push({ ...primary, assetId });
          const key = `${chainId}:${primary.address ?? "native"}`; identities.set(key, identities.has(key) ? null : asset);
          const token = tokens[chainId].find(item => item.address.toLowerCase() === (primary.address ?? "0x0000000000000000000000000000000000000000"));
          if (!token) missingDisplay.push({ chainId, address: primary.address });
          else sources.push({ provider: "lifi", assetId, chainId, tokenType: primary.address === null ? "native" : "contract", address: primary.address, decimals: token.decimals, symbol: token.symbol, fetchedAt: top.fetchedAt, lookupMode: "candidate-bound" });
        } catch (error) { unavailable.push({ provider: rankingSource, chainId, reason: error instanceof SecurityProviderError ? error.reason : "metadata_unavailable" }); }
        unavailable.push({ provider: rankingSource === "coingecko" ? "coinmarketcap" : "coingecko", chainId, reason: "independent_asset_binding_unavailable" });
        unavailable.push({ provider: "lifi", chainId, reason: "independent_asset_binding_unavailable" });
        resolutions.push({ assetId, providerAssetId: asset.providerAssetId, chainId, status: "manual_review", sources, unavailable });
      }
    }
    for (const chainId of APP_CHAIN_IDS) for (const token of tokens[chainId]) {
      const address = /^0x0{40}$/i.test(token.address) ? "native" : token.address.toLowerCase(); const asset = identities.get(`${chainId}:${address}`);
      if (asset) { token.marketCapUSD = asset.marketCap; token.marketSource = rankingSource; }
      else { delete token.marketCapUSD; delete token.marketSource; }
    }
    resolutions.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.chainId - b.chainId);
    const candidates = [...new Map(missingDisplay.map(candidate => [`${candidate.chainId}:${candidate.address ?? "native"}`, candidate])).values()];
    const result: MarketUniverse = { ...top, tokens, resolutions, failures, enriching: candidates.length > 0 };
    // Read-only enrichment queues every resolved identity; quotas pause the queue instead of truncating it.
    let missingIndex = 0;
    const enrichmentDeadline = Date.now() + 180_000;
    void Promise.all(Array.from({ length: 3 }, async () => {
      while (missingIndex < candidates.length && Date.now() < enrichmentDeadline) {
        const candidate = candidates[missingIndex++];
        for (let retry = 0; retry < 3; retry++) {
          // A newer snapshot owns enrichment; obsolete background work may not consume new budgets.
          if ((cache && cache.result !== result) || Date.now() >= enrichmentDeadline) break;
          try {
            const token = await getLiFiTokenByAddress(candidate.chainId, candidate.address);
            const asset = identities.get(`${candidate.chainId}:${candidate.address ?? "native"}`);
            if (asset) { token.marketCapUSD = asset.marketCap; token.marketSource = rankingSource; }
            tokens[candidate.chainId] = uniqueTokens([...tokens[candidate.chainId], token]);
            break;
          } catch (error) {
            if (!(error instanceof SecurityProviderError && error.reason === "rate_limited") || retry === 2) break;
            // Bounded read-only retry after quota windows; never an emission retry.
            await new Promise(resolve => setTimeout(resolve, 60_000 + Math.floor(Math.random() * 5000)));
          }
        }
      }
    })).finally(() => {
      result.enriching = false;
      if (missingIndex < candidates.length) result.failures.push({ provider: "lifi", chainId: 0, reason: "enrichment_incomplete" });
    });
    cache = { config, expiresAt: Date.now() + 60_000, result }; return result;
  })().finally(() => { pending = undefined; });
  pending = { config, promise }; return promise;
}

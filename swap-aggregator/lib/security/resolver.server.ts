import "server-only";
import type { TokenSourceResult, TrustedTokenEntry } from "./types";
import { resolveCoinGeckoAsset } from "./providers/coingecko.server";
import { resolveCoinMarketCapAsset } from "./providers/coinmarketcap.server";
import { resolveLiFiAsset, resolveLiFiCandidate } from "./providers/lifi.server";
import { SecurityProviderError, type ProviderResolution } from "./providers/types";
/** Explicit provider IDs are local bindings. A ticker never creates a cross-provider link. */
export async function resolveTokenSources(entry: TrustedTokenEntry, fresh = true): Promise<ProviderResolution> {
  const results: TokenSourceResult[] = []; const unavailable: ProviderResolution["unavailable"] = [];
  const bindings = entry.providerAssetIds ?? {};
  await Promise.all((["coingecko", "coinmarketcap", "lifi"] as const).map(async provider => {
    try {
      const id = bindings[provider]; let result: TokenSourceResult;
      if (provider === "coingecko") { if (!id) throw new SecurityProviderError(provider, "asset_binding_unavailable"); result = await resolveCoinGeckoAsset(id, entry.chainId, { nativeBinding: entry.type === "native", fresh }); }
      else if (provider === "coinmarketcap") { if (!id) throw new SecurityProviderError(provider, "asset_binding_unavailable"); result = await resolveCoinMarketCapAsset(id, entry.chainId, { nativeBinding: entry.type === "native", fresh }); }
      else result = id ? await resolveLiFiAsset(id, entry.chainId, fresh) : await resolveLiFiCandidate(entry.chainId, entry.address, fresh);
      results.push({ ...result, assetId: entry.assetId });
      if (result.lookupMode === "candidate-bound") unavailable.push({ provider, chainId: entry.chainId, reason: "independent_asset_binding_unavailable" });
    } catch (error) { unavailable.push({ provider, chainId: entry.chainId, reason: error instanceof SecurityProviderError ? error.reason : "upstream_unavailable" }); }
  }));
  return { results: results.sort((a, b) => a.provider.localeCompare(b.provider)), unavailable: unavailable.sort((a, b) => a.provider.localeCompare(b.provider)) };
}

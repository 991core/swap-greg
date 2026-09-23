import { assetKey, NATIVE, validDecimal } from "./amounts.ts";
import { list, object } from "./http.ts";
import type { JsonHttp } from "./http.ts";
import { readAsset } from "./providers.ts";
import type { Asset, Valuation } from "./types.ts";

export interface DiscoveryResult {
  pivots: Asset[];
  errors: string[];
  omitted: number;
  sources: string[];
}

/** A common comparison currency, not an executable swap rate. */
export async function fetchValuation(http: JsonHttp, asset: Asset, now: () => number = Date.now): Promise<Valuation> {
  const url = `https://api.relay.link/currencies/token/price?chainId=${asset.chainId}&address=${asset.address}`;
  const price = String(object(await http(url)).price);
  if (!validDecimal(price) || !/[1-9]/.test(price)) throw new Error("No usable destination-token USD valuation");
  const timestamp = now();
  return { usdPerToken: price, observedAt: timestamp, expiresAt: timestamp + 60000, source: url };
}

/** Metadata nominates candidates, never proves liquidity or an executable connection. */
export async function discoverPivots(http: JsonHttp, chainIds: number[], maxPerChain = 4): Promise<DiscoveryResult> {
  if (!Number.isInteger(maxPerChain) || maxPerChain < 1 || maxPerChain > 8) throw new Error("maxPerChain must be 1–8");
  const ids = [...new Set(chainIds)];
  const candidates = new Map<string, { asset: Asset; rank: number }>();
  const priority = ["USDC", "USDT", "DAI", "WETH", "ETH", "WBTC"];
  const result: DiscoveryResult = { pivots: [], errors: [], omitted: 0, sources: [] };
  function add(asset: Asset, family: unknown): void {
    if (!ids.includes(asset.chainId)) return;
    const rank = asset.address.toLowerCase() === NATIVE ? -1 : priority.indexOf(String(family).toUpperCase());
    if (rank < 0 && asset.address.toLowerCase() !== NATIVE) return;
    // Different addresses stay different even when the provider uses the same symbol.
    const key = assetKey(asset);
    if (candidates.has(key) && candidates.get(key)!.asset.decimals !== asset.decimals) throw new Error(`Conflicting metadata: ${key}`);
    candidates.set(key, { asset, rank });
  }
  const sources = ["https://api.relay.link/chains", `https://li.quest/v1/tokens?chains=${ids.join(",")}`];
  const responses = await Promise.allSettled(sources.map((url) => http(url)));
  responses.forEach((response, i) => {
    if (response.status === "rejected") { result.errors.push(`${sources[i]}: ${String(response.reason)}`); return; }
    try {
      if (i === 0) {
        for (const c of list(object(response.value).chains)) {
          const chain = object(c);
          if (!ids.includes(chain.id as number) || chain.vmType !== "evm") continue;
          const tokens = [...list(chain.solverCurrencies ?? []), ...(chain.currency ? [chain.currency] : [])];
          for (const t of tokens) { const token = object(t); add(readAsset({ ...token, chainId: chain.id }), token.id); }
        }
      } else {
        const tokens = object(object(response.value).tokens);
        for (const id of ids) for (const t of list(tokens[String(id)] ?? [])) {
          const token = object(t); add(readAsset(token), token.coinKey);
        }
      }
      result.sources.push(sources[i]);
    } catch (e) { result.errors.push(`${sources[i]}: ${String(e)}`); }
  });
  for (const chainId of ids) {
    const items = [...candidates.values()].filter((c) => c.asset.chainId === chainId)
      .sort((a, b) => a.rank - b.rank || assetKey(a.asset).localeCompare(assetKey(b.asset)));
    result.pivots.push(...items.slice(0, maxPerChain).map((c) => c.asset));
    result.omitted += Math.max(0, items.length - maxPerChain);
  }
  return result;
}

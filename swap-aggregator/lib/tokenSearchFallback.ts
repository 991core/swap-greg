/**
 * Fallback search for tokens that are NOT in the LI.FI allowlist (TOP 20).
 *
 * Strategy:
 * 1. Try CoinGecko `/simple/price` with contract addresses from token lists
 * 2. Try CoinGecko `/search` endpoint by name/symbol
 * 3. Try explorer APIs for contract address lookup
 */

import type { AppToken } from '@/lib/lifi';

/**
 * Common tokens that are NOT in TOP 20 but are popular.
 * Keyed by {chainId, symbol} → partial AppToken with CoinGecko ID.
 */
const POPULAR_NON_TOP20: Record<string, { symbol: string; name: string; decimals: number; coingeckoId: string }> = {
  // Ethereum
  '1:PEPE': { symbol: 'PEPE', name: 'Pepe', decimals: 18, coingeckoId: 'pepe' },
  '1:WLD': { symbol: 'WLD', name: 'Worldcoin', decimals: 18, coingeckoId: 'worldcoin-wld' },
  '1:AERO': { symbol: 'AERO', name: 'Aerodrome Finance', decimals: 18, coingeckoId: 'aerodrome' },
  '1:UNFI': { symbol: 'UNFI', name: 'Unifi Protocol DAO', decimals: 18, coingeckoId: 'unifi-protocol-dao' },
  '1:ENS': { symbol: 'ENS', name: 'Ethereum Name Service', decimals: 18, coingeckoId: 'ethereum-name-service' },
  '1:LDO': { symbol: 'LDO', name: 'Lido DAO', decimals: 18, coingeckoId: 'lido-dao' },
  '1:RPL': { symbol: 'RPL', name: 'Rocket Pool', decimals: 18, coingeckoId: 'rocket-pool' },
  '1:RENDER': { symbol: 'RENDER', name: 'Render Token', decimals: 18, coingeckoId: 'render-token' },
  '1:FET': { symbol: 'FET', name: 'Fetch.ai', decimals: 18, coingeckoId: 'fetch-ai' },
  '1:INJ': { symbol: 'INJ', name: 'Injective', decimals: 18, coingeckoId: 'injective-protocol' },
  '1:TIA': { symbol: 'TIA', name: 'Celestia', decimals: 18, coingeckoId: 'celestia' },
  '1:SEI': { symbol: 'SEI', name: 'Sei', decimals: 18, coingeckoId: 'sei-network' },
  '1:SUI': { symbol: 'SUI', name: 'Sui', decimals: 18, coingeckoId: 'sui' },
  '1:IMX': { symbol: 'IMX', name: 'Immutable X', decimals: 18, coingeckoId: 'immutable-x' },
  '1:GMX': { symbol: 'GMX', name: 'GMX', decimals: 18, coingeckoId: 'gmx' },
  '1:STX': { symbol: 'STX', name: 'Blockstack', decimals: 18, coingeckoId: 'blockstack' },
  '1:ANKR': { symbol: 'ANKR', name: 'Ankr', decimals: 18, coingeckoId: 'ankr' },
  '1:MANA': { symbol: 'MANA', name: 'Decentraland', decimals: 18, coingeckoId: 'decentraland' },
  '1:SAND': { symbol: 'SAND', name: 'The Sandbox', decimals: 18, coingeckoId: 'the-sandbox' },
  '1:AXS': { symbol: 'AXS', name: 'Axie Infinity', decimals: 18, coingeckoId: 'axie-infinity' },

  // Optimism
  '10:OP': { symbol: 'OP', name: 'Optimism', decimals: 18, coingeckoId: 'optimism' },

  // Base (7465501 - not in LI.FI but common)
  // '7465501:' skipped - Base not configured

  // Arbitrum
  '42161:ARB': { symbol: 'ARB', name: 'Arbitrum', decimals: 18, coingeckoId: 'arbitrum' },
  '42161:GMX': { symbol: 'GMX', name: 'GMX', decimals: 18, coingeckoId: 'gmx' },
  '42161:UNI': { symbol: 'UNI', name: 'Uniswap', decimals: 18, coingeckoId: 'uniswap' },

  // Polygon
  '137:SAND': { symbol: 'SAND', name: 'The Sandbox', decimals: 18, coingeckoId: 'the-sandbox' },
  '137:MANA': { symbol: 'MANA', name: 'Decentraland', decimals: 18, coingeckoId: 'decentraland' },

  // BSC
  '56:CAKE': { symbol: 'CAKE', name: 'PancakeSwap', decimals: 18, coingeckoId: 'pancakeswap-token' },
  '56:BNB': { symbol: 'BNB', name: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },

  // Avalanche
  '43114:AVAX': { symbol: 'AVAX', name: 'Avalanche', decimals: 18, coingeckoId: 'avalanche-2' },
};

/**
 * Chain ID → CoinGecko coin ID mapping.
 */
const CHAIN_COINGECKO_MAP: Record<number, string> = {
  1: 'ethereum',
  10: 'optimistic-ethereum',
  100: 'xdai',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  42161: 'arbitrum-one',
  43114: 'avalanche',
  1151111081099710: 'solana',
  728126428: 'tron',
  1088: 'metis-chain',
};

/**
 * Look up price via CoinGecko /simple/price endpoint.
 * Accepts coin IDs separated by commas.
 */
async function fetchCoinGeckoPrices(coinIds: string[]): Promise<Record<string, { usd: number } | undefined>> {
  if (coinIds.length === 0) return {};

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinIds.join(','))}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};

    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Search CoinGecko by keyword using the /search endpoint.
 * Returns up to `limit` matches.
 */
export async function searchTokenByName(
  query: string,
  chainId: number,
  limit: number = 10,
): Promise<AppToken[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const results = new Map<string, AppToken>();

  // 1) Try CoinGecko /search endpoint
  try {
    const searchRes = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(6000) },
    );

    if (searchRes.ok) {
      const data = await searchRes.json();
      const coins = (data?.coins ?? []) as Array<{
        id: string;
        name: string;
        symbol: string;
        market_cap_rank?: number;
        has_image: boolean;
      }>;

      for (const coin of coins.slice(0, limit)) {
        const key = `${coin.id}:${coin.symbol.toUpperCase()}`;

        // Skip if we already have a better result for this symbol
        if (results.has(key)) continue;

        results.set(key, {
          chainId,
          address: '0x0000000000000000000000000000000000000000',
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          decimals: 18,
          logoURI: '',
          priceUSD: '0',
          topSymbol: coin.symbol.toUpperCase(),
          count: 0,
          _isSearchResult: true,
        } as AppToken);
      }
    }
  } catch {
    // Silently continue to next strategy
  }

  // 2) Try direct price lookup for known popular tokens on this chain
  const chainPrefix = `${chainId}:`;
  const symbolUpper = q.toUpperCase();
  const candidates: string[] = [];

  // Check exact match first
  const exactKey = chainPrefix + symbolUpper;
  const exactMatch = POPULAR_NON_TOP20[exactKey];
  if (exactMatch) {
    const priceData = await fetchCoinGeckoPrices([exactMatch.coingeckoId]);
    const price = priceData[exactMatch.coingeckoId]?.usd;

    results.set(`${exactMatch.coingeckoId}:${symbolUpper}`, {
      chainId,
      address: '0x0000000000000000000000000000000000000000',
      symbol: exactMatch.symbol,
      name: exactMatch.name,
      decimals: exactMatch.decimals,
      logoURI: '',
      priceUSD: price ? String(price) : '0',
      topSymbol: exactMatch.symbol,
      count: 0,
      _isSearchResult: true,
    } as AppToken);
  } else {
    // Check prefix match (e.g. "im" → "IMX")
    for (const [key, token] of Object.entries(POPULAR_NON_TOP20)) {
      if (key.startsWith(chainPrefix) && token.symbol.toUpperCase().includes(symbolUpper)) {
        candidates.push(token.coingeckoId);
      }
    }

    if (candidates.length > 0) {
      const priceData = await fetchCoinGeckoPrices(candidates);
      for (const [key, token] of Object.entries(POPULAR_NON_TOP20)) {
        if (key.startsWith(chainPrefix) && token.symbol.toUpperCase().includes(symbolUpper)) {
          const price = priceData[token.coingeckoId]?.usd;
          if (price) {
            results.set(`${token.coingeckoId}:${token.symbol.toUpperCase()}`, {
              chainId,
              address: '0x0000000000000000000000000000000000000000',
              symbol: token.symbol,
              name: token.name,
              decimals: token.decimals,
              logoURI: '',
              priceUSD: String(price),
              topSymbol: token.symbol,
              count: 0,
              _isSearchResult: true,
            } as AppToken);
          }
        }
      }
    }
  }

  // 3) If query looks like a contract address, try the resolver
  if (q.startsWith('0x') && (q.length === 42 || q.length === 66)) {
    try {
      const { resolveTokenByAddress } = await import('@/lib/contractTokenResolver');
      const resolved = await resolveTokenByAddress(chainId, q);
      if (resolved) {
        results.clear();
        results.set(resolved.address, {
          chainId: resolved.chainId,
          address: resolved.address,
          symbol: resolved.symbol,
          name: resolved.name,
          decimals: resolved.decimals,
          logoURI: resolved.logoURI,
          priceUSD: resolved.priceUSD ?? '0',
          topSymbol: resolved.topSymbol ?? resolved.symbol,
          count: 0,
          _isSearchResult: true,
        } as AppToken);
      }
    } catch {
      // ignore
    }
  }

  return [...results.values()].slice(0, limit);
}

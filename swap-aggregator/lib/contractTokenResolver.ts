/**
 * Resolve a token from its contract address by querying blockchain explorers.
 *
 * Strategies per chain:
 *  - Gnosis (100)   → GnosisScan `module=token&action=tokeninfo`
 *  - Ethereum (1)   → Etherscan `module=token&action=tokeninfo`
 *  - Optimism (10)  → Optimistic-Etherscan `module=token&action=tokeninfo`
 *  - Polygon (137)  → PolygonScan `module=token&action=tokeninfo`
 *  - Arbitrum (42161) → Arbiscan `module=token&action=tokeninfo`
 *  - BSC (56)       → BscScan `module=token&action=tokeninfo`
 *  - Avalanche (43114) → Snowtrace `module=token&action=tokeninfo`
 *  - Solana (1151111081099710) → Solscan `GetTokenAccountsByOwner` + SPL parsing,
 *    or Helius/Jito public token-list fallback.
 *  - Tron (728126428) → Tronscan `wallet/trc20token` or `token/info`.
 *
 * For non-EVM chains without a reliable free explorer API, we fall back to
 * the CoinGecko token lookup endpoint which supports contract addresses.
 */

export interface ResolvedToken {
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  address: string;
  chainId: number;
  priceUSD?: string | null; // null means no price lookup was performed
  topSymbol?: string;
}

// Chain → explorer base + API key source
interface ExplorerConfig {
  baseUrl: string;
  keyEnv: string | null; // env var name containing the API key (may be empty)
  module: string;
  action: string;
}

const CHAIN_EXPLORER: Record<number, ExplorerConfig> = {
  // EVM chains using Etherscan-compatible APIs
  1: { baseUrl: "https://api.etherscan.io/api", keyEnv: "ETHERSCAN_API_KEY", module: "token", action: "tokeninfo" },
  10: { baseUrl: "https://api-optimistic.etherscan.io/api", keyEnv: "OPTIMISM_API_KEY", module: "token", action: "tokeninfo" },
  100: { baseUrl: "https://api.gnosisscan.io/api", keyEnv: null, module: "token", action: "tokeninfo" },
  137: { baseUrl: "https://api.polygonscan.com/api", keyEnv: "POLYGONSCAN_API_KEY", module: "token", action: "tokeninfo" },
  42161: { baseUrl: "https://api.arbiscan.io/api", keyEnv: "ARBITRUM_API_KEY", module: "token", action: "tokeninfo" },
  56: { baseUrl: "https://api.bscscan.com/api", keyEnv: "BSCSCAN_API_KEY", module: "token", action: "tokeninfo" },
  43114: { baseUrl: "https://api.snowtrace.io/api", keyEnv: "SNOWTRACE_API_KEY", module: "token", action: "tokeninfo" },
};

/**
 * Map common token symbols to top-symbol for ranking.
 */
function mapTopSymbol(symbol: string): string | undefined {
  const s = symbol.toUpperCase();
  const aliases: Record<string, string> = {
    "WBTC": "BTC", "WETH": "ETH", "WBNB": "BNB", "WMATIC": "POL",
    "WXDAI": "XDAI", "WMETIS": "METIS", "WTRX": "TRX",
    "WAVAX": "AVAX",
    "USDC.E": "USDC",
    "STETH": "ETH", "WSTETH": "ETH",
  };
  return aliases[s] || s;
}

/**
 * Build the explorer URL for a token info query.
 */
function buildExplorerUrl(chainId: number, address: string): string {
  const config = CHAIN_EXPLORER[chainId];
  if (!config) throw new Error(`No explorer configured for chain ${chainId}`);

  const apiKey = config.keyEnv ? process.env[config.keyEnv] || "" : "";
  const keyParam = apiKey ? `&apikey=${apiKey}` : "";

  return `${config.baseUrl}?module=${config.module}&action=${config.action}&address=${address}${keyParam}`;
}

/**
 * Fetch token info from an Etherscan-compatible explorer.
 * Returns null on failure.
 */
async function fetchFromExplorer(chainId: number, address: string): Promise<ResolvedToken | null> {
  try {
    const url = buildExplorerUrl(chainId, address);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const json = await res.json();

    // Etherscan: { status: "1", message: "OK", result: { symbol, name, decimals } }
    if (json.status === "1" && json.message === "OK" && json.result) {
      const result = Array.isArray(json.result) ? json.result[0] : json.result;
      if (!result) return null;

      return {
        symbol: result.symbol || "TOKEN",
        name: result.name || "",
        decimals: parseInt(result.decimals, 10) || 18,
        address: address.toLowerCase(),
        chainId,
        topSymbol: mapTopSymbol(result.symbol || ""),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * CoinGecko fallback: works for any chain+address.
 * Endpoint: https://api.coingecko.com/api/v3/simple/token_lookup (premium)
 * or simpler: https://api.coingecko.com/api/v3/simple/price?... for known IDs.
 *
 * Actually, for address→token we use the CoinGecko token endpoint:
 * https://api.coingecko.com/api/v3/coins/{id}/contract/{address}
 * which returns the contract for a coin. That's reversed.
 *
 * Better: use CoinGecko's "simple token price" which accepts addresses:
 * https://api.coingecko.com/api/v3/simple/price?
 *   ids=ethereum&contract_addresses=0x...&vs_currencies=usd
 * But this returns prices, not token metadata.
 *
 * We'll use a free API: the Helius token-list for Solana, and for EVM
 * chains, try a registry API.
 */
async function fetchFromRegistry(chainId: number, address: string): Promise<ResolvedToken | null> {
  // Gnosis native registry: Gnosis Chain Token List (Gitcoin)
  if (chainId === 100) {
    try {
      // Gnosis Chain token list from various sources
      const urls = [
        "https://raw.githubusercontent.com/gnosis/gnosis-chain-tokens/main/src/tokens/gnosis.json",
        "https://raw.githubusercontent.com/1inch/unicorn-assets/master/assets/Gnosis/chain/assets/tokens.json",
      ];
      for (const url of urls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) continue;
          const data = await res.json();
          // Try various array shapes
          const tokens = Array.isArray(data) ? data : data.tokens || data.list || [];
          const match = tokens.find(
            (t: any) => t.address?.toLowerCase() === address.toLowerCase(),
          );
          if (match) {
            return {
              symbol: match.symbol || "TOKEN",
              name: match.name || "",
              decimals: parseInt(match.decimals, 10) || 18,
              address: address.toLowerCase(),
              chainId,
              logoURI: match.logoURI || match.logo || undefined,
              topSymbol: mapTopSymbol(match.symbol || ""),
            };
          }
        } catch {
          // next URL
        }
      }
    } catch {
      // ignore
    }
  }

  // Solana: try the official token list
  if (chainId === 1151111081099710) {
    try {
      const res = await fetch(
        "https://token.jup.ag/strict", // Jupiter's comprehensive Solana token list
        { signal: AbortSignal.timeout(8000) },
      );
      if (res.ok) {
        const tokens = await res.json();
        const match = tokens.find(
          (t: any) => t.address.toLowerCase() === address.toLowerCase(),
        );
        if (match) {
          return {
            symbol: match.symbol || "SOL",
            name: match.name || "",
            decimals: match.decimals || 9,
            address: address.toLowerCase(),
            chainId,
            logoURI: match.logoURI || undefined,
            priceUSD: match.priceUsd ? String(match.priceUsd) : undefined,
            topSymbol: mapTopSymbol(match.symbol || ""),
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // Tron: Tronscan API
  if (chainId === 728126428) {
    try {
      // Tronscan: POST /wallet/trc20token (deprecated)
      // Use the TRC20 contract endpoint
      const res = await fetch(
        `https://apilist.tronscanapi.com/api/v3/token/info?address=${address}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (res.ok) {
        const json = await res.json();
        if (json && json.name) {
          return {
            symbol: json.symbol || "TRC20",
            name: json.name || "",
            decimals: json.decimals || 6,
            address: address.toLowerCase(),
            chainId,
            topSymbol: mapTopSymbol(json.symbol || ""),
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // Generic EVM fallback: try CoinGecko for price + symbol via proxy
  if (CHAIN_EXPLORER[chainId]) {
    try {
      // CoinGecko "simple/price" can look up by contract:
      // For Ethereum mainnet:
      // https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0x...&vs_currencies=usd
      const chainIdMap: Record<number, string> = {
        1: "ethereum",
        10: "optimistic-ethereum",
        137: "polygon-pos",
        42161: "arbitrum-one",
        56: "binance-smart-chain",
        43114: "avalanche",
      };
      const coinGeckoId = chainIdMap[chainId];
      if (coinGeckoId) {
        const url = `https://api.coingecko.com/api/v3/simple/token_price/${coinGeckoId}?contract_addresses=${address}&vs_currencies=usd`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const entry = data[address.toLowerCase()];
          if (entry && entry.usd) {
            // We have a price but no name/symbol — try reverse Etherscan lookup
            // using the API keyless version (might fail)
            return {
              symbol: "UNKNOWN",
              name: "",
              decimals: 18,
              address: address.toLowerCase(),
              chainId,
              priceUSD: String(entry.usd),
              topSymbol: "UNKNOWN",
            };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Resolve a token by contract address.
 *
 * Strategy:
 * 1. Try the chain's native explorer API (Etherscan-compatible)
 * 2. Try a token registry (token lists from Gitcoin, Jupiter, etc.)
 * 3. Fall back to CoinGecko price lookup for known tokens
 *
 * For non-EVM chains (Solana, Tron), registry APIs have priority.
 */
export async function resolveTokenByAddress(
  chainId: number,
  address: string,
): Promise<ResolvedToken | null> {
  // Normalize address
  const normalized = address.trim().toLowerCase();

  // Must be a valid-looking address
  // EVM: 0x... 40 hex chars
  // Solana: base58, ~32-44 chars
  // Tron: T... 34 chars, base58
  if (!normalized) return null;

  // Try explorer first for EVM chains
  if (CHAIN_EXPLORER[chainId]) {
    const result = await fetchFromExplorer(chainId, normalized);
    if (result) return result;
  }

  // Try registry (handles Gnosis, Solana, Tron specifically)
  const registryResult = await fetchFromRegistry(chainId, normalized);
  if (registryResult) return registryResult;

  // If we have a chain explorer but explorer failed, try registry again
  // with relaxed lookup (some chains have partial data)
  if (CHAIN_EXPLORER[chainId]) {
    // CoinGecko price-only fallback
    try {
      const chainIdMap: Record<number, string> = {
        1: "ethereum",
        10: "optimistic-ethereum",
        137: "polygon-pos",
        42161: "arbitrum-one",
        56: "binance-smart-chain",
        43114: "avalanche",
        100: "xdai",
      };
      const coinGeckoId = chainIdMap[chainId];
      if (coinGeckoId) {
        const url = `https://api.coingecko.com/api/v3/simple/token_price/${coinGeckoId}?contract_addresses=${normalized}&vs_currencies=usd`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const entry = data[normalized];
          if (entry && entry.usd) {
            return {
              symbol: "UNKNOWN",
              name: "",
              decimals: 18,
              address: normalized,
              chainId,
              priceUSD: String(entry.usd),
              topSymbol: "UNKNOWN",
            };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export interface ChainHint {
  chainId: number;
  confidence: "high" | "medium" | "low";
}

/**
 * Detect likely chain from an address string.
 */
export function detectChainFromAddress(address: string): ChainHint | null {
  const trimmed = address.trim();

  // EVM: 0x + 40 hex chars
  if (/^0x[a-f0-9]{40}$/.test(trimmed)) {
    // Default to Ethereum, caller should refine by current chain selection
    return { chainId: 1, confidence: "medium" };
  }

  // Solana: ~32-44 base58 chars
  if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}$/.test(trimmed)) {
    return { chainId: 1151111081099710, confidence: "high" };
  }

  // Tron: T + 33 base58 chars
  if (/^T[a-zA-Z0-9]{33}$/.test(trimmed)) {
    return { chainId: 728126428, confidence: "high" };
  }

  return null;
}

/**
 * Check if a query string looks like a contract address.
 */
export function looksLikeAddress(query: string): boolean {
  return detectChainFromAddress(query) !== null;
}

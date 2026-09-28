import type { AppToken } from "./lifi";
import { getCatalogToken, NATIVE_ADDRESS } from "./token-icons";

// Deliberately limited to the pinned, popular assets already in the local catalog.
// New symbols from provider APIs never extend this list automatically.
const POPULAR_ASSETS = new Set([
  "ETH", "WETH", "USDC", "USDT", "USDT0", "DAI", "WBTC", "CBBTC", "LINK",
  "BNB", "WBNB", "BTCB", "AVAX", "WAVAX", "POL", "OP", "XDAI", "METIS",
]);
const EVM_CHAINS = new Set([1, 10, 56, 100, 137, 1088, 8453, 42161, 43114]);

function assetFamily(token: AppToken): string | null {
  if (!EVM_CHAINS.has(token.chainId)) return null;
  const known = getCatalogToken(token.chainId, token.address);
  if (!known || known.decimals !== token.decimals || known.symbol.toUpperCase() !== token.symbol.toUpperCase()) return null;
  const symbol = known.symbol.toUpperCase();
  if (!POPULAR_ASSETS.has(symbol)) return null;
  // Binance-pegged assets are not automatically interchangeable with their originals.
  if (token.chainId === 56 && token.address.toLowerCase() !== NATIVE_ADDRESS) return `binance-peg:${symbol}`;
  return symbol;
}

/** Return provider metadata only after BOTH source and destination match pinned identities. */
export function findTokenOnChain(
  selected: AppToken | null,
  targetChainId: number,
  available: readonly AppToken[],
): AppToken | null {
  if (!selected || !EVM_CHAINS.has(targetChainId)) return null;
  const family = assetFamily(selected);
  if (!family) return null;
  const matches = available.filter(token => token.chainId === targetChainId && assetFamily(token) === family);
  // Never choose arbitrarily between multiple representations of an asset.
  const addresses = new Set(matches.map(token => token.address.toLowerCase()));
  return addresses.size === 1 ? matches[0] : null;
}

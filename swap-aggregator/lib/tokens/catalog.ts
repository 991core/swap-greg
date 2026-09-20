import { APP_CHAINS } from "../chains";
import type { AppToken } from "./types";

export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

// Explicit, reviewed chain/address/decimal pins. See TOKEN_CATALOG.md for sources
// and maintenance. Never add entries at runtime from search results or symbols.
const erc20Tokens: readonly AppToken[] = [
  {
    "chainId": 1,
    "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "decimals": 6,
    "symbol": "USDC",
    "name": "USDCoin",
    "priceUSD": "0"
  },
  {
    "chainId": 1,
    "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "decimals": 6,
    "symbol": "USDT",
    "name": "Tether USD",
    "priceUSD": "0"
  },
  {
    "chainId": 1,
    "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "decimals": 18,
    "symbol": "WETH",
    "name": "Wrapped Ether",
    "priceUSD": "0"
  },
  {
    "chainId": 1,
    "address": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    "decimals": 8,
    "symbol": "WBTC",
    "name": "Wrapped BTC",
    "priceUSD": "0"
  },
  {
    "chainId": 1,
    "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "decimals": 18,
    "symbol": "DAI",
    "name": "Dai Stablecoin",
    "priceUSD": "0"
  },
  {
    "chainId": 1,
    "address": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "decimals": 18,
    "symbol": "LINK",
    "name": "ChainLink Token",
    "priceUSD": "0"
  },
  {
    "chainId": 10,
    "address": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "decimals": 6,
    "symbol": "USDC",
    "name": "USDCoin",
    "priceUSD": "0"
  },
  {
    "chainId": 10,
    "address": "0x4200000000000000000000000000000000000006",
    "decimals": 18,
    "symbol": "WETH",
    "name": "Wrapped Ether",
    "priceUSD": "0"
  },
  {
    "chainId": 10,
    "address": "0x4200000000000000000000000000000000000042",
    "decimals": 18,
    "symbol": "OP",
    "name": "Optimism",
    "priceUSD": "0"
  },
  {
    "chainId": 56,
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "decimals": 18,
    "symbol": "WBNB",
    "name": "Wrapped BNB",
    "priceUSD": "0"
  },
  {
    "chainId": 137,
    "address": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    "decimals": 6,
    "symbol": "USDC",
    "name": "USDCoin",
    "priceUSD": "0"
  },
  {
    "chainId": 137,
    "address": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    "decimals": 6,
    "symbol": "USDT",
    "name": "Tether USD",
    "priceUSD": "0"
  },
  {
    "chainId": 137,
    "address": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    "decimals": 18,
    "symbol": "WETH",
    "name": "Wrapped Ether",
    "priceUSD": "0"
  },
  {
    "chainId": 137,
    "address": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    "decimals": 8,
    "symbol": "WBTC",
    "name": "Wrapped BTC",
    "priceUSD": "0"
  },
  {
    "chainId": 137,
    "address": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    "decimals": 18,
    "symbol": "DAI",
    "name": "Dai Stablecoin",
    "priceUSD": "0"
  },
  {
    "chainId": 137,
    "address": "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    "decimals": 18,
    "symbol": "LINK",
    "name": "ChainLink Token",
    "priceUSD": "0"
  },
  {
    "chainId": 8453,
    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "decimals": 6,
    "symbol": "USDC",
    "name": "USD Coin",
    "priceUSD": "0"
  },
  {
    "chainId": 8453,
    "address": "0x4200000000000000000000000000000000000006",
    "decimals": 18,
    "symbol": "WETH",
    "name": "Wrapped Ether",
    "priceUSD": "0"
  },
  {
    "chainId": 8453,
    "address": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    "decimals": 8,
    "symbol": "cbBTC",
    "name": "Coinbase Wrapped BTC",
    "priceUSD": "0"
  },
  {
    "chainId": 8453,
    "address": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    "decimals": 18,
    "symbol": "DAI",
    "name": "Dai Stablecoin",
    "priceUSD": "0"
  },
  {
    "chainId": 42161,
    "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "decimals": 6,
    "symbol": "USDC",
    "name": "USDCoin",
    "priceUSD": "0"
  },
  {
    "chainId": 42161,
    "address": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "decimals": 18,
    "symbol": "WETH",
    "name": "Wrapped Ether",
    "priceUSD": "0"
  },
  {
    "chainId": 42161,
    "address": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    "decimals": 8,
    "symbol": "cbBTC",
    "name": "Coinbase Wrapped BTC",
    "priceUSD": "0"
  },
  {
    "chainId": 43114,
    "address": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    "decimals": 6,
    "symbol": "USDC",
    "name": "USDC Token",
    "priceUSD": "0"
  },
  {
    "chainId": 43114,
    "address": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    "decimals": 18,
    "symbol": "WAVAX",
    "name": "Wrapped AVAX",
    "priceUSD": "0"
  },
  {"chainId":56,"address":"0x55d398326f99059fF775485246999027B3197955","decimals":18,"symbol":"USDT","name":"Binance Pegged USDT","priceUSD":"0"},
  {"chainId":56,"address":"0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c","decimals":18,"symbol":"BTCB","name":"Binance Pegged Bitcoin","priceUSD":"0"},
  {"chainId":56,"address":"0x2170Ed0880ac9A755fd29B2688956BD959F933F8","decimals":18,"symbol":"ETH","name":"Binance Pegged ETH","priceUSD":"0"},
  {"chainId":56,"address":"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d","decimals":18,"symbol":"USDC","name":"Binance Pegged USD Coin","priceUSD":"0"},
  {"chainId":42161,"address":"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9","decimals":6,"symbol":"USDT0","name":"USDT0","priceUSD":"0"}
];

const catalog: readonly Readonly<AppToken>[] = Object.freeze([
  ...APP_CHAINS.map((chain) => ({
    ...chain.nativeCurrency, chainId: chain.id, address: NATIVE_ADDRESS, priceUSD: "0",
  })),
  ...erc20Tokens,
].map((token) => Object.freeze(token)));

export function getCatalogToken(chainId: number, address: string): AppToken | null {
  const token = catalog.find((item) => item.chainId === chainId && item.address.toLowerCase() === address.trim().toLowerCase());
  return token ? { ...token } : null;
}

export function isCatalogToken(token: AppToken): boolean {
  const known = getCatalogToken(token.chainId, token.address);
  return Boolean(known && known.decimals === token.decimals && known.symbol === token.symbol);
}

export function getPopularTokens(chainId: number, query = ""): AppToken[] {
  const text = query.trim().toLowerCase();
  return catalog.filter((token) => token.chainId === chainId &&
    (!text || token.symbol.toLowerCase().includes(text) || token.name.toLowerCase().includes(text) ||
      token.address.toLowerCase() === text)).map((token) => ({ ...token }));
}

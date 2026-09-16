import type { AppToken } from "@/lib/lifi";

const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const CACHE_TTL_MS = 60_000;

const priceCache = new Map<string, { expiresAt: number; value: number }>();

const SYMBOL_ID_MAP: Record<string, string> = {
  ETH: "ethereum",
  WETH: "weth",
  BTC: "bitcoin",
  WBTC: "wrapped-bitcoin",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  POL: "matic-network",
  MATIC: "matic-network",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  OP: "optimism",
  ARB: "arbitrum",
  BASE: "base",
};

const ADDRESS_ID_MAP: Record<string, string> = {
  "0xa0b86991c6218b36c1dd4a2e9eb0ce3606eb48": "usd-coin",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "tether",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "dai",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "wrapped-bitcoin",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "weth",
  "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0": "matic-network",
  "0x0000000000000000000000000000000000000000": "ethereum",
};

export function getPriceLookupKey(token: AppToken): string {
  return `${token.chainId ?? "unknown"}:${token.address ?? ""}:${token.topSymbol ?? token.symbol ?? ""}`;
}

function getCacheKey(token: AppToken): string {
  return getPriceLookupKey(token);
}

function getCoinGeckoId(token: AppToken): string | null {
  const address = token.address?.toLowerCase();
  if (address && ADDRESS_ID_MAP[address]) return ADDRESS_ID_MAP[address];

  const topSymbol = (token.topSymbol ?? token.symbol ?? "").toUpperCase();
  if (topSymbol && SYMBOL_ID_MAP[topSymbol]) return SYMBOL_ID_MAP[topSymbol];

  const symbol = (token.symbol ?? "").toUpperCase();
  return SYMBOL_ID_MAP[symbol] ?? null;
}

export function formatCurrencyValue(value: number | null | undefined, currency: "USD" | "EUR" = "USD"): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;

  const rate = currency === "EUR" ? 0.92 : 1;
  const amount = value * rate;
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function fetchTokenPriceUsd(token: AppToken): Promise<number | null> {
  const cached = priceCache.get(getCacheKey(token));
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const coinGeckoId = getCoinGeckoId(token);
  if (!coinGeckoId) return null;

  try {
    const response = await fetch(`${COINGECKO_PRICE_URL}?ids=${encodeURIComponent(coinGeckoId)}&vs_currencies=usd`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as Record<string, { usd?: number }>;
    const value = payload?.[coinGeckoId]?.usd;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;

    priceCache.set(getCacheKey(token), { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch {
    return null;
  }
}

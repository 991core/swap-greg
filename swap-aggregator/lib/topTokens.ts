/**
 * Snapshot top ~20 market-cap symbols (static allowlist).
 * Only tokens LI.FI actually lists on the selected EVM chain appear in the UI.
 * Native non-EVM assets (ADA, etc.) show up only as wrapped/bridged equivalents when present.
 */
export const TOP_20_SYMBOLS = [
  "BTC",
  "ETH",
  "USDT",
  "BNB",
  "XRP",
  "SOL",
  "USDC",
  "DOGE",
  "ADA",
  "TRX",
  "AVAX",
  "LINK",
  "SHIB",
  "TON",
  "DOT",
  "WBTC",
  "POL",
  "BCH",
  "LTC",
  "UNI",
  "GNO",
  "XDAI",
  "METIS",
] as const;

export type TopSymbol = (typeof TOP_20_SYMBOLS)[number];

/** Map LI.FI / wrapped symbols onto the allowlist key (one row per asset per chain). */
const SYMBOL_ALIASES: Record<string, TopSymbol> = {
  BTC: "BTC",
  WBTC: "BTC",
  ETH: "ETH",
  WETH: "ETH",
  USDT: "USDT",
  BNB: "BNB",
  WBNB: "BNB",
  XRP: "XRP",
  SOL: "SOL",
  USDC: "USDC",
  "USDC.E": "USDC",
  DOGE: "DOGE",
  ADA: "ADA",
  TRX: "TRX",
  AVAX: "AVAX",
  WAVAX: "AVAX",
  LINK: "LINK",
  SHIB: "SHIB",
  TON: "TON",
  DOT: "DOT",
  POL: "POL",
  MATIC: "POL",
  WMATIC: "POL",
  BCH: "BCH",
  LTC: "LTC",
  UNI: "UNI",
  XDAI: "XDAI",
  WXDAI: "XDAI",
  METIS: "METIS",
  WMETIS: "METIS",
};

const TOP_SET = new Set<string>(
  TOP_20_SYMBOLS.filter((s) => s !== "WBTC"), // WBTC is represented as BTC
);

export function normalizeToTopSymbol(symbol: string): TopSymbol | null {
  const upper = symbol.trim().toUpperCase();
  if (upper === "WBTC" || upper === "BTC") return "BTC";
  const aliased = SYMBOL_ALIASES[upper];
  if (aliased && aliased !== "WBTC" && TOP_SET.has(aliased)) return aliased;
  if (TOP_SET.has(upper)) return upper as TopSymbol;
  return null;
}

export function isTop20Symbol(symbol: string): boolean {
  return normalizeToTopSymbol(symbol) !== null;
}

/** Rank for stable UI ordering (BTC first …). WBTC shares BTC rank. */
export function topSymbolRank(topSymbol: string): number {
  if (topSymbol === "BTC") return 0;
  const idx = TOP_20_SYMBOLS.indexOf(topSymbol as (typeof TOP_20_SYMBOLS)[number]);
  return idx === -1 ? 99 : idx;
}

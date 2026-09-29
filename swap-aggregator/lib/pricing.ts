import type { AppToken } from "./aggregators/lifi/routes";
import { getTokenDetails } from "./tokens/client";

const prices = new Map<string, { expiresAt: number; value: number }>();
export type FxRate = { rate: number; date: string };
export function getPriceLookupKey(token: AppToken): string {
  return `${token.chainId}:${token.address.toLowerCase()}`;
}
export async function fetchTokenPriceUsd(token: AppToken): Promise<number | null> {
  const cached = prices.get(getPriceLookupKey(token));
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const latest = await getTokenDetails(token.chainId, token.address);
    if (!latest) return null;
    const price = Number(latest.priceUSD);
    if (latest.chainId !== token.chainId || latest.address.toLowerCase() !== token.address.toLowerCase() || !Number.isFinite(price) || price <= 0) return null;
    prices.set(getPriceLookupKey(token), { value: price, expiresAt: Date.now() + 60_000 });
    return price;
  } catch { return null; }
}
export async function fetchUsdEurRate(): Promise<FxRate | null> {
  try {
    const response = await fetch("https://api.frankfurter.dev/v2/rate/usd/eur?providers=ecb", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    const date = Date.parse(data.date);
    if (typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0 || !Number.isFinite(date) || Date.now() - date > 7 * 86_400_000) return null;
    return { rate: data.rate, date: data.date };
  } catch { return null; }
}
export function formatCurrencyValue(value: number | null | undefined, currency: "USD" | "EUR" = "USD", eurRate: number | null = null, locale = "en"): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (currency === "EUR" && (eurRate == null || !Number.isFinite(eurRate) || eurRate <= 0)) return null;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value * (currency === "EUR" ? eurRate! : 1));
}

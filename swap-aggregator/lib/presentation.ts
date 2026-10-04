import { formatTokenAmount } from "./amounts";
import { formatCurrencyValue } from "./pricing";

/** Short display only: the exact integer amount remains the execution source. */
export function quoteAmount(amount: string, decimals: number) {
  const exact = formatTokenAmount(amount, decimals, decimals);
  const [whole, fraction = ""] = exact.split(".");
  const leadingZeros = fraction.match(/^0*/)?.[0].length ?? 0;
  const precision = whole === "0" ? Math.max(6, leadingZeros + 4) : 6;
  const short = formatTokenAmount(amount, decimals, precision);
  return { exact, short, rounded: short !== exact };
}

/** A non-zero network fee must never appear as free after currency rounding. */
export function quoteFiat(value: number | null, currency: "USD" | "EUR", eurRate: number | null, lang: string) {
  const formatted = formatCurrencyValue(value, currency, eurRate, lang);
  if (formatted === null || value === null) return null;
  const converted = value * (currency === "EUR" ? eurRate! : 1);
  return converted > 0 && converted < 0.01
    ? `< ${new Intl.NumberFormat(lang, { style: "currency", currency }).format(0.01)}`
    : formatted;
}

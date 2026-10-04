/** One decimal separator (dot or comma); grouping separators are not accepted. */
export function parseTokenAmount(human: string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const value = human.trim();
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.replace(",", ".").split(".");
  if (fraction.length > decimals) return null;
  return BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`).toString();
}

export function formatTokenAmount(amount: string, decimals: number, maxFrac = 6): string {
  if (!/^-?\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return "—";
  const negative = amount.startsWith("-");
  const raw = BigInt(negative ? amount.slice(1) : amount).toString();
  if (decimals === 0) return `${negative ? "-" : ""}${raw}`;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).slice(0, Math.max(0, maxFrac)).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function balancePercentage(balance: bigint, percent: number, decimals: number): string {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100 || balance < BigInt(0)) return "";
  return formatTokenAmount((balance * BigInt(percent) / BigInt(100)).toString(), decimals, decimals);
}

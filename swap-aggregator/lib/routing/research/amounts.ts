import type { Asset } from "./types.ts";

export const NATIVE = "0x0000000000000000000000000000000000000000";
const DECIMAL = /^\d+(?:\.\d+)?$/;

export function assetKey(asset: Asset): string {
  return `${asset.chainId}:${asset.address.toLowerCase()}`;
}

export function validateAsset(asset: Asset): void {
  if (!Number.isSafeInteger(asset.chainId) || asset.chainId <= 0 ||
      !/^0x[\da-f]{40}$/i.test(asset.address) ||
      !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) {
    throw new Error("Expected an EVM chain, a 20-byte token address and 0–36 decimals");
  }
}

export function rawAmount(value: string, allowZero = false): bigint {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) {
    throw new Error("Amounts must be unsigned integer strings in token base units");
  }
  const amount = BigInt(value);
  if ((!allowZero && amount === BigInt(0)) || amount >= BigInt(2) ** BigInt(256)) {
    throw new Error("Amount is outside the supported uint256 range");
  }
  return amount;
}

function decimalParts(value: string): { raw: bigint; scale: number } {
  if (typeof value !== "string" || value.length > 100 || !DECIMAL.test(value)) {
    throw new Error("Expected a non-negative decimal string");
  }
  const [whole, fraction = ""] = value.split(".");
  return { raw: BigInt(whole + fraction), scale: fraction.length };
}

export function validDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && DECIMAL.test(value);
}

export function sumUsd(values: string[]): string {
  const parts = values.map(decimalParts);
  const scale = Math.max(0, ...parts.map((p) => p.scale));
  const total = parts.reduce((sum, p) => sum + p.raw * BigInt(10) ** BigInt(scale - p.scale), BigInt(0));
  if (scale === 0) return total.toString();
  const s = total.toString().padStart(scale + 1, "0");
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
}

/** Round external cost upward to avoid declaring a gain from rounding dust. */
export function usdToRawCeil(usd: string, usdPerToken: string, decimals: number): bigint {
  const cost = decimalParts(usd);
  const price = decimalParts(usdPerToken);
  if (price.raw === BigInt(0)) throw new Error("Destination valuation must be positive");
  const numerator = cost.raw * BigInt(10) ** BigInt(decimals + price.scale);
  const denominator = price.raw * BigInt(10) ** BigInt(cost.scale);
  return (numerator + denominator - BigInt(1)) / denominator;
}

export function compareRawDescending(a: string, b: string): number {
  return BigInt(a) === BigInt(b) ? 0 : BigInt(a) > BigInt(b) ? -1 : 1;
}

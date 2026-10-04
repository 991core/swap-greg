import { getAddress, formatUnits } from "viem";
import type { SwapParams } from "../lifi/routes";
import type { AppToken } from "../../tokens/types";
import { NATIVE_ADDRESS } from "../../tokens/catalog";
import type { RangoQuote, RangoRoute, RangoToken } from "./types";

// Rango /basic/meta/blockchains, reviewed 2026-09-20. Not a token allowlist.
export const RANGO_CHAINS: Record<number, { name: string; native: string }> = {
  1: { name: "ETH", native: "ETH" }, 10: { name: "OPTIMISM", native: "ETH" },
  56: { name: "BSC", native: "BNB" }, 100: { name: "GNOSIS", native: "XDAI" },
  137: { name: "POLYGON", native: "POL" }, 8453: { name: "BASE", native: "ETH" },
  42161: { name: "ARBITRUM", native: "ETH" }, 43114: { name: "AVAX_CCHAIN", native: "AVAX" },
  1088: { name: "METIS", native: "METIS" },
};
const METIS_NATIVE = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000";
export const isUint = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < BigInt(2) ** BigInt(256);
export const isAddress = (value: unknown): value is string => typeof value === "string" && /^0x[\da-f]{40}$/i.test(value);
export const isRequestId = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
export function rangoAsset(chainId: number, address: string): string {
  const chain = RANGO_CHAINS[chainId];
  if (!chain || !isAddress(address)) throw new Error("Unsupported Rango asset.");
  if (address.toLowerCase() === NATIVE_ADDRESS) return chainId === 1088 ? `METIS--${METIS_NATIVE}` : `${chain.name}.${chain.native}`;
  return `${chain.name}--${address}`;
}
export function rangoToken(token: RangoToken): AppToken {
  const chainId = Number(token?.chainId);
  if (!RANGO_CHAINS[chainId] || token.blockchain !== RANGO_CHAINS[chainId].name ||
      !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255 ||
      typeof token.symbol !== "string" || !token.symbol.length || token.symbol.length > 32 ||
      (token.address !== null && !isAddress(token.address))) throw new Error("Invalid Rango token metadata.");
  const native = token.address === null || (chainId === 1088 && token.address.toLowerCase() === METIS_NATIVE);
  if (native && (token.decimals !== 18 || token.symbol !== RANGO_CHAINS[chainId].native)) throw new Error("Invalid Rango native asset.");
  return { chainId, address: native ? NATIVE_ADDRESS : getAddress(token.address!), decimals: token.decimals,
    symbol: token.symbol, name: typeof token.name === "string" ? token.name.slice(0, 100) : token.symbol,
    priceUSD: typeof token.usdPrice === "number" && Number.isFinite(token.usdPrice) && token.usdPrice >= 0 ? String(token.usdPrice) : "0" };
}
export function sameRangoAsset(token: RangoToken, chainId: number, address: string): boolean {
  const parsed = rangoToken(token);
  return parsed.chainId === chainId && parsed.address.toLowerCase() === address.toLowerCase();
}
export function validateRangoQuote(data: RangoQuote, params: SwapParams): RangoQuote & { route: RangoRoute } {
  if (!data || data.resultType !== "OK" || data.error || !isRequestId(data.requestId) || !data.route) throw new Error("Rango: no executable quote.");
  const route = data.route;
  if (!sameRangoAsset(route.from, params.fromChainId, params.fromTokenAddress) || !sameRangoAsset(route.to, params.toChainId, params.toTokenAddress) ||
      !isUint(route.outputAmount) || BigInt(route.outputAmount) <= BigInt(0) || !isUint(route.outputAmountMin) || BigInt(route.outputAmountMin) <= BigInt(0) ||
      BigInt(route.outputAmountMin) > BigInt(route.outputAmount) || route.swapper?.enabled !== true || !/^[\w .()-]{1,100}$/.test(route.swapper.id) ||
      typeof route.swapper.title !== "string" || route.swapper.title.length > 100 ||
      !Array.isArray(route.swapper.types) || route.swapper.types.includes("OFF_CHAIN") ||
      !Number.isFinite(route.estimatedTimeInSeconds) || route.estimatedTimeInSeconds < 0 || !Array.isArray(route.fee)) throw new Error("Rango: invalid quote.");
  for (const fee of route.fee) {
    const token = rangoToken(fee.token);
    if (!isUint(fee.amount) || typeof fee.name !== "string" ||
        !["FROM_SOURCE_WALLET", "DECREASE_FROM_OUTPUT", "FROM_DESTINATION_WALLET"].includes(fee.expenseType)) throw new Error("Rango: invalid fee.");
    // First adapter: native source fees, no extra token transfers or destination-wallet spending.
    if (fee.expenseType === "FROM_DESTINATION_WALLET" || (fee.expenseType === "FROM_SOURCE_WALLET" &&
        (token.chainId !== params.fromChainId || token.address !== NATIVE_ADDRESS))) throw new Error("Rango: unsupported fee payment.");
  }
  return data as RangoQuote & { route: RangoRoute };
}
export function rangoGasUsd(route: RangoRoute): string | null {
  const fees = route.fee.filter((fee) => fee.expenseType === "FROM_SOURCE_WALLET");
  if (!fees.length || fees.some((fee) => !fee.token.usdPrice)) return null;
  const total = fees.reduce((sum, fee) => sum + Number(formatUnits(BigInt(fee.amount), fee.token.decimals)) * fee.token.usdPrice!, 0);
  return Number.isFinite(total) ? String(total) : null;
}

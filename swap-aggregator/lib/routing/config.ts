const feePercent = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_PERCENT ?? "0");
if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
  throw new Error("NEXT_PUBLIC_PLATFORM_FEE_PERCENT must be a percentage between 0 and 100.");
}
export const PLATFORM_FEE = feePercent / 100;
export const SLIPPAGE = 0.005;
export const MAX_PRICE_IMPACT = 0.05;
export const QUOTE_TTL_MS = 60_000;
export const QUOTE_RETRY_MS = 15_000;
export const ROUTE_TIMEOUT_MS = 15_000;

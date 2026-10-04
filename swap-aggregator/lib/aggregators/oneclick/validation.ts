import { isAddress, zeroAddress } from "viem";

export const ONECLICK_CHAINS: Record<number, string> = {
  1: "eth", 8453: "base", 42161: "arb", 10: "op", 137: "pol",
  56: "bsc", 43114: "avax", 100: "gnosis",
};
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
export function isOneClickAmount(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) <= UINT256_MAX;
}
export type OneClickTokenEvidence = {
  assetId: string; blockchain: string; contractAddress: string; decimals: number; symbol: string;
};
export type OneClickQuoteRequest = {
  dry: boolean; swapType: "EXACT_INPUT"; slippageTolerance: number;
  originAsset: string; destinationAsset: string; amount: string;
  depositType: "ORIGIN_CHAIN"; refundTo: string; refundType: "ORIGIN_CHAIN";
  recipient: string; recipientType: "DESTINATION_CHAIN"; deadline: string;
  depositMode: "SIMPLE"; appFees?: Array<{ recipient: string; fee: number }>;
};
export type OneClickQuoteResponse = {
  correlationId: string; timestamp: string; signature: string;
  quoteRequest: OneClickQuoteRequest;
  quote: {
    amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number;
    depositAddress?: string; deadline?: string; depositMemo?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
export type OneClickSwapDetails = {
  amountIn?: string; amountOut?: string;
  originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
  destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
  [key: string]: unknown;
};
export function isOneClickRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
export function isOneClickTokenEvidence(value: unknown): value is OneClickTokenEvidence {
  return isOneClickRecord(value) && boundedText(value.assetId) &&
    typeof value.blockchain === "string" && Object.values(ONECLICK_CHAINS).includes(value.blockchain) &&
    typeof value.contractAddress === "string" && isAddress(value.contractAddress) &&
    Number.isInteger(value.decimals) && Number(value.decimals) >= 0 && Number(value.decimals) <= 255 &&
    boundedText(value.symbol, 64);
}
/** Validate the binding, preserving the complete upstream proof for later disputes. */
export function validateOneClickQuoteResponse(
  data: unknown, expected: OneClickQuoteRequest, now = Date.now(), requireFresh = true,
): OneClickQuoteResponse {
  const invalid = () => { throw new Error("Invalid 1Click quote response"); };
  if (!isOneClickRecord(data) || !isOneClickRecord(data.quoteRequest) || !isOneClickRecord(data.quote)) return invalid();
  // Keep a quote plus its later settlement proof within the resumable record budget.
  if (JSON.stringify(data).length > 24_576) return invalid();
  const request = data.quoteRequest;
  const quote = data.quote;
  if (!boundedText(data.correlationId) || !boundedText(data.signature, 16_384) ||
      typeof data.timestamp !== "string" || !Number.isFinite(Date.parse(data.timestamp))) return invalid();
  const fields = ["dry", "swapType", "slippageTolerance", "originAsset", "destinationAsset", "amount", "depositType", "refundType", "recipientType", "depositMode"] as const;
  if (fields.some(field => request[field] !== expected[field]) ||
      request.swapType !== "EXACT_INPUT" || request.depositType !== "ORIGIN_CHAIN" ||
      request.refundType !== "ORIGIN_CHAIN" || request.recipientType !== "DESTINATION_CHAIN" || request.depositMode !== "SIMPLE" ||
      typeof request.dry !== "boolean" || !isOneClickAmount(request.amount) ||
      !boundedText(request.originAsset) || !boundedText(request.destinationAsset) || request.originAsset === request.destinationAsset ||
      !Number.isInteger(request.slippageTolerance) || Number(request.slippageTolerance) < 0 || Number(request.slippageTolerance) > 10_000) return invalid();
  for (const field of ["recipient", "refundTo"] as const) {
    if (typeof request[field] !== "string" || !isAddress(request[field]) ||
        request[field].toLowerCase() !== expected[field].toLowerCase() ||
        (!request.dry && request[field].toLowerCase() === zeroAddress)) return invalid();
  }
  if (String(request.recipient).toLowerCase() !== String(request.refundTo).toLowerCase()) return invalid();
  if (typeof request.deadline !== "string" || !Number.isFinite(Date.parse(request.deadline)) ||
      Date.parse(request.deadline) !== Date.parse(expected.deadline) ||
      (requireFresh && (Date.parse(request.deadline) <= now + 30_000 || Date.parse(request.deadline) > now + 21 * 60_000))) return invalid();
  // Fees are deliberately unsupported until a server-owned fee configuration exists.
  if ((request.appFees !== undefined && (!Array.isArray(request.appFees) || request.appFees.length !== 0)) ||
      (expected.appFees !== undefined && expected.appFees.length !== 0)) return invalid();
  for (const field of ["virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"] as const) {
    if (request[field] != null || quote[field] != null) return invalid();
  }
  if (quote.amountIn !== request.amount || !isOneClickAmount(quote.amountOut) || !isOneClickAmount(quote.minAmountOut) ||
      BigInt(quote.minAmountOut) > BigInt(quote.amountOut) || typeof quote.timeEstimate !== "number" ||
      !Number.isFinite(quote.timeEstimate) || quote.timeEstimate < 0 || quote.timeEstimate > 7 * 24 * 60 * 60 || quote.depositMemo != null) return invalid();
  if (request.dry) {
    if (quote.depositAddress != null || quote.deadline != null || quote.timeWhenInactive != null || quote.chainDepositAddresses != null) return invalid();
  } else if (typeof quote.depositAddress !== "string" || !isAddress(quote.depositAddress) ||
      quote.depositAddress.toLowerCase() === zeroAddress || typeof quote.deadline !== "string" ||
      !Number.isFinite(Date.parse(quote.deadline)) || Date.parse(quote.deadline) > Date.parse(request.deadline) ||
      (requireFresh && Date.parse(quote.deadline) <= now + 30_000) || quote.chainDepositAddresses != null) return invalid();
  return data as OneClickQuoteResponse;
}

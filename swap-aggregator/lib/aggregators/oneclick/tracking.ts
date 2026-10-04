import type { Address } from "viem";
import { validateOneClickTokenBinding } from "./client";
import { ONECLICK_CHAINS, isOneClickAmount, validateOneClickQuoteResponse } from "./validation";
import { SLIPPAGE } from "../../routing/config";
import type { PendingOneClick, PendingOneClickV1 } from "./types";

const addressPattern = /^0x[\da-f]{40}$/i;
const hashPattern = /^0x[\da-f]{64}$/i;
function isAddress(value: unknown): value is Address {
  return typeof value === "string" && addressPattern.test(value) && !/^0x0{40}$/i.test(value);
}
function isHash(value: unknown): value is `0x${string}` { return typeof value === "string" && hashPattern.test(value); }
export function safeOneClickUrl(value: unknown): string | undefined {
  try {
    if (typeof value !== "string" || value.length > 2048) return undefined;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || /[\s\\]/.test(value)) return undefined;
    return url.href;
  } catch { return undefined; }
}
export function isActiveOneClick(pending: PendingOneClick | null): boolean {
  return Boolean(pending && pending.status !== "SUCCESS" && pending.status !== "FAILED");
}

function validateStoredProof(pending: PendingOneClickV1) {
  const request = pending.quoteResponse?.quoteRequest;
  if (!request || request.dry !== false || request.swapType !== "EXACT_INPUT" ||
      request.slippageTolerance !== Math.round(SLIPPAGE * 10_000) || request.depositType !== "ORIGIN_CHAIN" ||
      request.refundType !== "ORIGIN_CHAIN" || request.recipientType !== "DESTINATION_CHAIN" || request.depositMode !== "SIMPLE" ||
      request.refundTo.toLowerCase() !== pending.wallet.toLowerCase() || request.recipient.toLowerCase() !== pending.wallet.toLowerCase() ||
      request.amount !== pending.amount || request.originAsset !== pending.originToken.assetId ||
      request.destinationAsset !== pending.destinationToken.assetId) throw new Error("Invalid stored 1Click quote");
  if (!isAddress(pending.fromTokenAddress) || typeof pending.toTokenAddress !== "string" || !addressPattern.test(pending.toTokenAddress)) throw new Error("Invalid stored 1Click token identity");
  validateOneClickTokenBinding(pending.originToken, pending.fromChainId, pending.fromTokenAddress, pending.fromTokenDecimals);
  validateOneClickTokenBinding(pending.destinationToken, pending.toChainId, pending.toTokenAddress, pending.toTokenDecimals);
  // Expiry does not authorize another deposit and does not invalidate tracking.
  const proof = validateOneClickQuoteResponse(pending.quoteResponse, request, Date.now(), false);
  if (proof.quote.depositAddress?.toLowerCase() !== pending.depositAddress.toLowerCase() || proof.quote.amountIn !== pending.amount ||
      proof.quote.minAmountOut !== pending.minimum || !isOneClickAmount(pending.amount) || !isOneClickAmount(pending.minimum)) throw new Error("Invalid stored 1Click amounts");
}

function quoteMatches(pending: PendingOneClickV1, value: unknown): boolean {
  try {
    const proof = validateOneClickQuoteResponse(value, pending.quoteResponse.quoteRequest, Date.now(), false);
    const stored = pending.quoteResponse;
    return proof.signature === stored.signature && proof.correlationId === stored.correlationId && proof.timestamp === stored.timestamp &&
      proof.quote.depositAddress?.toLowerCase() === pending.depositAddress.toLowerCase() &&
      proof.quote.deadline === stored.quote.deadline && proof.quote.amountIn === pending.amount &&
      proof.quote.amountOut === stored.quote.amountOut && proof.quote.minAmountOut === pending.minimum;
  } catch { return false; }
}
function verifiedDelivery(pending: PendingOneClickV1, response: unknown): { destinationUrl?: string } | null {
  if (!response || typeof response !== "object" || !pending.hash) return null;
  const data = response as { status?: unknown; quoteResponse?: unknown; swapDetails?: {
    amountIn?: unknown; amountOut?: unknown; originChainTxHashes?: { hash?: unknown }[];
    destinationChainTxHashes?: { hash?: unknown; explorerUrl?: unknown }[];
  } };
  if (data.status !== "SUCCESS" || !quoteMatches(pending, data.quoteResponse)) return null;
  const details = data.swapDetails;
  if (!details || details.amountIn !== pending.amount || typeof details.amountOut !== "string" || !isOneClickAmount(details.amountOut) ||
      BigInt(details.amountOut) < BigInt(pending.minimum) || !Array.isArray(details.originChainTxHashes) ||
      details.originChainTxHashes.length !== 1 || !isHash(details.originChainTxHashes[0]?.hash) ||
      details.originChainTxHashes[0].hash.toLowerCase() !== pending.hash.toLowerCase() ||
      !Array.isArray(details.destinationChainTxHashes) || !details.destinationChainTxHashes.length ||
      details.destinationChainTxHashes.length > 16 || details.destinationChainTxHashes.some((tx) => !isHash(tx?.hash))) return null;
  return { destinationUrl: safeOneClickUrl(details.destinationChainTxHashes[0].explorerUrl) };
}

export function readPendingOneClick(text: string | null): PendingOneClick | null {
  try {
    if (!text || text.length > 65_536) return null;
    const value = JSON.parse(text) as PendingOneClickV1;
    if (!value || !isAddress(value.wallet) || !isAddress(value.depositAddress) || !Number.isInteger(value.fromChainId) ||
        (value.hash !== undefined && !isHash(value.hash))) return null;
    // Missing proofs in a recognized older record never become invented metadata.
    if (value.version === undefined || (value as { version: number }).version === 0) {
      if (!isHash(value.hash)) return null;
      if (!ONECLICK_CHAINS[value.fromChainId]) return null;
      return { version: 0, wallet: value.wallet, fromChainId: value.fromChainId, depositAddress: value.depositAddress, hash: value.hash, status: "UNKNOWN" };
    }
    if (value.version !== 1 || !Number.isInteger(value.toChainId) || !Number.isSafeInteger(value.submittedAt) || value.submittedAt < 0 ||
        !["UNKNOWN", "PENDING_DEPOSIT", "PROCESSING", "SUCCESS", "FAILED"].includes(value.status)) return null;
    validateStoredProof(value);
    if (value.status === "FAILED" && !((value.sourceOutcome === "rejected" && !value.hash) || (value.sourceOutcome === "reverted" && value.hash))) return { ...value, status: "UNKNOWN", destinationUrl: undefined };
    if (value.status === "SUCCESS") {
      const delivery = verifiedDelivery(value, value.delivery);
      if (!delivery) return { ...value, status: "PROCESSING", destinationUrl: undefined };
      return { ...value, destinationUrl: delivery.destinationUrl };
    }
    return { ...value, destinationUrl: undefined };
  } catch { return null; }
}

export function updatePendingOneClick(pending: PendingOneClick, response: unknown): PendingOneClick {
  if (!isActiveOneClick(pending) || pending.version === 0) return pending;
  const delivery = verifiedDelivery(pending, response);
  if (delivery) return { ...pending, status: "SUCCESS", destinationUrl: delivery.destinationUrl, delivery: response };
  if (!response || typeof response !== "object" || !quoteMatches(pending, (response as { quoteResponse?: unknown }).quoteResponse)) return pending;
  const status = (response as { status?: unknown }).status;
  // Remote failed/refunded/bare success is insufficient evidence for resubmission.
  if (["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"].includes(String(status)) && pending.status !== "PROCESSING") {
    return { ...pending, status: "PROCESSING" };
  }
  return pending;
}

import { getStatus, type RouteExtended } from "@lifi/sdk";
import { getLifiSdkClient } from "./client";
import { normalizedSecurityAddress, securityUint } from "../../security/quote-validator";

export type LifiTrackingIntent = {
  routeId: string; sourceHash: string; fromChainId: number; toChainId: number; account: string;
  recipient: string; tokenAddress: string; tokenDecimals: number; minimum: string; tool: string; transactionId?: string;
};
export type LifiDeliveryEvidence = {
  state: "delivered" | "pending" | "alternative" | "refund" | "intervention";
  proof: "provider"; reason: string; sourceHash: string; destinationHash?: string; amount?: string;
};
const hash = (value: unknown): value is string => typeof value === "string" && /^0x[\da-f]{64}$/i.test(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** A provider claim is preserved as such, never upgraded to an independent
 * on-chain proof. Source receipt, SDK DONE and a balance change are insufficient. */
export function classifyLifiStatus(intent: LifiTrackingIntent, response: unknown): LifiDeliveryEvidence {
  const status = object(response), sending = object(status.sending), receiving = object(status.receiving), token = object(receiving.token);
  const base: LifiDeliveryEvidence = { state: "pending", proof: "provider", reason: "destination_evidence_unavailable", sourceHash: intent.sourceHash };
  if (!hash(intent.sourceHash) || !hash(sending.txHash) || sending.txHash.toLowerCase() !== intent.sourceHash.toLowerCase() || sending.chainId !== intent.fromChainId || status.tool !== intent.tool ||
      (intent.transactionId && status.transactionId !== intent.transactionId)) return { ...base, state: "intervention", reason: "provider_source_binding_mismatch" };
  if (status.status !== "DONE") return { ...base, ...(status.status === "FAILED" || status.status === "INVALID" ? { state: "intervention" as const, reason: "provider_failure_requires_reconciliation" } : {}) };
  if (status.substatus === "REFUNDED") return { ...base, state: "refund", reason: "provider_reports_refund_unverified" };
  if (status.substatus === "PARTIAL") return { ...base, state: "alternative", reason: "provider_reports_partial_output" };
  if (status.substatus !== "COMPLETED") return base;
  if (!hash(receiving.txHash) || receiving.chainId !== intent.toChainId || token.chainId !== intent.toChainId || token.decimals !== intent.tokenDecimals ||
      normalizedSecurityAddress(token.address) !== normalizedSecurityAddress(intent.tokenAddress) ||
      normalizedSecurityAddress(status.fromAddress) !== normalizedSecurityAddress(intent.account) || normalizedSecurityAddress(status.toAddress) !== normalizedSecurityAddress(intent.recipient)) {
    return { ...base, state: "intervention", reason: "destination_identity_or_proof_mismatch" };
  }
  const amount = securityUint(receiving.amount), minimum = securityUint(intent.minimum);
  if (amount === null || minimum === null) return base;
  if (amount < minimum) return { ...base, state: "alternative", reason: "destination_below_minimum", destinationHash: receiving.txHash, amount: String(receiving.amount) };
  return { ...base, state: "delivered", reason: "expected_delivery_provider_verified", destinationHash: receiving.txHash, amount: String(receiving.amount) };
}
export async function trackLifiDelivery(intent: LifiTrackingIntent): Promise<LifiDeliveryEvidence> {
  try {
    const status = await getStatus(getLifiSdkClient(), { txHash: intent.sourceHash, fromChain: intent.fromChainId, toChain: intent.toChainId, bridge: intent.tool,
      ...(intent.transactionId ? { transactionId: intent.transactionId } : {}) }, { signal: AbortSignal.timeout(15_000) });
    return classifyLifiStatus(intent, status);
  } catch {
    return { state: "pending", proof: "provider", reason: "tracking_unavailable", sourceHash: intent.sourceHash };
  }
}
export function lifiTrackingIntent(route: RouteExtended): LifiTrackingIntent | undefined {
  const step = route.steps[0];
  const source = step?.execution?.actions.find(action => action.type === "CROSS_CHAIN" || action.type === "SWAP");
  if (!source?.txHash || !route.fromAddress || !route.toAddress) return undefined;
  return { routeId: route.id, sourceHash: source.txHash, fromChainId: route.fromChainId, toChainId: route.toChainId,
    account: route.fromAddress, recipient: route.toAddress, tokenAddress: route.toToken.address, tokenDecimals: route.toToken.decimals,
    minimum: route.toAmountMin, tool: step.tool, ...(step.transactionId ? { transactionId: step.transactionId } : {}) };
}

import type { IntentRecord, IntentStatus } from "./journal";
import { trackLifiDelivery, type LifiTrackingIntent } from "../aggregators/lifi/tracking";
import { readPendingRango, trackRangoTransaction } from "../aggregators/rango/tracking";
import { rangoToken } from "../aggregators/rango/validation";
import { readPendingOneClick, updatePendingOneClick } from "../aggregators/oneclick/tracking";

export type IntentTrackingResult = { status: IntentStatus; evidence: unknown; providerState?: unknown };
const failure = (reason: string): IntentTrackingResult => ({ status: "intervention_required", evidence: { reason } });
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

async function boundedOneClickStatus(depositAddress: string): Promise<unknown> {
  const response = await fetch(`/api/oneclick/status?depositAddress=${encodeURIComponent(depositAddress)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error("tracking_unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 65_536) { await reader.cancel(); throw new Error("tracking_response_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Restores only status queries from the immutable intent and known source hash.
 * This module has no wallet, approval, emission, SDK execution or resumeRoute. */
export async function trackIntentRecord(record: IntentRecord): Promise<IntentTrackingResult> {
  const seed = record.seed;
  if (!seed || record.version !== 2 || !record.wallet) return failure("legacy_intent_requires_manual_reconciliation");
  if (record.actions.some(action => ["emitting", "ambiguous"].includes(action.status))) return failure("source_submission_requires_reconciliation");
  const source = record.actions.find(action => ["swap", "deposit"].includes(action.kind) && action.hash);
  if (!source?.hash || source.status === "reverted") return failure("known_successful_source_required");
  if (record.provider === "lifi") {
    if (seed.selectedQuote.provider !== "lifi") return failure("provider_identity_mismatch");
    const route = seed.selectedQuote.raw; const step = route.steps[0];
    if (!step || route.steps.length !== 1) return failure("unsupported_saved_lifi_route");
    const saved = object(record.providerState);
    const steps = Array.isArray(saved.steps) ? saved.steps : [];
    const extendedStep = object(steps[0]);
    const transactionId = extendedStep.id === step.id && extendedStep.tool === step.tool && typeof extendedStep.transactionId === "string" ? extendedStep.transactionId : step.transactionId;
    const intent: LifiTrackingIntent = { routeId: seed.quoteId, sourceHash: source.hash, fromChainId: seed.request.fromChainId,
      toChainId: seed.request.toChainId, account: seed.wallet, recipient: seed.recipient, tokenAddress: seed.toToken.address,
      tokenDecimals: seed.toToken.decimals, minimum: seed.minimum, tool: step.tool, ...(transactionId ? { transactionId } : {}) };
    const evidence = await trackLifiDelivery(intent);
    const status: IntentStatus = evidence.state === "delivered" ? "delivered" : evidence.state === "alternative" ? "alternative_output" : evidence.state === "refund" ? "refund_pending" : evidence.state === "intervention" ? "intervention_required" : "destination_pending";
    return { status, evidence, providerState: { ...saved, hermesDelivery: evidence } };
  }
  if (record.provider === "rango") {
    const pending = readPendingRango(JSON.stringify({ ...object(record.providerState), journalId: record.id, txHash: source.hash }));
    if (!pending || !same(pending.account, seed.wallet) || pending.chainId !== seed.request.fromChainId || pending.minimum !== seed.minimum ||
        !pending.intent || !same(pending.intent.fromTokenAddress, seed.fromToken.address) || pending.intent.amount !== seed.request.fromAmount) return failure("stored_rango_identity_mismatch");
    const target = rangoToken(pending.toToken);
    if (target.chainId !== seed.toToken.chainId || !same(target.address, seed.toToken.address) || target.decimals !== seed.toToken.decimals) return failure("stored_rango_destination_mismatch");
    // A bounded one-shot poll; a user can request another read-only check.
    const result = await trackRangoTransaction(pending, 1, 0);
    return { status: result.status === "success" ? "delivered" : result.outcome ?? "destination_pending", evidence: result.evidence ?? { reason: "tracking_pending" }, providerState: result };
  }
  const pending = readPendingOneClick(JSON.stringify({ ...object(record.providerState), journalId: record.id, hash: source.hash }));
  if (!pending || pending.version !== 1 || !same(pending.wallet, seed.wallet) || pending.fromChainId !== seed.fromToken.chainId || pending.toChainId !== seed.toToken.chainId ||
      !same(pending.fromTokenAddress, seed.fromToken.address) || !same(pending.toTokenAddress, seed.toToken.address) || pending.fromTokenDecimals !== seed.fromToken.decimals ||
      pending.toTokenDecimals !== seed.toToken.decimals || pending.amount !== seed.request.fromAmount || BigInt(pending.minimum) < BigInt(seed.minimum)) return failure("stored_oneclick_identity_mismatch");
  try {
    const response = await boundedOneClickStatus(pending.depositAddress);
    const updated = updatePendingOneClick(pending, response);
    return { status: updated.status === "SUCCESS" ? "delivered" : "destination_pending", evidence: updated.version === 1 && updated.delivery ? updated.delivery : { reason: "destination_not_verified" }, providerState: updated };
  } catch { return { status: "destination_pending", evidence: { reason: "tracking_unavailable" }, providerState: pending }; }
}

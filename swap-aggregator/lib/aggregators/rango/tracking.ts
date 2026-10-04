import type { RangoExecution, RangoPending, RangoStatus } from "./types";
import { rangoRequest } from "./client";
import { isRequestId, isUint, rangoToken, sameRangoAsset, RANGO_CHAINS } from "./validation";

export const PENDING_RANGO_KEY = "hermes-rango-pending-v1";
export function readPendingRango(text: string | null): RangoPending | null {
  try {
    const pending = JSON.parse(text ?? "null") as RangoPending | null;
    if (!pending || pending.provider !== "rango" || !isRequestId(pending.requestId) || (pending.txHash != null && !/^0x[\da-f]{64}$/i.test(pending.txHash)) ||
        !RANGO_CHAINS[pending.chainId] || !/^0x[\da-f]{40}$/i.test(pending.account) || !isUint(pending.minimum)) return null;
    rangoToken(pending.toToken);
    if (!pending.txHash) {
      const intent = pending.intent;
      const tx = intent?.transaction;
      if (!intent || intent.version !== 1 || !/^0x[\da-f]{40}$/i.test(intent.fromTokenAddress) ||
          !isUint(intent.amount) || !Number.isSafeInteger(intent.submittedAt) || intent.submittedAt <= 0 ||
          !tx || tx.type !== "EVM" || !/^0x[\da-f]{40}$/i.test(tx.txTo) ||
          typeof tx.txData !== "string" || !/^0x(?:[\da-f]{2}){4,}$/i.test(tx.txData) ||
          Number(tx.blockChain?.chainId) !== pending.chainId ||
          typeof tx.value !== "string" || !/^(?:\d{1,78}|0x[\da-f]{1,64})$/i.test(tx.value)) return null;
    }
    return pending;
  } catch { return null; }
}
export async function trackRangoTransaction(pending: RangoPending, attempts = 75, intervalMs = 8000): Promise<RangoExecution> {
  // An intent without a hash is ambiguous, not permission to submit again.
  if (!pending.txHash) return { ...pending, status: "pending", message: "Rango: submission outcome unknown. Reconcile this intent with the wallet before sending again." };
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await rangoRequest<RangoStatus>("status", { requestId: pending.requestId, txId: pending.txHash });
      if (response.status === "failed") return { ...pending, status: "failed", outcome: "intervention_required", evidence: response,
        message: "Rango: provider reported failure. The transfer record is retained; reconcile source, destination and any refund before another send." };
      if (response.status === "success") {
        const expected = rangoToken(pending.toToken);
        const output = response.output;
        if (output && isUint(output.amount)) {
          if (output.type === "DESIRED_OUTPUT") {
            if (BigInt(output.amount) >= BigInt(pending.minimum) && sameRangoAsset(output.receivedToken, expected.chainId, expected.address) &&
                output.receivedToken.decimals === pending.toToken.decimals) return { ...pending, status: "success", evidence: response };
            return { ...pending, status: "failed", outcome: "alternative_output", evidence: response, message: "Rango: unexpected output. Reconcile the retained transfer and received token." };
          }
          if (["REVERTED_TO_INPUT", "MIDDLE_ASSET_IN_SRC", "MIDDLE_ASSET_IN_DEST"].includes(output.type)) {
            return { ...pending, status: "failed", outcome: output.type === "REVERTED_TO_INPUT" ? "refund_pending" : "alternative_output", evidence: response,
              message: "Rango: provider reported a refund or intermediate token. Retain the record until the expected asset, amount and recipient are reconciled." };
          }
        }
        // A bare success without verifiable output is not proof of delivery.
      }
    } catch { /* A tracking outage never means the transaction failed or is safe to resend. */ }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ...pending, status: "pending" };
}

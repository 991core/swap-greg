import type { RangoExecution, RangoPending, RangoStatus } from "./types";
import { rangoRequest } from "./client";
import { isRequestId, isUint, rangoToken, sameRangoAsset, RANGO_CHAINS } from "./validation";

export const PENDING_RANGO_KEY = "hermes-rango-pending-v1";
export function readPendingRango(text: string | null): RangoPending | null {
  try {
    const pending = JSON.parse(text ?? "null") as RangoPending | null;
    if (!pending || pending.provider !== "rango" || !isRequestId(pending.requestId) || !/^0x[\da-f]{64}$/i.test(pending.txHash) ||
        !RANGO_CHAINS[pending.chainId] || !/^0x[\da-f]{40}$/i.test(pending.account) || !isUint(pending.minimum)) return null;
    rangoToken(pending.toToken);
    return pending;
  } catch { return null; }
}
export async function trackRangoTransaction(pending: RangoPending, attempts = 75, intervalMs = 8000): Promise<RangoExecution> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await rangoRequest<RangoStatus>("status", { requestId: pending.requestId, txId: pending.txHash });
      if (response.status === "failed") return { ...pending, status: "failed", message: "Rango: transaction failed or refunded. Check the transaction before trying again." };
      if (response.status === "success") {
        const expected = rangoToken(pending.toToken);
        const output = response.output;
        if (output && isUint(output.amount)) {
          if (output.type === "DESIRED_OUTPUT") {
            if (BigInt(output.amount) >= BigInt(pending.minimum) && sameRangoAsset(output.receivedToken, expected.chainId, expected.address) &&
                output.receivedToken.decimals === pending.toToken.decimals) return { ...pending, status: "success" };
            return { ...pending, status: "failed", message: "Rango: unexpected output. Check the received token and transaction." };
          }
          if (["REVERTED_TO_INPUT", "MIDDLE_ASSET_IN_SRC", "MIDDLE_ASSET_IN_DEST"].includes(output.type)) {
            return { ...pending, status: "failed", message: "Rango: refund or intermediate token received. Check the transaction." };
          }
        }
        // A bare success without verifiable output is not proof of delivery.
      }
    } catch { /* A tracking outage never means the transaction failed or is safe to resend. */ }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ...pending, status: "pending" };
}

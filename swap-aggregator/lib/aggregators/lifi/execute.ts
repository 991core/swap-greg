import { executeRoute, type ExecutionOptions, type Route, type RouteExtended } from "@lifi/sdk";
import { getLifiExecutionClient } from "./client";
import type { TransactionAuthorizer } from "../../security/transaction-validator";
import type { LifiWalletSecurity } from "../../security/lifi-wallet";
import { createLifiExecutionPolicy } from "./policy";
import { lifiTrackingIntent, trackLifiDelivery, type LifiDeliveryEvidence } from "./tracking";
import { canExecuteNewSwap } from "../../release-mode";

export async function executeLifiRoute(route: Route, options?: ExecutionOptions,
  security?: { authorizeTransaction?: TransactionAuthorizer; check: () => void; journal?: LifiWalletSecurity["journal"]; executionAllowed?: () => boolean }): Promise<RouteExtended & { hermesDelivery?: LifiDeliveryEvidence }> {
  if (!security || typeof security.check !== "function") {
    throw new Error("A quote check is required before LI.FI execution.");
  }
  if (!canExecuteNewSwap()) throw new Error("Execution is disabled by the release mode.");
  if (!security.journal) throw new Error("A durable execution journal is required.");
  security.check();
  const selected = structuredClone(route);
  const account = selected.fromAddress ?? selected.steps[0]?.action.fromAddress;
  const protocol = selected.steps[0]?.tool;
  if (!account || !protocol) throw new Error("The LI.FI execution identity is missing.");
  const policy = createLifiExecutionPolicy(selected, {
    ...options,
    updateRouteHook(updated) {
      security.journal?.saveProviderState?.(updated);
      for (const action of updated.steps.flatMap(step => step.execution?.actions ?? [])) {
        if (action.status !== "DONE" || !action.txHash || !["SET_ALLOWANCE", "RESET_ALLOWANCE", "SWAP", "CROSS_CHAIN"].includes(action.type)) continue;
        const saved = security.journal?.snapshot?.().actions.find(saved => saved.hash?.toLowerCase() === action.txHash!.toLowerCase() && saved.status === "known");
        if (saved) security.journal?.confirmed?.(saved.id, { proof: "sdk_source_receipt", action: action.type, hash: action.txHash });
      }
      options?.updateRouteHook?.(updated);
    },
  }, security.check);
  const quotedNativeGasReserve = selected.steps.flatMap(step => step.estimate.gasCosts ?? [])
    .filter(cost => cost.token.chainId === selected.fromChainId && /^0x0{40}$/i.test(cost.token.address))
    .reduce((sum, cost) => { if (!/^\d+$/.test(cost.amount)) throw new Error("Invalid quoted gas reserve."); return sum + BigInt(cost.amount); }, BigInt(0)).toString();
  const client = getLifiExecutionClient({ ...security, check: policy.check, checkTransaction: policy.checkTransaction, maxNativeValue: policy.maxNativeValue, account, chainId: selected.fromChainId, protocol,
    fromTokenAddress: selected.fromToken.address, fromAmount: selected.fromAmount, quotedNativeGasReserve });
  const result = await executeRoute(client, selected, policy.options);
  const intent = lifiTrackingIntent({ ...result, toAmountMin: selected.toAmountMin, fromAddress: selected.fromAddress, toAddress: selected.toAddress, fromToken: selected.fromToken, toToken: selected.toToken, fromChainId: selected.fromChainId, toChainId: selected.toChainId });
  const hermesDelivery: LifiDeliveryEvidence = intent ? await trackLifiDelivery(intent) : {
    state: "pending", proof: "provider", reason: "source_hash_unavailable", sourceHash: "",
  };
  return Object.assign(result, { hermesDelivery });
}

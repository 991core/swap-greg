import { executeRoute, type ExecutionOptions, type Route } from "@lifi/sdk";
import { getLifiExecutionClient } from "./client";
import type { TransactionAuthorizer } from "../../security/transaction-validator";

export async function executeLifiRoute(route: Route, options?: ExecutionOptions,
  security?: { authorizeTransaction: TransactionAuthorizer; check: () => void }) {
  if (!security || typeof security.authorizeTransaction !== "function" || typeof security.check !== "function") {
    throw new Error("A transaction authorizer is required before LI.FI execution.");
  }
  security.check();
  const account = route.fromAddress ?? route.steps[0]?.action.fromAddress;
  const protocol = route.steps[0]?.tool;
  if (!account || !protocol) throw new Error("The LI.FI execution identity is missing.");
  const quotedNativeGasReserve = route.steps.flatMap(step => step.estimate.gasCosts ?? [])
    .filter(cost => cost.token.chainId === route.fromChainId && /^0x0{40}$/i.test(cost.token.address))
    .reduce((sum, cost) => sum + (/^\d+$/.test(cost.amount) ? BigInt(cost.amount) : BigInt(0)), BigInt(0)).toString();
  const client = getLifiExecutionClient({ ...security, account, chainId: route.fromChainId, protocol,
    fromTokenAddress: route.fromToken.address, fromAmount: route.fromAmount, quotedNativeGasReserve });
  return executeRoute(client, route, { ...options, acceptExchangeRateUpdateHook: async () => false });
}

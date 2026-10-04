import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@lifi/sdk";
import { EthereumCheckAllowanceTask } from "../node_modules/@lifi/sdk-provider-ethereum/dist/esm/core/tasks/EthereumCheckAllowanceTask.js";
import { EthereumResetAllowanceTask } from "../node_modules/@lifi/sdk-provider-ethereum/dist/esm/core/tasks/EthereumResetAllowanceTask.js";
import { EthereumSetAllowanceTask } from "../node_modules/@lifi/sdk-provider-ethereum/dist/esm/core/tasks/EthereumSetAllowanceTask.js";
import { StatusManager } from "../node_modules/@lifi/sdk/dist/esm/core/StatusManager.js";
import { executionState } from "../node_modules/@lifi/sdk/dist/esm/core/executionState.js";
import { rawRoute, wallet } from "./fixtures";
const ids: string[] = [];
afterEach(() => ids.splice(0).forEach(id => executionState.delete(id)));
describe("installed SDK allowance task decisions", () => {
  it.each(["0", "1", "100", "101"])("finite approval and optional reset for allowance %s", async amount => {
    const route = rawRoute(`allowance-${amount}`); ids.push(route.id);
    route.steps[0].action.fromAmount = "100";
    route.steps[0].action.fromToken = { ...route.fromToken, address: wallet };
    route.steps[0].estimate.approvalAddress = wallet;
    route.steps[0].estimate.approvalReset = true;
    executionState.create({ route });
    const statusManager = new StatusManager(route.id); statusManager.initializeExecution(route.steps[0]);
    const readContract = vi.fn(async () => BigInt(amount));
    const walletClient = { account: { address: wallet }, readContract };
    const context = { step: route.steps[0], client: createClient({ integrator: "test", preloadChains: false }), statusManager,
      ethereumClient: walletClient, checkClient: async () => walletClient, fromChain: { id: 8453, permit2: wallet, permit2Proxy: wallet },
      disableMessageSigning: true, isFromNativeToken: false, executionStrategy: "standard" };
    const result = await new EthereumCheckAllowanceTask().run(context as never);
    expect(result).toMatchObject({ context: { hasAllowance: BigInt(amount) > BigInt(0), hasSufficientAllowance: BigInt(amount) >= BigInt(100), executionStrategy: "standard" } });
    const afterCheck = { ...context, ...result.context };
    expect(await new EthereumSetAllowanceTask().shouldRun(afterCheck as never)).toBe(BigInt(amount) < BigInt(100));
    expect(await new EthereumResetAllowanceTask().shouldRun(afterCheck as never)).toBe(BigInt(amount) > BigInt(0) && BigInt(amount) < BigInt(100));
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "allowance", args: [wallet, wallet] }));
  });
});

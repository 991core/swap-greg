import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@lifi/sdk";
import { EthereumPrepareTransactionTask } from "../node_modules/@lifi/sdk-provider-ethereum/dist/esm/core/tasks/EthereumPrepareTransactionTask.js";
import { StatusManager } from "../node_modules/@lifi/sdk/dist/esm/core/StatusManager.js";
import { executionState } from "../node_modules/@lifi/sdk/dist/esm/core/executionState.js";
import { createLifiExecutionPolicy, assertLifiExecutionCapability, lifiNativeSpendBudget } from "../lib/aggregators/lifi/policy";
import { rawRoute, wallet, native } from "./fixtures";

const ids: string[] = [];
afterEach(() => ids.splice(0).forEach(id => executionState.delete(id)));
async function prepare(minimum: string) {
  const selected = rawRoute(`policy-${minimum}`);
  selected.toAmountMin = "1000000";
  selected.steps[0].estimate.toAmountMin = "1000000";
  selected.steps[0].action.slippage = 0.005;
  selected.steps[0].tool = "thorswap";
  const policy = createLifiExecutionPolicy(selected, {}, vi.fn());
  const route = structuredClone(selected);
  ids.push(route.id);
  executionState.create({ route, executionOptions: policy.options });
  const statusManager = new StatusManager(route.id);
  statusManager.initializeExecution(route.steps[0]);
  statusManager.initializeAction({ step: route.steps[0], type: "CROSS_CHAIN", status: "STARTED", chainId: 8453 });
  const response = { ...structuredClone(route.steps[0]), estimate: { ...route.steps[0].estimate, toAmountMin: minimum },
    transactionRequest: { from: wallet, to: wallet, chainId: 8453, data: "0xdeadbeef", value: selected.fromAmount } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } })));
  const task = new EthereumPrepareTransactionTask();
  const promise = task.run({ step: route.steps[0], client: createClient({ integrator: "test", preloadChains: false }), executionOptions: policy.options,
    statusManager, allowUserInteraction: true, isBridgeExecution: true, ethereumClient: { account: { type: "json-rpc", address: wallet } }, checkClient: async () => { throw Error("unsupported capability"); }, executionStrategy: "standard" } as never);
  return { promise, policy, route };
}
describe("LI.FI official prepared-step consent boundary", () => {
  it.each(["995001", "994900"])("blocks reconstructed minimum %s before a wallet task", async minimum => {
    const f = await prepare(minimum);
    await expect(f.promise).rejects.toThrow(minimum === "995001" ? "minimum_below_consent" : "Exchange rate");
  });
  it.each(["1000000", "1001000"])("accepts rebuilt minimum %s and binds the exact wallet request", async minimum => {
    const f = await prepare(minimum);
    await expect(f.promise).resolves.toMatchObject({ status: "COMPLETED" });
    expect(() => f.policy.checkTransaction({ to: wallet, data: "0xdeadbeef", value: f.route.fromAmount })).not.toThrow();
    expect(() => f.policy.checkTransaction({ to: wallet, data: "0xdeadbeef", value: "999" })).toThrow("transaction_not_bound");
  });
  it("captures consent independently of mutations to the caller's route", () => {
    const route = rawRoute(); const policy = createLifiExecutionPolicy(route, {}, vi.fn());
    route.toAmountMin = "1"; route.steps[0].estimate.toAmountMin = "1";
    policy.options.updateRouteHook?.(route);
    expect(policy.check).toThrow("minimum_below_consent");
  });
  it("blocks fee increases on reconstructed steps", () => {
    const route = rawRoute(); const policy = createLifiExecutionPolicy(route, {}, vi.fn());
    route.steps[0].estimate.feeCosts = [{ amount: "1", included: false, token: route.fromToken } as never];
    policy.options.updateRouteHook?.(route);
    expect(policy.check).toThrow("fees_above_consent");
  });
  it("adds only explicit native fees not already included in principal", () => {
    const route = rawRoute();
    route.fromAmount = "100"; route.steps[0].action.fromAmount = "100";
    route.steps[0].estimate.feeCosts = [
      { amount: "5", included: false, token: route.fromToken },
      { amount: "99", included: true, token: route.fromToken },
      { amount: "50", included: false, token: { ...route.fromToken, address: wallet } },
    ] as never;
    expect(lifiNativeSpendBudget(route)).toBe("105");
    route.fromToken = { ...route.fromToken, address: wallet };
    expect(lifiNativeSpendBudget(route)).toBe("5");
    route.steps[0].estimate.feeCosts = [{ amount: "NaN", included: false, token: route.fromToken }] as never;
    expect(() => lifiNativeSpendBudget(route)).toThrow("invalid_quoted_fee");
  });
  it("rejects additional wallet stages and typed relay before sending", () => {
    const route = rawRoute(); route.steps.push(structuredClone(route.steps[0]));
    expect(() => assertLifiExecutionCapability(route)).toThrow("multiple_wallet_steps");
    route.steps.pop(); route.steps[0].typedData = [{}] as never;
    expect(() => assertLifiExecutionCapability(route)).toThrow("unsupported_wallet_capability");
  });
  it("keeps included automatic destination steps available", () => {
    const route = rawRoute(); route.steps[0].includedSteps = [{ type: "swap", action: { ...route.steps[0].action, fromChainId: route.toChainId, fromToken: { ...route.toToken, address: native } } }] as never;
    expect(() => assertLifiExecutionCapability(route)).not.toThrow();
  });
});

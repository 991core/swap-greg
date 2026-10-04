import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/aggregators/lifi/client", () => ({ getLifiSdkClient: vi.fn() }));
import { classifyLifiStatus, type LifiTrackingIntent } from "../lib/aggregators/lifi/tracking";
import { wallet, native } from "./fixtures";
import { WaitForTransactionStatusTask } from "../node_modules/@lifi/sdk/dist/esm/core/tasks/WaitForTransactionStatusTask.js";
import { StatusManager } from "../node_modules/@lifi/sdk/dist/esm/core/StatusManager.js";
import { executionState } from "../node_modules/@lifi/sdk/dist/esm/core/executionState.js";
const sourceHash = `0x${"ab".repeat(32)}`, destinationHash = `0x${"cd".repeat(32)}`;
const intent: LifiTrackingIntent = { routeId: "a", sourceHash, fromChainId: 1, toChainId: 8453, account: wallet, recipient: wallet, tokenAddress: native, tokenDecimals: 18, minimum: "1000000", tool: "bridge", transactionId: "provider-a" };
function proof() { return { status: "DONE", substatus: "COMPLETED", tool: "bridge", transactionId: "provider-a", fromAddress: wallet, toAddress: wallet,
  sending: { txHash: sourceHash, chainId: 1 }, receiving: { txHash: destinationHash, chainId: 8453, amount: "1000000", token: { chainId: 8453, address: native, decimals: 18 } } }; }
describe("LI.FI expected destination delivery", () => {
  it.each(["PARTIAL", "REFUNDED"])("rejects the real SDK DONE interpretation of %s", async substatus => {
    const step = { id: "step", tool: "bridge", action: { fromChainId: 1, toChainId: 8453 }, execution: { startedAt: Date.now(), status: "PENDING", actions: [{ type: "CROSS_CHAIN", status: "DONE", txHash: sourceHash }] } };
    const route = { id: `destination-${substatus}`, steps: [step] };
    const data = { ...proof(), substatus, sending: { ...proof().sending, amount: "1000" }, receiving: { ...proof().receiving, chainId: 1, amount: "1", token: { ...proof().receiving.token, chainId: 1 } } };
    executionState.create({ route } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data))));
    try {
      await new WaitForTransactionStatusTask("RECEIVING_CHAIN").run({ client: { config: { integrator: "test", apiUrl: "https://mock.invalid" } },
        step, statusManager: new StatusManager(route.id), toChain: { id: 8453, metamask: { blockExplorerUrls: ["https://mock.invalid/"] } }, isBridgeExecution: true } as never);
      expect(step.execution.status).toBe("DONE");
      expect(classifyLifiStatus(intent, data).state).toBe(substatus === "PARTIAL" ? "alternative" : "refund");
    } finally { executionState.delete(route.id); }
  });
  it("requires complete bound provider evidence at minimum", () => { expect(classifyLifiStatus(intent, proof())).toMatchObject({ state: "delivered", proof: "provider", destinationHash }); });
  it.each(["PARTIAL", "REFUNDED", undefined, "OTHER"])("does not label DONE/%s expected delivery", substatus => { expect(classifyLifiStatus(intent, { ...proof(), substatus }).state).not.toBe("delivered"); });
  it.each(["source_hash", "source_chain", "provider_id", "tool", "recipient", "account", "chain", "token_chain", "address", "decimals", "amount", "hash"])("rejects incorrect or absent %s evidence", field => {
    const data = proof();
    if (field === "source_hash") data.sending.txHash = destinationHash;
    if (field === "source_chain") data.sending.chainId = 8453;
    if (field === "provider_id") data.transactionId = "other";
    if (field === "tool") data.tool = "other";
    if (field === "recipient") data.toAddress = native;
    if (field === "account") data.fromAddress = native;
    if (field === "chain") data.receiving.chainId = 1;
    if (field === "token_chain") data.receiving.token.chainId = 1;
    if (field === "address") data.receiving.token.address = wallet;
    if (field === "decimals") data.receiving.token.decimals = 6;
    if (field === "amount") data.receiving.amount = "999999";
    if (field === "hash") data.receiving.txHash = "";
    expect(classifyLifiStatus(intent, data).state).not.toBe("delivered");
  });
  it.each([null, {}, { status: "DONE" }, { status: "FAILED" }, { status: "NOT_FOUND" }])("conserves unproven output as unresolved", response => { expect(classifyLifiStatus(intent, response).state).not.toBe("delivered"); });
});

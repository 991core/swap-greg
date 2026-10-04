import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), sendTransaction: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("../../../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));
vi.mock("../../../lib/release-mode", () => ({ canExecuteNewSwap: vi.fn(() => true), assertExecutionEnabled: vi.fn(async () => {}) }));
import { getAccount, getBalance, readContract, estimateGas, estimateFeesPerGas, sendTransaction, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { rangoRequest } from "../../../lib/aggregators/rango/client";
import { executeRangoRoute } from "../../../lib/aggregators/rango/execute";
import { assertExecutionEnabled, canExecuteNewSwap } from "../../../lib/release-mode";
import { exportIntentJournal, readIntentJournal, resetIntentJournalForTests } from "../../../lib/intent/journal";
import { hash, normalizedRango, rangoSwap, rangoTo, tokenSwap } from "../../../tests/rango-fixtures";
import { params, wallet } from "../../../tests/fixtures";

beforeEach(() => {
  resetIntentJournalForTests();
  vi.resetAllMocks();
  vi.mocked(canExecuteNewSwap).mockReturnValue(true); vi.mocked(assertExecutionEnabled).mockResolvedValue(undefined);
  vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: wallet, chainId: 8453 } as never);
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt("1000000000000000000") } as never);
  vi.mocked(readContract).mockResolvedValue(BigInt("1000000000000000000"));
  vi.mocked(estimateGas).mockResolvedValue(BigInt(100000)); vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(1) } as never);
  vi.mocked(sendTransaction).mockResolvedValue(hash); vi.mocked(writeContract).mockResolvedValue(hash);
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as never);
  vi.mocked(rangoRequest).mockImplementation(async operation => operation === "swap" ? rangoSwap() : { status: "success", output: { type: "DESIRED_OUTPUT", amount: "950000000000000", receivedToken: rangoTo } });
});

describe("Rango journal at real adapter boundaries", () => {
  it("archives isolated FAILED provider assertions and blocks a new send", async () => {
    vi.mocked(rangoRequest).mockImplementation(async operation => operation === "swap" ? rangoSwap() : { status: "failed", diagnosisUrl: "https://example.com/support" });
    const result = await executeRangoRoute(normalizedRango(), params, vi.fn());
    expect(result).toMatchObject({ status: "failed", outcome: "intervention_required" });
    expect(readIntentJournal()[0]).toMatchObject({ status: "intervention_required", providerState: { txHash: hash }, evidence: { status: "failed" } });
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("reconciliation_required");
    expect(sendTransaction).toHaveBeenCalledOnce();
  });
  it("retains incorrect provider output and the original minimum", async () => {
    vi.mocked(rangoRequest).mockImplementation(async operation => operation === "swap" ? rangoSwap() : { status: "success", output: { type: "DESIRED_OUTPUT", amount: "1", receivedToken: rangoTo } });
    const result = await executeRangoRoute(normalizedRango(), params, vi.fn());
    expect(result).toMatchObject({ status: "failed", outcome: "alternative_output" });
    expect(readIntentJournal()[0]).toMatchObject({ status: "alternative_output", seed: { minimum: normalizedRango().toAmountMin }, actions: [{ hash }] });
  });
  it("keeps the source hash if a UI persistence callback fails after submission", async () => {
    const callback = vi.fn(progress => { if (progress.stage === "tracking") throw new Error("legacy UI storage failed"); });
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn(), callback)).rejects.toThrow("legacy UI storage failed");
    expect(readIntentJournal()[0]).toMatchObject({ status: "destination_pending", actions: [{ hash }], providerState: { txHash: hash } });
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("reconciliation_required");
    expect(sendTransaction).toHaveBeenCalledOnce();
  });
  it("persists an ambiguous approval and refuses both another approval and the swap", async () => {
    const { input, route, data } = tokenSwap();
    vi.mocked(rangoRequest).mockResolvedValue(data);
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? BigInt(0) : BigInt("1000000000000"));
    vi.mocked(writeContract).mockRejectedValue(new Error("lost after approval broadcast"));
    await expect(executeRangoRoute(route, input, vi.fn())).rejects.toThrow("lost after approval");
    expect(readIntentJournal()[0]).toMatchObject({ status: "send_ambiguous", actions: [{ kind: "approval", status: "ambiguous" }] });
    await expect(executeRangoRoute(route, input, vi.fn())).rejects.toThrow("reconciliation_required");
    expect(writeContract).toHaveBeenCalledOnce(); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("exports a returned source hash when journal storage fails immediately after the wallet returns", async () => {
    const realSet = Storage.prototype.setItem;
    vi.mocked(sendTransaction).mockImplementation(async () => { vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); }); return hash; });
    try {
      await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("storage_unavailable");
      expect(JSON.parse(exportIntentJournal()).emergencyRecords[0].actions[0].hash).toBe(hash);
    } finally { Storage.prototype.setItem = realSet; vi.restoreAllMocks(); }
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("reconciliation_required");
    expect(sendTransaction).toHaveBeenCalledOnce();
  });
  it("stops before wallet emission when the runtime incident policy changes after preparation", async () => {
    vi.mocked(assertExecutionEnabled).mockRejectedValueOnce(new Error("execution_disabled"));
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("execution_disabled");
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(readIntentJournal()[0]).toMatchObject({ status: "not_emitted", actions: [{ status: "not_sent" }] });
  });
  it("quotes-only mode refuses preparation and any wallet action", async () => {
    vi.mocked(canExecuteNewSwap).mockReturnValue(false);
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("release mode");
    expect(rangoRequest).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
  });
});

// Independent reproduction: the runtime policy wait is an asynchronous boundary.
describe("independent final funds boundary", () => {
  it("shows Rango forwarding a request after funds disappear during the incident-policy wait", async () => {
    vi.mocked(assertExecutionEnabled).mockImplementationOnce(async () => {
      vi.mocked(getBalance).mockResolvedValue({ value: BigInt(1) } as never);
    });
    await executeRangoRoute(normalizedRango(), params, vi.fn());
    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(getBalance).toHaveBeenLastCalledWith(expect.anything(), expect.anything());
  });
});

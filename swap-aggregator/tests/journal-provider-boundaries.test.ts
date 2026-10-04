import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getTransactionCount: vi.fn(), getBytecode: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), sendTransaction: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));
vi.mock("../lib/release-mode", () => ({ canExecuteNewSwap: vi.fn(() => true), assertExecutionEnabled: vi.fn(async () => {}) }));
import { getAccount, getBalance, getBytecode, getTransactionCount, readContract, estimateGas, estimateFeesPerGas, sendTransaction, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { rangoRequest } from "../lib/aggregators/rango/client";
import { executeRangoRoute } from "../lib/aggregators/rango/execute";
import { assertExecutionEnabled, canExecuteNewSwap } from "../lib/release-mode";
import { exportIntentJournal, readIntentJournal, resetIntentJournalForTests } from "../lib/intent/journal";
import { hash, normalizedRango, rangoSwap, rangoTo, tokenSwap } from "./rango-fixtures";
import { params, wallet } from "./fixtures";

beforeEach(() => {
  resetIntentJournalForTests();
  vi.resetAllMocks();
  vi.mocked(canExecuteNewSwap).mockReturnValue(true); vi.mocked(assertExecutionEnabled).mockResolvedValue(undefined);
  vi.mocked(getBytecode).mockResolvedValue(undefined);
  vi.mocked(getTransactionCount).mockImplementation(async () => {
    const { readIntentJournal } = await import("../lib/intent/journal");
    const nonces = readIntentJournal().flatMap(record => record.actions.flatMap(action => action.hash && action.nonce !== undefined ? [action.nonce] : []));
    return nonces.length ? Math.max(...nonces) + 1 : 17;
  });
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
    const progress = vi.fn();
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn(), progress)).rejects.toThrow("execution_disabled");
    expect(progress).toHaveBeenLastCalledWith({ stage: "failed", pending: null });
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(readIntentJournal()[0]).toMatchObject({ status: "not_emitted", actions: [{ status: "not_sent" }] });
  });
  it("rejects funds lost while waiting for the runtime policy check before wallet emission", async () => {
    vi.mocked(assertExecutionEnabled).mockImplementationOnce(async () => { vi.mocked(getBalance).mockResolvedValue({ value: BigInt(0) } as never); });
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("insufficient native");
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(readIntentJournal()[0]).toMatchObject({ status: "not_emitted", actions: [{ status: "not_sent" }] });
  });
  it("refuses deployed contract wallets or EIP-7702 delegated accounts before any wallet request", async () => {
    vi.mocked(getBytecode).mockResolvedValue("0xef0100abcd");
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("Contract wallets");
    expect(sendTransaction).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
  });
  it("does not publish a no-hash pending when the nonce RPC fails before a wallet request", async () => {
    const progress = vi.fn(); vi.mocked(getTransactionCount).mockRejectedValueOnce(new Error("nonce unavailable"));
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn(), progress)).rejects.toThrow("nonce unavailable");
    expect(progress.mock.calls.some(([value]) => value.pending)).toBe(false);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(readIntentJournal()[0]).toMatchObject({ status: "not_emitted", actions: [] });
  });
  it("does not replace another transaction if the pending source nonce changed during preparation", async () => {
    vi.mocked(getTransactionCount).mockResolvedValueOnce(17).mockResolvedValueOnce(18);
    const progress = vi.fn();
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn(), progress)).rejects.toThrow("nonce changed");
    expect(sendTransaction).not.toHaveBeenCalled(); expect(progress).toHaveBeenLastCalledWith({ stage: "failed", pending: null });
  });
  it("quotes-only mode refuses preparation and any wallet action", async () => {
    vi.mocked(canExecuteNewSwap).mockReturnValue(false);
    await expect(executeRangoRoute(normalizedRango(), params, vi.fn())).rejects.toThrow("release mode");
    expect(rangoRequest).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi } from "viem";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), switchChain: vi.fn(), estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), sendTransaction: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));
vi.mock("../lib/aggregators/lifi/execute", () => ({ executeLifiRoute: vi.fn() }));
vi.mock("../lib/tokens/client", () => ({ getTokenDetails: vi.fn() }));
import { estimateGas, estimateFeesPerGas, getAccount, getBalance, readContract, sendTransaction, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { executeLifiRoute } from "../lib/aggregators/lifi/execute";
import { getTokenDetails } from "../lib/tokens/client";
import { rangoRequest } from "../lib/aggregators/rango/client";
import { validateRangoTransaction } from "../lib/aggregators/rango/execute";
import { executeSwapQuote } from "../lib/routing/execute";
import { trackRangoTransaction, readPendingRango } from "../lib/aggregators/rango/tracking";
import { getCatalogToken } from "../lib/tokens/catalog";
import { params, wallet, fromToken, toToken } from "./fixtures";
import { hash, normalizedRango, pendingRango, rangoSwap, rangoTo, router, tokenSwap } from "./rango-fixtures";

const successStatus = () => ({ status: "success", output: { type: "DESIRED_OUTPUT", amount: "950000000000000", receivedToken: rangoTo } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: wallet, chainId: 8453 } as never);
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt("1000000000000000000"), decimals: 18, symbol: "ETH", formatted: "1" });
  vi.mocked(readContract).mockResolvedValue(BigInt("1000000000000000000"));
  vi.mocked(estimateGas).mockResolvedValue(BigInt(100000));
  vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(1), maxPriorityFeePerGas: BigInt(1), formatted: { maxFeePerGas: "1", maxPriorityFeePerGas: "1" } });
  vi.mocked(sendTransaction).mockResolvedValue(hash); vi.mocked(writeContract).mockResolvedValue(hash);
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as never);
  vi.mocked(rangoRequest).mockImplementation(async (operation) => operation === "swap" ? rangoSwap() : successStatus());
});
describe("Rango signing boundary", () => {
  it("executes EVM natively and tracks the destination without using LI.FI", async () => {
    const progress = vi.fn();
    const result = await executeSwapQuote(normalizedRango(), params, vi.fn(), { fromToken, toToken }, progress);
    expect(result).toMatchObject({ provider: "rango", status: "success", txHash: hash });
    expect(sendTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chainId: 8453, account: wallet, value: BigInt(params.fromAmount), to: router }));
    expect(executeLifiRoute).not.toHaveBeenCalled(); expect(getTokenDetails).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "tracking", pending: expect.objectContaining({ txHash: hash }) }));
  });
  it("never signs an expired quote", async () => {
    await expect(executeSwapQuote({ ...normalizedRango(), expiresAt: Date.now() }, params, vi.fn(), { fromToken, toToken })).rejects.toThrow("quote_changed");
    expect(sendTransaction).not.toHaveBeenCalled(); expect(rangoRequest).not.toHaveBeenCalled();
  });
  it("rechecks the account after transaction creation", async () => {
    vi.mocked(rangoRequest).mockImplementation(async () => { vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: router, chainId: 8453 } as never); return rangoSwap(); });
    await expect(executeSwapQuote(normalizedRango(), params, vi.fn(), { fromToken, toToken })).rejects.toThrow("quote_changed"); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("rechecks the chain after gas estimation", async () => {
    vi.mocked(estimateGas).mockImplementation(async () => { vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: wallet, chainId: 1 } as never); return BigInt(100000); });
    await expect(executeSwapQuote(normalizedRango(), params, vi.fn(), { fromToken, toToken })).rejects.toThrow("quote_changed"); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("checks fresh transaction gas instead of relying only on the quote", async () => {
    vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt("100000000000000"), maxPriorityFeePerGas: BigInt(1), formatted: { maxFeePerGas: "100000000000000", maxPriorityFeePerGas: "1" } });
    await expect(executeSwapQuote(normalizedRango(), params, vi.fn(), { fromToken, toToken })).rejects.toThrow("insufficient native"); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("limits ERC-20 approvals, waits for the receipt and rebuilds the transaction", async () => {
    const { input, data, route } = tokenSwap(); let approved = false;
    vi.mocked(rangoRequest).mockImplementation(async operation => operation === "swap" ? structuredClone(data) : successStatus());
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? (approved ? BigInt(input.fromAmount) : BigInt(0)) : BigInt("1000000000000"));
    vi.mocked(writeContract).mockImplementation(async () => { approved = true; return hash; });
    const result = await executeSwapQuote(route, input, vi.fn(), { fromToken: getCatalogToken(8453, input.fromTokenAddress)!, toToken });
    expect(result).toMatchObject({ status: "success" });
    expect(writeContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ address: input.fromTokenAddress, functionName: "approve", args: [router, BigInt(input.fromAmount)] }));
    expect(waitForTransactionReceipt).toHaveBeenCalledOnce();
    expect(vi.mocked(rangoRequest).mock.calls.filter(call=>call[0] === "swap")).toHaveLength(2);
    expect(sendTransaction).toHaveBeenCalledOnce();
  });
  it("resets an existing insufficient allowance before setting the exact amount", async () => {
    const { input, data, route } = tokenSwap(); let allowance = BigInt(1);
    vi.mocked(rangoRequest).mockImplementation(async operation => operation === "swap" ? structuredClone(data) : successStatus());
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? allowance : BigInt("1000000000000"));
    vi.mocked(writeContract).mockImplementation(async (_config, request) => { allowance = request.args![1] as bigint; return hash; });
    await executeSwapQuote(route, input, vi.fn(), { fromToken: getCatalogToken(8453, input.fromTokenAddress)!, toToken });
    expect(vi.mocked(writeContract).mock.calls.map(call=>call[1].args)).toEqual([[router,BigInt(0)],[router,BigInt(input.fromAmount)]]);
  });
  it("does not sign the swap if the quote expired during approval", async () => {
    const { input, data, route } = tokenSwap();
    vi.mocked(rangoRequest).mockResolvedValue(data);
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? BigInt(0) : BigInt("1000000000000"));
    vi.mocked(waitForTransactionReceipt).mockImplementation(async () => { route.expiresAt = Date.now(); return { status: "success" } as never; });
    await expect(executeSwapQuote(route, input, vi.fn(), { fromToken: getCatalogToken(8453, input.fromTokenAddress)!, toToken })).rejects.toThrow("quote_changed");
    expect(sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["value", "chain", "from", "type", "minimum", "swapper", "fees"])("rejects altered %s before signing", field => {
    const data = rangoSwap();
    if (field === "value") data.tx!.value = "1000000000000000000";
    if (field === "chain") data.tx!.blockChain.chainId = "1";
    if (field === "from") data.tx!.from = router;
    if (field === "type") (data.tx as unknown as { type: string }).type = "SOLANA";
    if (field === "minimum") data.route!.outputAmountMin = "1";
    if (field === "swapper") data.route!.swapper.id = "Other";
    if (field === "fees") data.route!.fee[0].amount = "99999999999999";
    expect(() => validateRangoTransaction(data, normalizedRango(), params)).toThrow();
  });
  it.each(["unlimited", "spender", "token", "transfer"])("rejects an unsafe %s approval", kind => {
    const { input, data, route } = tokenSwap(); const unsafe = structuredClone(data);
    if (kind === "unlimited") unsafe.tx!.approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, BigInt(2) ** BigInt(256) - BigInt(1)] });
    if (kind === "spender") unsafe.tx!.approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [wallet, BigInt(input.fromAmount)] });
    if (kind === "token") unsafe.tx!.approveTo = router;
    if (kind === "transfer") unsafe.tx!.approveData = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [router, BigInt(input.fromAmount)] });
    expect(() => validateRangoTransaction(unsafe, route, input)).toThrow();
  });
});
describe("Rango tracking", () => {
  it("does not report running or an unavailable status as failed/safe to retry", async () => {
    vi.mocked(rangoRequest).mockRejectedValue(new Error("offline"));
    expect(await trackRangoTransaction(pendingRango(), 1, 0)).toMatchObject({ status: "pending", txHash: hash });
    vi.mocked(rangoRequest).mockResolvedValue({ status: "running" });
    expect(await trackRangoTransaction(pendingRango(), 1, 0)).toMatchObject({ status: "pending" }); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("polls until destination success", async () => {
    vi.mocked(rangoRequest).mockResolvedValueOnce({ status: "running" }).mockResolvedValueOnce(successStatus());
    expect(await trackRangoTransaction(pendingRango(), 2, 0)).toMatchObject({ status: "success" });
  });
  it("keeps an incomplete success response pending instead of enabling a resend", async () => {
    vi.mocked(rangoRequest).mockResolvedValue({ status: "success", output: null });
    expect(await trackRangoTransaction(pendingRango(), 1, 0)).toMatchObject({ status: "pending" });
  });
  it("reports refunds/wrong tokens separately from success", async () => {
    vi.mocked(rangoRequest).mockResolvedValue({ status: "success", output: { ...successStatus().output, type: "MIDDLE_ASSET_IN_DEST" } });
    expect(await trackRangoTransaction(pendingRango(), 1, 0)).toMatchObject({ status: "failed" });
    vi.mocked(rangoRequest).mockResolvedValue({ status: "success", output: { ...successStatus().output, receivedToken: { ...rangoTo, address: router } } });
    expect(await trackRangoTransaction(pendingRango(), 1, 0)).toMatchObject({ status: "failed" });
  });
  it("restores only a valid tracking record, never signing from storage", () => {
    expect(readPendingRango(JSON.stringify(pendingRango()))).toEqual(pendingRango());
    expect(readPendingRango("broken")).toBeNull(); expect(readPendingRango(JSON.stringify({ ...pendingRango(), txHash: "javascript:bad" }))).toBeNull();
  });
});

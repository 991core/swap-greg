import { beforeEach, expect, it, vi } from "vitest";
import { getCatalogToken } from "../lib/tokens/catalog";
import { fetchOneClickRoute, fetchOneClickTokens } from "../lib/aggregators/oneclick/client";
import { canExecuteQuote } from "../lib/routing/quote";
import { executeOneClickRoute } from "../lib/aggregators/oneclick/execute";
import { estimateGas, estimateFeesPerGas, getBalance, readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn() }));
const fromToken = getCatalogToken(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;
const toToken = getCatalogToken(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")!;
const params = { fromChainId: 8453, toChainId: 1, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address,
  fromToken, toToken, fromTokenDecimals: 6, toTokenDecimals: 6, fromAmount: "100000000", fromAddress: "0x1111111111111111111111111111111111111111" };
const depositAddress = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const quote = () => ({ amountIn: params.fromAmount, amountOut: "99000000", minAmountOut: "98000000", timeEstimate: 60,
  depositAddress, deadline: new Date(Date.now() + 120_000).toISOString() });
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockImplementation(async () => Response.json(quote()));
  vi.mocked(estimateGas).mockResolvedValue(BigInt(50000)); vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(2) } as never);
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt(1000000) } as never); vi.mocked(readContract).mockResolvedValue(BigInt(100000000));
  vi.mocked(writeContract).mockResolvedValue(hash as `0x${string}`); vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as never);
});
it("requests previews without a wallet and keeps minimum, identities and expiry", async () => {
  const guest = { ...params, fromAddress: "" }; const [route] = await fetchOneClickRoute(guest);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ dry: true, fromTokenDecimals: 6, fromAmount: "100000000" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("wallet");
  expect(route.toAmountMin).toBe("98000000"); expect(route.raw.toToken).toEqual(toToken);
  expect(route.expiresAt - Date.now()).toBeGreaterThan(29_000);
  expect(canExecuteQuote(route, guest)).toBe(false); expect(canExecuteQuote(route, params)).toBe(false);
});
it("does not hide DAI or other valid EVM registry assets behind a top-token filter", async () => {
  fetchMock.mockResolvedValue(Response.json([{ blockchain: "base", contractAddress: fromToken.address, decimals: 6, symbol: "DAI", assetId: "test" }]));
  expect((await fetchOneClickTokens())[8453][0].symbol).toBe("DAI");
});
it("rejects malformed minimums and cancelled requests", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...quote(), minAmountOut: "100000000" }));
  await expect(fetchOneClickRoute(params)).rejects.toThrow("Invalid 1Click quote");
  fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
  await expect(fetchOneClickRoute(params, new AbortController().signal)).rejects.toThrow("Aborted");
});
it("records the deposit only after confirmation and gas checks", async () => {
  const [route] = await fetchOneClickRoute(params); const confirm = vi.fn(() => true); const onPending = vi.fn(); const check = vi.fn();
  const result = await executeOneClickRoute(route, params, check, { confirm, onPending });
  expect(confirm).toHaveBeenCalledOnce(); expect(writeContract).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalledTimes(3);
  expect(writeContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ functionName: "transfer", args: [depositAddress, BigInt(100000000)] }));
  expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ hash, status: "PENDING_DEPOSIT" })); expect(result?.provider).toBe("oneclick");
});
it("does not sign a worse minimum, changed wallet or declined confirmation", async () => {
  const [route] = await fetchOneClickRoute(params); const options = { confirm: vi.fn(() => false), onPending: vi.fn() };
  fetchMock.mockResolvedValueOnce(Response.json({ ...quote(), minAmountOut: "97000000" }));
  await expect(executeOneClickRoute(route, params, vi.fn(), options)).rejects.toThrow("minimum changed");
  await expect(executeOneClickRoute(route, params, () => { throw new Error("wallet changed"); }, options)).rejects.toThrow("wallet changed");
  expect(await executeOneClickRoute(route, params, vi.fn(), options)).toBeNull();
  expect(writeContract).not.toHaveBeenCalled(); expect(options.onPending).not.toHaveBeenCalled();
});
it("does not sign with insufficient gas or tokens", async () => {
  const [route] = await fetchOneClickRoute(params); const options = { confirm: () => true, onPending: vi.fn() };
  vi.mocked(getBalance).mockResolvedValueOnce({ value: BigInt(1) } as never);
  await expect(executeOneClickRoute(route, params, vi.fn(), options)).rejects.toThrow("gas");
  vi.mocked(readContract).mockResolvedValueOnce(BigInt(1));
  await expect(executeOneClickRoute(route, params, vi.fn(), options)).rejects.toThrow("token balance");
  expect(writeContract).not.toHaveBeenCalled();
});

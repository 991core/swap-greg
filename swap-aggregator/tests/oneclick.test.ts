import { beforeEach, expect, it, vi } from "vitest";
import { getCatalogToken } from "../lib/tokens/catalog";
import { fetchOneClickRoute, fetchOneClickTokens } from "../lib/aggregators/oneclick/client";
import { canExecuteQuote } from "../lib/routing/quote";
import { executeOneClickRoute } from "../lib/aggregators/oneclick/execute";
import { estimateGas, estimateFeesPerGas, getAccount, getBalance, getBytecode, getTransactionCount, readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), getAccount: vi.fn(), getTransactionCount: vi.fn(), getBytecode: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn() }));
const fromToken = getCatalogToken(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;
const toToken = getCatalogToken(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")!;
const params = { fromChainId: 8453, toChainId: 1, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address,
  fromToken, toToken, fromTokenDecimals: 6, toTokenDecimals: 6, fromAmount: "100000000", fromAddress: "0x1111111111111111111111111111111111111111" };
const depositAddress = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const quote = (dry = false, wallet = params.fromAddress) => {
  const deadline = new Date(Date.now() + 120_000).toISOString();
  const amounts = { amountIn: params.fromAmount, amountOut: "99000000", minAmountOut: "98000000", timeEstimate: 60 };
  return { ...amounts, ...(dry ? {} : { depositAddress, deadline }),
    originToken: { blockchain: "base", assetId: "nep141:base-usdc.omft.near", contractAddress: fromToken.address, decimals: 6, symbol: "USDC" },
    destinationToken: { blockchain: "eth", assetId: "nep141:eth-usdc.omft.near", contractAddress: toToken.address, decimals: 6, symbol: "USDC" },
    quoteResponse: { correlationId: "test-quote", timestamp: new Date().toISOString(), signature: "provider-signature",
      quoteRequest: { dry, swapType: "EXACT_INPUT", slippageTolerance: 50, originAsset: "nep141:base-usdc.omft.near",
        destinationAsset: "nep141:eth-usdc.omft.near", amount: params.fromAmount, depositType: "ORIGIN_CHAIN",
        refundTo: wallet, refundType: "ORIGIN_CHAIN", recipient: wallet, recipientType: "DESTINATION_CHAIN", deadline, depositMode: "SIMPLE" },
      quote: { ...amounts, ...(dry ? {} : { depositAddress, deadline }) } } };
};
const fetchMock = vi.fn();
const authorize = vi.fn(async () => {});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockImplementation(async (_url, init) => {
    if (_url === "/api/release") return Response.json({ executionEnabled: true });
    const request = JSON.parse(init.body);
    return Response.json(quote(request.dry, request.wallet ?? "0x0000000000000000000000000000000000000000"));
  });
  vi.mocked(estimateGas).mockResolvedValue(BigInt(50000)); vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(2) } as never);
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt(1000000) } as never); vi.mocked(readContract).mockResolvedValue(BigInt(100000000));
  vi.mocked(writeContract).mockResolvedValue(hash as `0x${string}`); vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as never);
  vi.mocked(getBytecode).mockResolvedValue(undefined);
  vi.mocked(getTransactionCount).mockResolvedValue(17);
  vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: params.fromAddress, chainId: params.fromChainId } as never);
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
it("executes without registry approval after confirmation and gas checks", async () => {
  const [route] = await fetchOneClickRoute(params); const confirm = vi.fn(() => true); const onPending = vi.fn(); const check = vi.fn();
  const result = await executeOneClickRoute(route, params, check, { confirm, onPending });
  expect(confirm).toHaveBeenCalledOnce(); expect(writeContract).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalled();
  expect(writeContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ functionName: "transfer", args: [depositAddress, BigInt(100000000)] }));
  expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ hash, status: "PENDING_DEPOSIT" })); expect(result?.provider).toBe("oneclick");
});
it("does not sign a worse minimum, changed wallet or declined confirmation", async () => {
  const [route] = await fetchOneClickRoute(params); const options = { confirm: vi.fn(() => false), onPending: vi.fn() };
  const worse = quote(); worse.minAmountOut = "97000000"; worse.quoteResponse.quote.minAmountOut = "97000000";
  fetchMock.mockResolvedValueOnce(Response.json(worse));
  await expect(executeOneClickRoute(route, params, vi.fn(), options, authorize)).rejects.toThrow("minimum changed");
  await expect(executeOneClickRoute(route, params, () => { throw new Error("wallet changed"); }, options, authorize)).rejects.toThrow("wallet changed");
  expect(await executeOneClickRoute(route, params, vi.fn(), options, authorize)).toBeNull();
  expect(writeContract).not.toHaveBeenCalled(); expect(options.onPending).not.toHaveBeenCalled();
});
it("does not sign with insufficient gas or tokens", async () => {
  const [route] = await fetchOneClickRoute(params); const options = { confirm: () => true, onPending: vi.fn() };
  vi.mocked(getBalance).mockResolvedValueOnce({ value: BigInt(1) } as never);
  await expect(executeOneClickRoute(route, params, vi.fn(), options, authorize)).rejects.toThrow("gas");
  vi.mocked(readContract).mockResolvedValueOnce(BigInt(1));
  await expect(executeOneClickRoute(route, params, vi.fn(), options, authorize)).rejects.toThrow("token balance");
  expect(writeContract).not.toHaveBeenCalled();
});
it("does not persist or sign a dynamic deposit rejected by the final local policy", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, async () => {
    throw new Error("UNKNOWN_TRANSACTION_TARGET");
  })).rejects.toThrow("UNKNOWN_TRANSACTION_TARGET");
  expect(onPending).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
});
it("rechecks the live 1Click wallet after asynchronous transaction authorization", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, async () => {
    vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: depositAddress, chainId: params.fromChainId } as never);
  })).rejects.toThrow("live wallet");
  expect(onPending).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
});
it.each(["native_balance", "token_balance", "gas_estimate", "gas_price"])("rechecks 1Click %s after server authorization before persisting or sending", async field => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, async () => {
    if (field === "native_balance") vi.mocked(getBalance).mockResolvedValue({ value: BigInt(1) } as never);
    if (field === "token_balance") vi.mocked(readContract).mockResolvedValue(BigInt(1));
    if (field === "gas_estimate") vi.mocked(estimateGas).mockResolvedValue(BigInt(1000000));
    if (field === "gas_price") vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(1000) } as never);
  })).rejects.toThrow(/balance/);
  expect(onPending).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
});

it.each([
  ["recipient", "0x3333333333333333333333333333333333333333"],
  ["refundTo", "0x3333333333333333333333333333333333333333"],
  ["originAsset", "nep141:wrong"], ["destinationAsset", "nep141:wrong"],
  ["amount", "1"], ["slippageTolerance", 51], ["dry", true],
  ["depositType", "INTENTS"], ["refundType", "INTENTS"], ["recipientType", "INTENTS"],
  ["swapType", "EXACT_OUTPUT"], ["depositMode", "MEMO"],
])("rejects a fresh deposit whose %s is unrelated to the selection", async (field, value) => {
  const [route] = await fetchOneClickRoute(params);
  const altered = quote(); Object.assign(altered.quoteResponse.quoteRequest, { [field]: value });
  fetchMock.mockResolvedValueOnce(Response.json(altered));
  const confirm = vi.fn(() => true); const onPending = vi.fn();
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm, onPending }, authorize)).rejects.toThrow();
  expect(writeContract).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(onPending).not.toHaveBeenCalled();
});
it("rejects an altered destination decimals and incomplete signature proof before confirmation", async () => {
  const [route] = await fetchOneClickRoute(params);
  const altered = quote(); altered.destinationToken.decimals = 18;
  fetchMock.mockResolvedValueOnce(Response.json(altered));
  const options = { confirm: vi.fn(() => true), onPending: vi.fn() };
  await expect(executeOneClickRoute(route, params, vi.fn(), options, authorize)).rejects.toThrow("asset evidence");
  fetchMock.mockResolvedValueOnce(Response.json({ ...quote(), quoteResponse: undefined }));
  await expect(executeOneClickRoute(route, params, vi.fn(), options, authorize)).rejects.toThrow();
  expect(writeContract).not.toHaveBeenCalled();
});
it("saves a versioned intention before sending and retains it after an ambiguous broadcast failure", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  vi.mocked(writeContract).mockImplementationOnce(async () => {
    expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ version: 1, status: "UNKNOWN", amount: params.fromAmount, minimum: "98000000" }));
    expect(onPending.mock.calls[0][0]).not.toHaveProperty("hash");
    throw new Error("connection lost after broadcasting");
  });
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, authorize)).rejects.toThrow("connection lost");
  expect(onPending).toHaveBeenCalledOnce(); expect(writeContract).toHaveBeenCalledOnce();
});
it("fails closed before wallet submission if the intention cannot be persisted", async () => {
  const [route] = await fetchOneClickRoute(params);
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending: () => { throw new Error("storage unavailable"); } }, authorize)).rejects.toThrow("storage unavailable");
  expect(writeContract).not.toHaveBeenCalled();
});
it("only releases a deposit when the wallet explicitly rejected it or its receipt reverted", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  vi.mocked(writeContract).mockRejectedValueOnce(Object.assign(new Error("denied"), { code: 4001 }));
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, authorize)).rejects.toThrow("denied");
  expect(onPending).toHaveBeenLastCalledWith(expect.objectContaining({ status: "FAILED", sourceOutcome: "rejected" }));
  vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "reverted" } as never);
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, authorize)).rejects.toThrow("reverted");
  expect(onPending).toHaveBeenLastCalledWith(expect.objectContaining({ hash, status: "FAILED", sourceOutcome: "reverted" }));
});
it("keeps the gas reserve margin and rechecks after asynchronous balance work", async () => {
  const [route] = await fetchOneClickRoute(params);
  vi.mocked(getBalance).mockResolvedValueOnce({ value: BigInt(110000) } as never);
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending: vi.fn() }, authorize)).rejects.toThrow("gas");
  const check = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error("account changed"); });
  await expect(executeOneClickRoute(route, params, check, { confirm: () => true, onPending: vi.fn() }, authorize)).rejects.toThrow("account changed");
  expect(writeContract).not.toHaveBeenCalled();
});

it("does not release or resend a deposit after receipt timeout", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  vi.mocked(waitForTransactionReceipt).mockRejectedValueOnce(new Error("receipt timeout"));
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, authorize)).rejects.toThrow("receipt timeout");
  expect(onPending).toHaveBeenLastCalledWith(expect.objectContaining({ hash, status: "PENDING_DEPOSIT" }));
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, authorize)).rejects.toThrow("reconciliation_required");
  expect(writeContract).toHaveBeenCalledOnce();
});
it("retains a deposit after an unknown source receipt status", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  vi.mocked(waitForTransactionReceipt).mockResolvedValueOnce({ status: "unknown" } as never);
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, authorize)).rejects.toThrow("Unknown source receipt");
  expect(onPending).toHaveBeenLastCalledWith(expect.objectContaining({ hash, status: "PENDING_DEPOSIT" }));
});

it("rechecks funds after the runtime execution policy await and does not send when native gas balance fell", async () => {
  const [route] = await fetchOneClickRoute(params);
  fetchMock.mockImplementation(async (_url, init) => {
    if (_url === "/api/release") { vi.mocked(getBalance).mockResolvedValue({ value: BigInt(0) } as never); return Response.json({ executionEnabled: true }); }
    const request = JSON.parse(init.body); return Response.json(quote(request.dry, request.wallet));
  });
  const onPending = vi.fn();
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending })).rejects.toThrow("gas");
  expect(onPending).toHaveBeenLastCalledWith(expect.objectContaining({ status: "FAILED", sourceOutcome: "not_sent" }));
  expect(writeContract).not.toHaveBeenCalled();
});

it("rejects a contract or delegated source account before requesting the 1Click transfer", async () => {
  const [route] = await fetchOneClickRoute(params); vi.mocked(getBytecode).mockResolvedValue("0xef0100abcd");
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending: vi.fn() })).rejects.toThrow("Contract wallets");
  expect(writeContract).not.toHaveBeenCalled();
});

it("does not publish an active no-hash deposit when the nonce RPC fails", async () => {
  const [route] = await fetchOneClickRoute(params); const onPending = vi.fn();
  vi.mocked(getTransactionCount).mockRejectedValueOnce(new Error("nonce unavailable"));
  await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending })).rejects.toThrow("nonce unavailable");
  expect(onPending).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
});

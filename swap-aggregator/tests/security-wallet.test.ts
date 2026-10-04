import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWalletClient, custom, encodeFunctionData, erc20Abi, type Client, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { setAllowance } from "../node_modules/@lifi/sdk-provider-ethereum/dist/esm/actions/setAllowance.js";
import { createGuardedLifiWallet, type LifiWalletSecurity } from "../lib/security/lifi-wallet";
import { getLifiExecutionClient, getLifiSdkClient } from "../lib/aggregators/lifi/client";
import { executeLifiRoute } from "../lib/aggregators/lifi/execute";
import { executeRangoRoute } from "../lib/aggregators/rango/execute";
import { executeOneClickRoute } from "../lib/aggregators/oneclick/execute";
import { rawRoute, params as nativeParams, wallet } from "./fixtures";
import { normalizedRango, tokenSwap, hash, rangoTo } from "./rango-fixtures";
import type { OneClickNormalizedRoute } from "../lib/types/normalized-route";
import { getAccount, getBalance, readContract, estimateGas, estimateFeesPerGas, writeContract, sendTransaction, waitForTransactionReceipt, getWalletClient } from "wagmi/actions";
import { rangoRequest } from "../lib/aggregators/rango/client";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), writeContract: vi.fn(), sendTransaction: vi.fn(), waitForTransactionReceipt: vi.fn(), getWalletClient: vi.fn(), switchChain: vi.fn() }));
vi.mock("../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));
const source = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, BigInt(100)] });
function setup() {
  let liveAccount = wallet; let liveChain = "0x1";
  let nativeBalance = BigInt(1000000), tokenBalance = BigInt(10000), gas = BigInt(10000), gasPrice = BigInt(2);
  const upstream = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [liveAccount];
    if (method === "eth_chainId") return liveChain;
    if (method === "eth_getBalance") return `0x${nativeBalance.toString(16)}`;
    if (method === "eth_call") return `0x${tokenBalance.toString(16).padStart(64, "0")}`;
    if (method === "eth_estimateGas") return `0x${gas.toString(16)}`;
    if (method === "eth_gasPrice") return `0x${gasPrice.toString(16)}`;
    if (method === "eth_sendTransaction") return hash;
    if (method === "eth_signTransaction") return "0xdead";
    throw new Error(`Unexpected mocked RPC ${method}`);
  });
  const original = createWalletClient({ account: wallet, chain: mainnet, transport: custom({ request: upstream }, { retryCount: 0 }) });
  const authorizeTransaction = vi.fn(async () => {}); const check = vi.fn();
  const security = { account: wallet, chainId: 1, protocol: "uniswap_v2", fromTokenAddress: source, fromAmount: "100", quotedNativeGasReserve: "21000", authorizeTransaction, check } satisfies LifiWalletSecurity;
  return { upstream, security, original, guarded: createGuardedLifiWallet(original, security), setAccount: (value: string) => { liveAccount = value; }, setChain: (value: string) => { liveChain = value; },
    setNativeBalance: (value: bigint) => { nativeBalance = value; }, setTokenBalance: (value: bigint) => { tokenBalance = value; },
    setGas: (value: bigint) => { gas = value; }, setGasPrice: (value: bigint) => { gasPrice = value; } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: wallet, chainId: 8453 } as never);
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt("1000000000000000000") } as never);
  vi.mocked(estimateGas).mockResolvedValue(BigInt(100000)); vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(1) } as never);
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as never);
  vi.mocked(writeContract).mockResolvedValue(hash); vi.mocked(sendTransaction).mockResolvedValue(hash);
});
describe("LI.FI final RPC barrier", () => {
  it("intercepts request, transport.request and recreated viem sendTransaction actions", async () => {
    for (const entry of ["request", "transport", "action"] as const) {
      const fixture = setup(); fixture.security.authorizeTransaction.mockRejectedValue(new Error("UNKNOWN_APPROVAL_TARGET"));
      const request = { method: "eth_sendTransaction", params: [{ from: wallet, to: source, data, value: "0x0" }] };
      const operation = entry === "request" ? fixture.guarded.request(request as never) : entry === "transport" ? fixture.guarded.transport.request(request) : fixture.guarded.sendTransaction({ account: wallet, to: source, data, chain: mainnet });
      await expect(operation).rejects.toThrow("UNKNOWN_APPROVAL_TARGET");
      expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
      expect(fixture.security.authorizeTransaction).toHaveBeenCalledOnce();
    }
  });
  it("intercepts the installed LI.FI allowance action after it builds calldata", async () => {
    const fixture = setup(); fixture.security.authorizeTransaction.mockRejectedValue(new Error("UNKNOWN_APPROVAL_TARGET"));
    await expect(setAllowance(getLifiSdkClient(), fixture.guarded, source, router, BigInt(100))).rejects.toThrow("UNKNOWN_APPROVAL_TARGET");
    expect(fixture.security.authorizeTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: source, data, value: "0" }), expect.objectContaining({ kind: "approval" }));
    expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it("rechecks account/network after asynchronous authorization and never forwards a stale request", async () => {
    for (const change of ["account", "chain", "check"] as const) {
      const fixture = setup(); fixture.security.authorizeTransaction.mockImplementation(async () => {
        if (change === "account") fixture.setAccount(router);
        if (change === "chain") fixture.setChain("0x2105");
        if (change === "check") fixture.security.check.mockImplementation(() => { throw new Error("quote_expired"); });
      });
      await expect(fixture.guarded.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: source, data }] } as never)).rejects.toThrow();
      expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
    }
  });
  it("keeps an immutable payload snapshot across authorization", async () => {
    const fixture = setup(); const transaction = { from: wallet, to: source, data, value: "0x0" };
    fixture.security.authorizeTransaction.mockImplementation(async () => { transaction.to = router; transaction.data = "0xdeadbeef"; });
    await fixture.guarded.request({ method: "eth_sendTransaction", params: [transaction] } as never);
    expect(fixture.upstream.mock.calls.at(-1)?.[0]).toMatchObject({ params: [expect.objectContaining({ to: source, data, chainId: "0x1" })] });
  });
  it.each(["native_balance", "token_balance", "gas_estimate", "gas_price"])("rereads %s after asynchronous authorization and refuses an unaffordable SDK transaction", async field => {
    const fixture = setup(); fixture.security.authorizeTransaction.mockImplementation(async () => {
      if (field === "native_balance") fixture.setNativeBalance(BigInt(1));
      if (field === "token_balance") fixture.setTokenBalance(BigInt(1));
      if (field === "gas_estimate") fixture.setGas(BigInt(1000000));
      if (field === "gas_price") fixture.setGasPrice(BigInt(1000));
    });
    await expect(fixture.guarded.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: source, data }] } as never)).rejects.toThrow("QUOTE_VALIDATION_FAILED");
    expect(fixture.security.authorizeTransaction).toHaveBeenCalledOnce();
    expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it("reserves quoted subsequent swap gas for approvals and considers the actual envelope fee ceiling", async () => {
    for (const requestFields of [{}, { maxFeePerGas: "0x3e8" }, { gas: "0x1" }]) {
      const fixture = setup(); fixture.setNativeBalance(BigInt(30000));
      await expect(fixture.guarded.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: source, data, ...requestFields }] } as never)).rejects.toThrow("QUOTE_VALIDATION_FAILED");
      expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
    }
  });
  it("rechecks wallet identity after live balance reads too", async () => {
    const fixture = setup(), implementation = fixture.upstream.getMockImplementation()!;
    fixture.upstream.mockImplementation(async args => { if (args.method === "eth_call") fixture.setAccount(router); return implementation(args); });
    await expect(fixture.guarded.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: source, data }] } as never)).rejects.toThrow("QUOTE_VALIDATION_FAILED");
    expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it.each(["eth_sign", "personal_sign", "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "eth_sendRawTransaction", "wallet_sendCalls", "wallet_signCalls", "eth_sendUserOperation", "wallet_switchEthereumChain"])("blocks unsupported signature/batch method %s before the actual wallet", async method => {
    const fixture = setup(); await expect(fixture.guarded.request({ method, params: [] } as never)).rejects.toThrow("QUOTE_VALIDATION_FAILED");
    expect(fixture.upstream).not.toHaveBeenCalled();
  });
  it("also guards signTransaction and rejects EIP7702/blob/unknown envelope fields", async () => {
    const fixture = setup(); fixture.security.authorizeTransaction.mockRejectedValue(new Error("denied"));
    await expect(fixture.guarded.request({ method: "eth_signTransaction", params: [{ from: wallet, to: source, data }] } as never)).rejects.toThrow("denied");
    expect(fixture.upstream).not.toHaveBeenCalled();
    for (const extra of [{ authorizationList: [] }, { blobVersionedHashes: [] }, { type: "0x4" }, { chainId: "0x2105" }]) {
      await expect(fixture.guarded.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: source, data, ...extra }] } as never)).rejects.toThrow("QUOTE_VALIDATION_FAILED");
    }
  });
  it("does not replay a wallet broadcast after an ambiguous outcome or invalid hash", async () => {
    for (const invalidHash of [false, true]) {
      const fixture = setup(); const implementation = fixture.upstream.getMockImplementation()!;
      fixture.upstream.mockImplementation(async args => {
        if (args.method === "eth_sendTransaction") {
          if (invalidHash) return "0x00";
          throw new Error("connection lost after possible broadcast");
        }
        return implementation(args);
      });
      const request = { method: "eth_sendTransaction", params: [{ from: wallet, to: source, data }] };
      await expect(fixture.guarded.request(request as never)).rejects.toThrow();
      await expect(fixture.guarded.request(request as never)).rejects.toThrow("QUOTE_VALIDATION_FAILED");
      expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(1);
      expect(fixture.security.authorizeTransaction).toHaveBeenCalledOnce();
    }
  });
  it("the SDK quote client cannot obtain an unguarded wallet and execution providers always wrap it", async () => {
    const quoteProvider = getLifiSdkClient().providers.find(provider => provider.type === "EVM")!;
    await expect((quoteProvider as unknown as { getWalletClient: () => Promise<Client> }).getWalletClient()).rejects.toThrow("authorizer");
    const fixture = setup(); vi.mocked(getWalletClient).mockResolvedValue(fixture.original as never);
    const executionProvider = getLifiExecutionClient(fixture.security).providers.find(provider => provider.type === "EVM")!;
    const client = await (executionProvider as unknown as { getWalletClient: () => Promise<Client> }).getWalletClient();
    fixture.security.authorizeTransaction.mockRejectedValue(new Error("denied"));
    await expect(client.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: source, data }] } as never)).rejects.toThrow("denied");
    expect(fixture.upstream.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
});
describe("direct provider executors", () => {
  it("fail closed without an authorizer, including direct calls outside common preflight", async () => {
    await expect(executeLifiRoute(rawRoute())).rejects.toThrow("authorizer");
    await expect(executeRangoRoute(normalizedRango(), nativeParams, vi.fn())).rejects.toThrow("authorizer");
    await expect(executeOneClickRoute({} as OneClickNormalizedRoute, nativeParams, vi.fn(), { confirm: () => true, onPending: vi.fn() })).rejects.toThrow("authorizer");
    expect(writeContract).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("authorizes every Rango reset, approval and final send independently", async () => {
    const { route, data: response, input } = tokenSwap(); let allowance = BigInt(1);
    vi.mocked(rangoRequest).mockImplementation(async operation => operation === "swap" ? structuredClone(response) : { status: "success", output: { type: "DESIRED_OUTPUT", amount: "950000000000000", receivedToken: rangoTo } });
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? allowance : BigInt("1000000000000000000"));
    vi.mocked(writeContract).mockImplementation(async (_config, request) => { allowance = request.args![1] as bigint; return hash; });
    const authorize = vi.fn(async () => {});
    await executeRangoRoute(route, input, vi.fn(), vi.fn(), authorize);
    expect(authorize.mock.calls.map(call => (call as unknown as [unknown, { kind: string }])[1].kind)).toEqual(["approval_reset", "approval", "swap"]);
    expect(writeContract).toHaveBeenCalledTimes(2); expect(sendTransaction).toHaveBeenCalledOnce();
  });
  it("stops all Rango signatures if registry authorization fails or the live wallet changes afterwards", async () => {
    const { route, data: response, input } = tokenSwap(); vi.mocked(rangoRequest).mockResolvedValue(response);
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? BigInt(0) : BigInt("1000000000000000000"));
    await expect(executeRangoRoute(route, input, vi.fn(), vi.fn(), async () => { throw new Error("TOKEN_NOT_IN_REGISTRY"); })).rejects.toThrow("TOKEN_NOT_IN_REGISTRY");
    await expect(executeRangoRoute(route, input, vi.fn(), vi.fn(), async () => { vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: router, chainId: 8453 } as never); })).rejects.toThrow("live wallet");
    expect(writeContract).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["approval_reset", "approval", "swap"])("rechecks Rango funds after authorizing %s before the wallet call", async kind => {
    const { route, data: response, input } = tokenSwap(); vi.mocked(rangoRequest).mockResolvedValue(response);
    const allowance = kind === "approval_reset" ? BigInt(1) : kind === "approval" ? BigInt(0) : BigInt(input.fromAmount);
    vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? allowance : BigInt("1000000000000000000"));
    const authorize = vi.fn(async () => { vi.mocked(getBalance).mockResolvedValue({ value: BigInt(0) } as never); });
    await expect(executeRangoRoute(route, input, vi.fn(), vi.fn(), authorize)).rejects.toThrow("insufficient native balance");
    expect((authorize.mock.calls[0] as unknown as [unknown, { kind: string }])[1].kind).toBe(kind);
    expect(writeContract).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled();
  });
  it("rechecks Rango token balance and gas after final swap authorization", async () => {
    for (const change of ["token", "gas", "fees"] as const) {
      const { route, data: response, input } = tokenSwap(); vi.mocked(rangoRequest).mockResolvedValue(response);
      vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? BigInt(input.fromAmount) : BigInt("1000000000000000000"));
      vi.mocked(estimateGas).mockResolvedValue(BigInt(100000)); vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(1) } as never);
      const authorize = async () => {
        if (change === "token") vi.mocked(readContract).mockResolvedValue(BigInt(0));
        if (change === "gas") vi.mocked(estimateGas).mockResolvedValue(BigInt("10000000000000000000"));
        if (change === "fees") vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt("10000000000000000000") } as never);
      };
      await expect(executeRangoRoute(route, input, vi.fn(), vi.fn(), authorize)).rejects.toThrow(/insufficient/);
      expect(writeContract).not.toHaveBeenCalled(); expect(sendTransaction).not.toHaveBeenCalled();
    }
  });
});

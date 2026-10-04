import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/release-mode", () => ({ canExecuteNewSwap: vi.fn(() => true), assertExecutionEnabled: vi.fn(async () => {}) }));
import { canExecuteNewSwap } from "../lib/release-mode";
import { createWalletClient, custom, encodeFunctionData, erc20Abi } from "viem";
import { mainnet } from "viem/chains";
import { createGuardedLifiWallet } from "../lib/security/lifi-wallet";
import { wallet, native, quote } from "./fixtures";
import { buildIntentSeed, withIntentExecution } from "../lib/intent/journal";
import { createClient } from "@lifi/sdk";
import { getEthereumExecutionStrategy } from "../node_modules/@lifi/sdk-provider-ethereum/dist/esm/core/tasks/helpers/getEthereumExecutionStrategy.js";

const target = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}`;
function fixture(token = native) {
  const rpc = vi.fn(async ({ method }: { method: string }) => {
    const values: Record<string, unknown> = { eth_accounts: [wallet], eth_chainId: "0x1", eth_getCode: "0x", eth_getTransactionCount: "0x11", eth_getBalance: "0xc350", eth_estimateGas: "0x5208", eth_gasPrice: "0x1", eth_call: `0x${"f".repeat(64)}`, wallet_getCapabilities: { "0x1": { atomic: { status: "supported" } } } };
    if (method === "eth_sendTransaction") return hash;
    if (method in values) return values[method];
    throw Error(method);
  });
  const original = createWalletClient({ account: wallet, chain: mainnet, transport: custom({ request: rpc }, { retryCount: 0 }) });
  const journal = { beforeAction: vi.fn(async () => "action"), sent: vi.fn(), rejected: vi.fn(), ambiguous: vi.fn(), notSent: vi.fn() };
  const security = { journal, account: wallet, chainId: 1, protocol: "bridge", fromTokenAddress: token, fromAmount: "100", quotedNativeGasReserve: "21000", check: vi.fn() };
  return { rpc, original, security, guard: createGuardedLifiWallet(original, security) };
}
describe("LI.FI wallet economic and capability regressions", () => {
  it("rejects the audited native value before any send", async () => {
    const f = fixture();
    await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x5f5e100" }] })).rejects.toThrow();
    expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it("does not advertise wallet batching to the SDK", async () => {
    const f = fixture();
    expect(await f.guard.request({ method: "wallet_getCapabilities", params: [wallet] } as never)).toEqual({});
    expect(f.rpc.mock.calls.filter(c => c[0].method === "wallet_getCapabilities")).toHaveLength(0);
  });
  it("pins the source nonce in the durable action and refuses a changed nonce before wallet request", async () => {
    const f = fixture(); let nonceReads = 0;
    const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(args => args.method === "eth_getTransactionCount" ? Promise.resolve(++nonceReads === 1 ? "0x11" : "0x12") : original(args));
    await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x64" }] })).rejects.toThrow();
    expect(f.security.journal.beforeAction).toHaveBeenCalledWith(expect.objectContaining({ nonce: 17 }));
    expect(f.security.journal.notSent).toHaveBeenCalledWith("action");
    expect(f.rpc.mock.calls.filter(call => call[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it("selects the real SDK standard strategy even for an atomic-capable upstream wallet", async () => {
    const f = fixture();
    const strategy = await getEthereumExecutionStrategy({ step: { tool: "bridge" }, checkClient: async () => f.guard,
      client: createClient({ integrator: "test", preloadChains: false }), fromChain: { id: 1 }, ethereumClient: f.guard } as never);
    expect(strategy).toBe("standard");
    expect(f.rpc.mock.calls.filter(c => c[0].method === "wallet_getCapabilities")).toHaveLength(0);
  });
  it("blocks smart accounts and EIP7702 delegated accounts before any send", async () => {
    for (const code of ["0xdeadbeef", `0xef0100${"ab".repeat(20)}`]) {
      const f = fixture(); const original = f.rpc.getMockImplementation()!;
      f.rpc.mockImplementation(args => args.method === "eth_getCode" ? Promise.resolve(code) : original(args));
      await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x64" }] })).rejects.toThrow();
      expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(0);
    }
  });
  it("blocks an unlimited approval while preserving finite provider spender choice", async () => {
    const f = fixture(target);
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [wallet, BigInt(`0x${"f".repeat(64)}`)] });
    await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data }] })).rejects.toThrow();
    expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it("blocks direct guarded emission without a durable journal", async () => {
    const f = fixture(); const { journal: _journal, ...security } = f.security;
    const guard = createGuardedLifiWallet(f.original, security);
    await expect(guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x64" }] })).rejects.toThrow();
    expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(0);
  });
  it("blocks modes quotes and incident at the actual wallet transport", async () => {
    const f = fixture(); vi.mocked(canExecuteNewSwap).mockReturnValueOnce(false);
    await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef" }] })).rejects.toThrow();
    expect(f.security.journal.beforeAction).not.toHaveBeenCalled();
  });
  it("requires storage before send and preserves explicit rejection versus ambiguous outcome", async () => {
    for (const outcome of ["storage", "reject", "ambiguous", "post_storage"] as const) {
      const f = fixture(); const original = f.rpc.getMockImplementation()!;
      if (outcome === "storage") f.security.journal.beforeAction.mockRejectedValue(Error("quota exceeded"));
      if (outcome === "post_storage") f.security.journal.sent.mockImplementation(() => { throw Error("quota exceeded after hash"); });
      f.rpc.mockImplementation(async args => {
        if (args.method === "eth_sendTransaction") {
          if (outcome === "reject") throw Object.assign(Error("user refused"), { code: 4001 });
          if (outcome === "ambiguous") throw Error("connection lost");
        }
        return original(args);
      });
      await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x64" }] })).rejects.toThrow();
      expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(outcome === "storage" ? 0 : 1);
      expect(f.security.journal.rejected).toHaveBeenCalledTimes(outcome === "reject" ? 1 : 0);
      expect(f.security.journal.ambiguous).toHaveBeenCalledTimes(outcome === "ambiguous" || outcome === "post_storage" ? 1 : 0);
    }
  });
  it("the durable journal blocks a new guarded client and restored execution after an ambiguous send", async () => {
    const f = fixture(); const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(args => args.method === "eth_sendTransaction" ? Promise.reject(Error("lost after possible broadcast")) : original(args));
    const selected = quote();
    selected.fromChainId = 1; selected.toChainId = 8453; selected.fromAmount = "100";
    selected.raw.fromToken = { ...selected.raw.fromToken, chainId: 1 };
    selected.raw.toToken = { ...selected.raw.toToken, chainId: 8453 };
    const seed = buildIntentSeed(selected, { fromChainId: 1, toChainId: 8453, fromTokenAddress: native, toTokenAddress: native, fromAmount: "100", fromAddress: wallet });
    const request = { method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x64" }] };
    await withIntentExecution(seed, async session => {
      const guardA = createGuardedLifiWallet(f.original, { ...f.security, journal: session });
      const guardB = createGuardedLifiWallet(f.original, { ...f.security, journal: session });
      await expect(guardA.request(request as never)).rejects.toThrow();
      await expect(guardB.request(request as never)).rejects.toThrow();
    });
    await expect(withIntentExecution(seed, async () => {})).rejects.toThrow("reconciliation_required");
    expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(1);
  });
  it("rechecks quote and native funds after asynchronous persistence, recording a controlled non-send", async () => {
    for (const change of ["quote", "balance", "mode"]) {
      const f = fixture(); const original = f.rpc.getMockImplementation()!;
      f.security.journal.beforeAction.mockImplementation(async () => {
        if (change === "quote") f.security.check.mockImplementation(() => { throw Error("quote expired after paid approval"); });
        if (change === "balance") f.rpc.mockImplementation(args => args.method === "eth_getBalance" ? Promise.resolve("0x1") : original(args));
        if (change === "mode") vi.mocked(canExecuteNewSwap).mockReturnValue(false);
        return "action";
      });
      await expect(f.guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: "0x64" }] })).rejects.toThrow();
      expect(f.security.journal.notSent).toHaveBeenCalledWith("action");
      expect(f.rpc.mock.calls.filter(c => c[0].method === "eth_sendTransaction")).toHaveLength(0);
      vi.mocked(canExecuteNewSwap).mockReturnValue(true);
    }
  });
  it("permits explicit native supplemental fees within budget for native and ERC20 sources", async () => {
    for (const token of [native, target]) {
      const f = fixture(token); const value = token === native ? "105" : "5";
      const guard = createGuardedLifiWallet(f.original, { ...f.security, maxNativeValue: value });
      await expect(guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: `0x${BigInt(value).toString(16)}` }] })).resolves.toBe(hash);
      await expect(guard.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: target, data: "0xdeadbeef", value: `0x${(BigInt(value) + BigInt(1)).toString(16)}` }] })).rejects.toThrow();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), switchChain: vi.fn() }));
vi.mock("../lib/aggregators/lifi/execute", () => ({ executeLifiRoute: vi.fn() }));
import { getAccount, getBalance, readContract, switchChain } from "wagmi/actions";
import { executeLifiRoute } from "../lib/aggregators/lifi/execute";
import { executeSwapQuote } from "../lib/routing/execute";
import { params, quote, wallet } from "./fixtures";
function account(address: string = wallet, chainId = 8453) { vi.mocked(getAccount).mockReturnValue({ isConnected: true, address, chainId } as ReturnType<typeof getAccount>); }
beforeEach(() => {
  vi.clearAllMocks(); account();
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt("1000000000000000000"), decimals: 18, symbol: "ETH", formatted: "1" });
  vi.mocked(readContract).mockResolvedValue(BigInt("1000000000000000000"));
  vi.mocked(executeLifiRoute).mockResolvedValue(quote().raw);
});
describe("execution preflight", () => {
  it("uses the validated quote and refuses automatic rate changes", async () => {
    const route = quote(); await executeSwapQuote(route, params, vi.fn());
    expect(executeLifiRoute).toHaveBeenCalledWith(route.raw, expect.objectContaining({ updateRouteHook: expect.any(Function) }));
    expect(await vi.mocked(executeLifiRoute).mock.calls[0][1]?.acceptExchangeRateUpdateHook?.({} as never)).toBe(false);
  });
  it("rejects an expired quote before interacting with the wallet", async () => {
    await expect(executeSwapQuote({ ...quote(), expiresAt: 0 }, params, vi.fn())).rejects.toThrow("quote_changed");
    expect(executeLifiRoute).not.toHaveBeenCalled(); expect(switchChain).not.toHaveBeenCalled();
  });
  it("rejects a wallet account change while switching networks", async () => {
    account(wallet, 1);
    vi.mocked(switchChain).mockImplementation(async () => { account("0x2222222222222222222222222222222222222222"); return { id: 8453 } as never; });
    await expect(executeSwapQuote(quote(), params, vi.fn())).rejects.toThrow("quote_changed");
    expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("reserves source gas for native swaps", async () => {
    vi.mocked(getBalance).mockResolvedValue({ value: BigInt(params.fromAmount), decimals: 18, symbol: "ETH", formatted: "0.001" });
    await expect(executeSwapQuote(quote(), params, vi.fn())).rejects.toThrow("insufficient_gas");
    expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("reads ERC-20 balances on the source network", async () => {
    const token = "0x2222222222222222222222222222222222222222";
    const input = { ...params, fromTokenAddress: token };
    const raw = quote().raw;
    await executeSwapQuote({ ...quote(), ...input, raw: { ...raw, fromToken: { ...raw.fromToken, address: token } } }, input, vi.fn());
    expect(readContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chainId: 8453, address: token }));
  });
});

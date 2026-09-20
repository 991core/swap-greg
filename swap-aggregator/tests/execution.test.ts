import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), switchChain: vi.fn() }));
vi.mock("../lib/aggregators/lifi/execute", () => ({ executeLifiRoute: vi.fn() }));
vi.mock("../lib/tokens/client", () => ({ getTokenDetails: vi.fn() }));
import { getAccount, getBalance, readContract, switchChain } from "wagmi/actions";
import { executeLifiRoute } from "../lib/aggregators/lifi/execute";
import { executeSwapQuote as execute } from "../lib/routing/execute";
import { getTokenDetails } from "../lib/tokens/client";
import { fromToken, params, quote, wallet } from "./fixtures";
import type { AppToken } from "../lib/tokens/types";
import { getCatalogToken } from "../lib/tokens/catalog";
const remoteAddress = "0x2222222222222222222222222222222222222222";
const remoteParams = { ...params, fromTokenAddress: remoteAddress, toTokenAddress: remoteAddress };
function remoteQuote() {
  const route = quote();
  return { ...route, ...remoteParams, raw: { ...route.raw,
    fromToken: { ...route.raw.fromToken, address: remoteAddress },
    toToken: { ...route.raw.toToken, address: remoteAddress },
  } };
}
function executeSwapQuote(route: ReturnType<typeof quote>, input: typeof params, hook: () => void, selection: { fromToken: AppToken; toToken: AppToken } = { fromToken: route.raw.fromToken, toToken: route.raw.toToken }) {
  return execute(route, input, hook, selection);
}
function account(address: string = wallet, chainId = 8453) { vi.mocked(getAccount).mockReturnValue({ isConnected: true, address, chainId } as ReturnType<typeof getAccount>); }
beforeEach(() => {
  vi.clearAllMocks(); account();
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt("1000000000000000000"), decimals: 18, symbol: "ETH", formatted: "1" });
  vi.mocked(readContract).mockResolvedValue(BigInt("1000000000000000000"));
  vi.mocked(executeLifiRoute).mockResolvedValue(quote().raw);
  vi.mocked(getTokenDetails).mockImplementation(async (chainId, address) => ({ ...fromToken, chainId, address }));
});
describe("execution preflight", () => {
  it("uses the validated quote and refuses automatic rate changes", async () => {
    const route = quote(); await executeSwapQuote(route, params, vi.fn());
    expect(executeLifiRoute).toHaveBeenCalledWith(route.raw, expect.objectContaining({ updateRouteHook: expect.any(Function) }));
    expect(await vi.mocked(executeLifiRoute).mock.calls[0][1]?.acceptExchangeRateUpdateHook?.({} as never)).toBe(false);
    expect(getTokenDetails).not.toHaveBeenCalled();
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
  it.each(["fromToken", "toToken"] as const)("blocks a newly flagged %s before touching the wallet", async (side) => {
    const route = remoteQuote();
    vi.mocked(getTokenDetails).mockImplementation(async (chainId, address) => ({ ...fromToken, chainId, address, verificationStatus: chainId === route.raw[side].chainId ? "flagged" : "verified" }));
    await expect(executeSwapQuote(route, remoteParams, vi.fn())).rejects.toThrow("token_blocked");
    expect(executeLifiRoute).not.toHaveBeenCalled(); expect(switchChain).not.toHaveBeenCalled(); expect(getBalance).not.toHaveBeenCalled();
  });
  it("rejects metadata changes between search and quote", async () => {
    const route = quote();
    await expect(executeSwapQuote(route, params, vi.fn(), { fromToken: { ...route.raw.fromToken, decimals: 6 }, toToken: route.raw.toToken })).rejects.toThrow("token_metadata_changed");
    expect(getTokenDetails).not.toHaveBeenCalled(); expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("rejects metadata changes since the quote", async () => {
    vi.mocked(getTokenDetails).mockResolvedValue({ ...fromToken, address: remoteAddress, decimals: 6 });
    await expect(executeSwapQuote(remoteQuote(), remoteParams, vi.fn())).rejects.toThrow("token_metadata_changed");
    expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("blocks execution when live token validation is unavailable", async () => {
    vi.mocked(getTokenDetails).mockRejectedValue(new Error("offline"));
    await expect(executeSwapQuote(remoteQuote(), remoteParams, vi.fn())).rejects.toThrow("tokens_unavailable");
    expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("requires consent for an unverified ERC-20 and still rechecks it after consent", async () => {
    const token: AppToken = { ...fromToken, address: "0x2222222222222222222222222222222222222222", verificationStatus: "unverified" };
    const input = { ...params, fromTokenAddress: token.address };
    const route = { ...quote(), ...input, raw: { ...quote().raw, fromToken: token } };
    await expect(executeSwapQuote(route, input, vi.fn())).rejects.toThrow("token_confirmation_required");
    expect(getTokenDetails).not.toHaveBeenCalled();
    vi.mocked(getTokenDetails).mockImplementation(async (chainId) => chainId === token.chainId ? token : route.raw.toToken);
    await executeSwapQuote(route, input, vi.fn(), { fromToken: { ...token, riskAcknowledged: true }, toToken: route.raw.toToken });
    expect(executeLifiRoute).toHaveBeenCalledOnce();
  });
  it("requires renewed selection when a previously verified ERC-20 loses verification", async () => {
    const token = { ...fromToken, address: "0x2222222222222222222222222222222222222222" };
    const input = { ...params, fromTokenAddress: token.address };
    const route = { ...quote(), ...input, raw: { ...quote().raw, fromToken: token } };
    vi.mocked(getTokenDetails).mockImplementation(async (chainId) => chainId === token.chainId ? { ...token, verificationStatus: "unverified" } : route.raw.toToken);
    await expect(executeSwapQuote(route, input, vi.fn())).rejects.toThrow("token_confirmation_required");
    expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("rejects an account change during live token validation", async () => {
    vi.mocked(getTokenDetails).mockImplementation(async (chainId, address) => { account("0x2222222222222222222222222222222222222222"); return { ...fromToken, chainId, address }; });
    await expect(executeSwapQuote(remoteQuote(), remoteParams, vi.fn())).rejects.toThrow("quote_changed");
    expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("uses pinned USDC metadata without an authenticity request even if that API is offline", async () => {
    const token = getCatalogToken(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")!;
    const input = { ...params, fromTokenAddress: token.address };
    const route = { ...quote(), ...input, raw: { ...quote().raw, fromToken: token } };
    vi.mocked(getTokenDetails).mockRejectedValue(new Error("offline"));
    await executeSwapQuote(route, input, vi.fn());
    expect(getTokenDetails).not.toHaveBeenCalled(); expect(executeLifiRoute).toHaveBeenCalledOnce();
    expect(readContract).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ address: token.address, chainId: 8453 }));
  });
  it("still blocks a catalog token when its quote contains a flagged verdict", async () => {
    const route = quote(); route.raw = { ...route.raw, toToken: { ...route.raw.toToken, verificationStatus: "flagged" } };
    await expect(executeSwapQuote(route, params, vi.fn())).rejects.toThrow("token_blocked");
    expect(getTokenDetails).not.toHaveBeenCalled(); expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("rejects altered catalog decimals even when selection and quote agree", async () => {
    const token = { ...getCatalogToken(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")!, decimals: 18 };
    const input = { ...params, fromTokenAddress: token.address };
    const route = { ...quote(), ...input, raw: { ...quote().raw, fromToken: token } };
    await expect(executeSwapQuote(route, input, vi.fn())).rejects.toThrow("token_metadata_changed");
    expect(getTokenDetails).not.toHaveBeenCalled(); expect(executeLifiRoute).not.toHaveBeenCalled();
  });
  it("fetches both non-catalog tokens fresh before executing", async () => {
    await executeSwapQuote(remoteQuote(), remoteParams, vi.fn());
    expect(getTokenDetails).toHaveBeenCalledWith(8453, remoteAddress, { fresh: true });
    expect(getTokenDetails).toHaveBeenCalledWith(1, remoteAddress, { fresh: true });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/aggregators/lifi/routes", () => ({ fetchRoutes: vi.fn() }));
vi.mock("../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));
import { fetchRoutes } from "../lib/aggregators/lifi/routes";
import { rangoRequest } from "../lib/aggregators/rango/client";
import { normalizeRangoQuote } from "../lib/aggregators/rango/routes";
import { rangoAsset, rangoToken, isUint } from "../lib/aggregators/rango/validation";
import { getRoutesForSelection } from "../lib/routing/orchestrator";
import { canExecuteQuote, sourceGasAmount } from "../lib/routing/quote";
import { rangoQuote, normalizedRango } from "./rango-fixtures";
import { native, params, rawRoute } from "./fixtures";

beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchRoutes).mockResolvedValue([rawRoute()]); vi.mocked(rangoRequest).mockResolvedValue(rangoQuote()); });
describe("Rango assets and quotes", () => {
  it.each([[1,"ETH.ETH"],[8453,"BASE.ETH"],[42161,"ARBITRUM.ETH"],[10,"OPTIMISM.ETH"],[137,"POLYGON.POL"],[56,"BSC.BNB"],[43114,"AVAX_CCHAIN.AVAX"],[100,"GNOSIS.XDAI"],[1088,"METIS--0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000"]])("maps native chain %s", (chain, expected) => expect(rangoAsset(chain as number, native)).toBe(expected));
  it("identifies arbitrary ERC-20s by address, not symbol", () => expect(rangoAsset(8453, "0x2222222222222222222222222222222222222222")).toBe("BASE--0x2222222222222222222222222222222222222222"));
  it("normalizes the Metis native alias only on Metis", () => {
    expect(rangoToken({ ...rangoQuote().route.from, blockchain: "METIS", chainId: "1088", address: "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000", symbol: "METIS" }).address).toBe(native);
  });
  it("keeps the real minimum and native gas separate from deducted fees", () => {
    const route = normalizedRango();
    expect(route.toAmountMin).toBe("940000000000000"); expect(sourceGasAmount(route)).toBe(BigInt(300000));
    expect(canExecuteQuote(route, params)).toBe(true);
    expect(canExecuteQuote(route, { ...params, fromAmount: "2" })).toBe(false);
    expect(canExecuteQuote({ ...route, expiresAt: Date.now() }, params)).toBe(false);
    expect(canExecuteQuote({ ...route, toAmountMin: "1" }, params)).toBe(false);
    expect(canExecuteQuote({ ...route, raw: { ...route.raw, params: { ...params, fromAddress: native } } }, params)).toBe(false);
  });
  it.each(["HIGH_IMPACT","HIGH_IMPACT_FOR_CREATE_TX","INPUT_LIMIT_ISSUE","NO_ROUTE"])("rejects non executable %s", resultType => expect(() => normalizeRangoQuote({ ...rangoQuote(), resultType }, params)).toThrow());
  it.each(["-1","1e3","0","100000000000000000000000000000000000000000000000000000000000000000000000000000000"])("rejects invalid minimum %s", minimum => {
    const data = rangoQuote(); data.route.outputAmountMin = minimum;
    expect(() => normalizeRangoQuote(data, params)).toThrow();
  });
  it("rejects another destination and unsupported fee spending", () => {
    const data = rangoQuote(); data.route.to.chainId = "10";
    expect(() => normalizeRangoQuote(data, params)).toThrow();
    const fees = rangoQuote(); fees.route.fee[0].expenseType = "FROM_DESTINATION_WALLET";
    expect(() => normalizeRangoQuote(fees, params)).toThrow();
  });
  it("rejects unsafe amounts but preserves large integers", () => { expect(isUint((BigInt(2) ** BigInt(256)).toString())).toBe(false); expect(isUint("9007199254740993000001")).toBe(true); });
});
describe("provider isolation", () => {
  it("publishes the first provider before the slower one finishes, then sorts both", async () => {
    let finish!: (value: ReturnType<typeof rangoQuote>) => void;
    vi.mocked(rangoRequest).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const progress = vi.fn();
    const result = getRoutesForSelection(params, undefined, undefined, progress);
    await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(1));
    expect(progress.mock.calls[0][0].map((route: { provider: string }) => route.provider)).toEqual(["lifi"]);
    finish(rangoQuote());
    expect((await result).map(route => route.provider)).toEqual(["rango", "lifi"]);
    expect(progress).toHaveBeenCalledTimes(2);
  });
  it("queries both providers and sorts by exact output", async () => {
    const result = await getRoutesForSelection(params);
    expect(result.map(r => r.provider)).toEqual(["rango", "lifi"]);
  });
  it("keeps LI.FI when Rango fails and reports the partial failure", async () => {
    vi.mocked(rangoRequest).mockRejectedValue(new Error("429")); const warn = vi.fn();
    expect((await getRoutesForSelection(params, undefined, warn)).map(r=>r.provider)).toEqual(["lifi"]);
    expect(warn).toHaveBeenCalledWith({ provider: "rango", message: "unavailable" });
  });
  it("keeps Rango when LI.FI fails", async () => { vi.mocked(fetchRoutes).mockRejectedValue(new Error("offline")); expect((await getRoutesForSelection(params)).map(r=>r.provider)).toEqual(["rango"]); });
  it("does not query providers that the user has disabled", async () => {
    await getRoutesForSelection({ ...params, providers: { lifi: true, rango: false, socket: false } }); expect(rangoRequest).not.toHaveBeenCalled();
    expect(fetchRoutes).toHaveBeenCalledWith(params, undefined);
    vi.clearAllMocks(); expect(await getRoutesForSelection({ ...params, providers: { lifi: false, rango: false, socket: false } })).toEqual([]); expect(fetchRoutes).not.toHaveBeenCalled();
  });
  it("returns no Rango route for NO_ROUTE and fails if all enabled providers fail", async () => {
    vi.mocked(rangoRequest).mockResolvedValue({ resultType: "NO_ROUTE", error: null });
    expect(await getRoutesForSelection({ ...params, providers: { lifi: false, rango: true, socket: false } })).toEqual([]);
    vi.mocked(rangoRequest).mockRejectedValue(new Error("offline")); vi.mocked(fetchRoutes).mockRejectedValue(new Error("offline"));
    await expect(getRoutesForSelection(params)).rejects.toThrow("No selected provider");
  });
  it("discards all results and progress after cancellation", async () => {
    const controller = new AbortController(); const progress = vi.fn(); controller.abort();
    await expect(getRoutesForSelection(params, controller.signal, undefined, progress)).rejects.toThrow("Aborted");
    expect(progress).not.toHaveBeenCalled();
  });
});

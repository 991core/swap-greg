import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwapParams } from "../lib/aggregators/lifi/routes";
import type { NormalizedRoute } from "../lib/types/normalized-route";
vi.mock("../lib/routing/orchestrator", () => ({ getRoutesForSelection: vi.fn() }));
import { getRoutesForSelection } from "../lib/routing/orchestrator";
import { useSwapQuotes } from "../lib/routing/useSwapQuotes";
import { canExecuteQuote } from "../lib/routing/quote";
import { normalizeLifiRoute } from "../lib/routing/normalize";
import { params, quote, rawRoute } from "./fixtures";
const fetchQuotes = vi.mocked(getRoutesForSelection);
beforeEach(() => { vi.useFakeTimers(); fetchQuotes.mockReset(); });
describe("quote lifetime", () => {
  it("ignores a late response after the amount has been cleared", async () => {
    let resolve!: (routes: NormalizedRoute[]) => void;
    fetchQuotes.mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = renderHook(({ input }: { input: SwapParams | null }) => useSwapQuotes(input), { initialProps: { input: params as SwapParams | null } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    const signal = fetchQuotes.mock.calls[0][1];
    hook.rerender({ input: null });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve([quote()]));
    expect(hook.result.current.routes).toEqual([]);
    expect(hook.result.current.loading).toBe(false);
  });
  it.each(["fromAmount", "fromAddress", "toChainId", "toTokenAddress"] as const)("hides the previous quote immediately when %s changes", async (field) => {
    fetchQuotes.mockResolvedValue([quote()]);
    const hook = renderHook(({ input }) => useSwapQuotes(input), { initialProps: { input: params } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(hook.result.current.routes).toHaveLength(1);
    const values = { fromAmount: "2000000000000000", fromAddress: "0x2222222222222222222222222222222222222222", toChainId: 10, toTokenAddress: "0x2222222222222222222222222222222222222222" };
    hook.rerender({ input: { ...params, [field]: values[field] } });
    expect(hook.result.current.routes).toEqual([]);
  });
  it("expires a quote and requires a new one", async () => {
    const route = quote(); fetchQuotes.mockResolvedValue([route]);
    const hook = renderHook(() => useSwapQuotes(params));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(canExecuteQuote(route, params)).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(hook.result.current.expired).toBe(true);
    expect(canExecuteQuote(route, params)).toBe(false);
    act(() => hook.result.current.refresh());
    expect(hook.result.current.routes).toEqual([]);
  });
  it("updates the executed route without overwriting the first route", async () => {
    fetchQuotes.mockResolvedValue([quote(), quote("lifi:quote-b")]);
    const hook = renderHook(() => useSwapQuotes(params));
    await act(() => vi.advanceTimersByTimeAsync(500));
    act(() => hook.result.current.updateRoute({ ...quote("lifi:quote-b"), toAmount: "800000000000000" }));
    expect(hook.result.current.routes.map((r) => r.toAmount)).toEqual(["900000000000000", "800000000000000"]);
  });
  it("rejects a quote for another recipient", () => expect(() => normalizeLifiRoute({ ...rawRoute(), toAddress: "0x2222222222222222222222222222222222222222" }, params)).toThrow("does not match"));
  it("preserves minimum received and gas estimates", () => expect(normalizeLifiRoute(rawRoute(), params)).toMatchObject({ toAmountMin: "895500000000000", gasCostUSD: "0.02" }));
});

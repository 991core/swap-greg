import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn() }));
import { searchTokens } from "../lib/tokens/client";
import { APP_CHAIN_IDS } from "../lib/chains";
import { popularTokensSnapshot, preloadPopularTokens } from "../lib/tokens/popular";
import { TokenSearchError, type TokenSearchResult } from "../lib/tokens/types";

function result(chainId: number): TokenSearchResult {
  return { chainId, query: "", tokens: [], limit: 100, checkedAt: Date.now(), truncated: false, hasMore: false };
}
beforeEach(() => { vi.mocked(searchTokens).mockReset(); vi.mocked(searchTokens).mockImplementation(async chainId => result(chainId)); });

it("preloads 100 popular tokens on every Hermes chain without a wallet or per-chain exceptions", async () => {
  await preloadPopularTokens(APP_CHAIN_IDS);
  expect(vi.mocked(searchTokens).mock.calls.map(call => call[0]).sort()).toEqual([...APP_CHAIN_IDS].sort());
  for (const chainId of APP_CHAIN_IDS) {
    expect(searchTokens).toHaveBeenCalledWith(chainId, "", expect.objectContaining({ limit: 100 }));
    expect(popularTokensSnapshot()[chainId].status).toBe("ready");
  }
});
it("coalesces shared discovery and bounds parallel requests to two", async () => {
  let active = 0;
  let maximum = 0;
  const finishers: Array<() => void> = [];
  vi.mocked(searchTokens).mockImplementation(chainId => {
    active += 1; maximum = Math.max(maximum, active);
    return new Promise(resolve => finishers.push(() => { active -= 1; resolve(result(chainId)); }));
  });
  const first = preloadPopularTokens(APP_CHAIN_IDS);
  const second = preloadPopularTokens(APP_CHAIN_IDS);
  expect(searchTokens).toHaveBeenCalledTimes(2);
  while (finishers.length) {
    finishers.splice(0).forEach(finish => finish());
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await Promise.all([first, second]);
  expect(maximum).toBe(2); expect(searchTokens).toHaveBeenCalledTimes(APP_CHAIN_IDS.length);
});
it("isolates a failed chain and keeps the others available", async () => {
  vi.mocked(searchTokens).mockImplementation(async chainId => {
    if (chainId === 1088) throw new TokenSearchError("rate_limited", 429);
    return result(chainId);
  });
  await preloadPopularTokens(APP_CHAIN_IDS);
  expect(popularTokensSnapshot()[1088]).toEqual({ status: "error", result: undefined, error: "rate_limited" });
  APP_CHAIN_IDS.filter(id => id !== 1088).forEach(id => expect(popularTokensSnapshot()[id].status).toBe("ready"));
});
it("uses fresh cached lists and only refreshes expired ones", async () => {
  let now = 1_000_000; vi.spyOn(Date, "now").mockImplementation(() => now);
  await preloadPopularTokens(APP_CHAIN_IDS); await preloadPopularTokens(APP_CHAIN_IDS);
  expect(searchTokens).toHaveBeenCalledTimes(APP_CHAIN_IDS.length);
  now += 60_001; await preloadPopularTokens(APP_CHAIN_IDS);
  expect(searchTokens).toHaveBeenCalledTimes(APP_CHAIN_IDS.length * 2);
});
it("stops queuing after its caller leaves and ignores unsupported or repeated chains", async () => {
  const controller = new AbortController();
  vi.mocked(searchTokens).mockImplementation(async chainId => { controller.abort(); return result(chainId); });
  await preloadPopularTokens([8453, 8453, 999999, 1, 1088], controller.signal);
  expect(searchTokens).toHaveBeenCalledTimes(1);
  expect(popularTokensSnapshot()[8453].status).toBe("ready");
  expect(popularTokensSnapshot()[999999]).toBeUndefined();
});

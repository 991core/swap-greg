// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("../lib/security/providers/coingecko.server", () => ({
  getCoinGeckoTopAssets: async () => [{ provider: "coingecko", providerAssetId: "rare", symbol: "R", name: "Rare", marketCap: 10, marketCapRank: 1 }],
  getCoinGeckoPlatformList: async () => new Map([["rare", { 1: "0x1111111111111111111111111111111111111111" }]]),
  getCoinGeckoMetadata: vi.fn(), normalizeCoinGeckoAsset: vi.fn(),
}));
vi.mock("../lib/security/providers/lifi.server", () => ({
  getLiFiDiscovery: async () => ({ tokens: Object.fromEntries([1, 10, 56, 137, 100, 8453, 42161, 43114, 1088].map(id => [id, []])) }),
  getLiFiTokenByAddress: calls.metadata,
}));
beforeEach(async () => {
  vi.resetModules(); calls.metadata.mockReset(); vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  const { SecurityProviderError } = await import("../lib/security/providers/types");
  calls.metadata.mockRejectedValue(new SecurityProviderError("lifi", "rate_limited", 429));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("stops quota enrichment after bounded read-only attempts and releases the cached enrichment state", async () => {
  const { getMarketUniverse } = await import("../lib/security/universe.server");
  const result = await getMarketUniverse(); expect(result.enriching).toBe(true);
  await vi.advanceTimersByTimeAsync(180_001);
  expect(result.enriching).toBe(false); expect(calls.metadata).toHaveBeenCalledTimes(3);
  const next = await getMarketUniverse(); expect(next).not.toBe(result); expect(next.source).toBe("coingecko");
});

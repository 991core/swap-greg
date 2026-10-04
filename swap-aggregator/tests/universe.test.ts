// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const chains = [8453, 1, 42161, 10, 137, 56, 43114, 100, 1088];
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const fetchMock = vi.fn();
const tok = (address = A) => ({ chainId: 1, address, decimals: 6, symbol: "SAME", name: "Asset", priceUSD: "1", marketCapUSD: 999999, verificationStatus: "unverified" });
const display = (rows: any[]) => rows.find(row => row.address.toLowerCase() === A)!;
const market = [{ id: "asset-a", name: "Asset A", symbol: "SAME", market_cap: 200, market_cap_rank: 1 }];
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("TOP_ASSET_PRIMARY_PROVIDER", "coingecko"); vi.stubEnv("TOP_ASSET_FETCH_LIMIT", "120"); vi.stubEnv("TARGET_UNIVERSE_SIZE", "100"); vi.stubEnv("CMC_API_KEY", ""); vi.stubEnv("CG_API_KEY", ""); fetchMock.mockReset();
  fetchMock.mockImplementation(async (raw: string) => {
    const url = new URL(raw);
    if (url.pathname.endsWith("/coins/markets")) return Response.json(market);
    if (url.pathname.endsWith("/coins/list")) return Response.json([{ id: "asset-a", platforms: { ethereum: A } }]);
    if (url.pathname.endsWith("/coins/asset-a")) return Response.json({ id: "asset-a", symbol: "same", asset_platform_id: "ethereum", platforms: { ethereum: A }, detail_platforms: { ethereum: { contract_address: A, decimal_place: 6 } } });
    if (url.pathname === "/v1/tokens") return Response.json({ tokens: Object.fromEntries(chains.map(id => [id, id === 1 ? [tok()] : []])) });
    if (url.pathname === "/v1/token") return Response.json(tok(url.searchParams.get("token") ?? A));
    throw new Error("unexpected_provider_request");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("market universe service", () => {
  it("returns native and catalog market ranking on the bulk path without waiting for cold metadata or missing-token lookups", async () => {
    const baseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    fetchMock.mockImplementation(async raw => {
      const url = new URL(raw);
      if (url.pathname.endsWith("/coins/markets")) return Response.json([{ id: "ethereum", symbol: "eth", name: "Ethereum", market_cap: 5000, market_cap_rank: 2 }, { id: "usd-coin", symbol: "usdc", name: "USDC", market_cap: 3000, market_cap_rank: 5 }, { id: "new-asset", symbol: "eth", name: "Impostor", market_cap: 1, market_cap_rank: 100 }]);
      if (url.pathname.endsWith("/coins/list")) return Response.json([{ id: "ethereum", platforms: {} }, { id: "usd-coin", platforms: { base: baseUsdc } }, { id: "new-asset", platforms: { ethereum: B } }]);
      if (url.pathname === "/v1/tokens") return Response.json({ tokens: Object.fromEntries(chains.map(id => [id, []])) });
      return new Promise(() => {});
    });
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse();
    for (const chainId of [1, 10, 8453, 42161]) expect(result.tokens[chainId].find(row => /^0x0{40}$/.test(row.address))?.marketCapUSD).toBe(5000);
    expect(result.tokens[8453].find(row => row.address.toLowerCase() === baseUsdc)?.marketCapUSD).toBe(3000);
    expect(result.tokens[1].find(row => row.symbol === "WETH")).not.toHaveProperty("marketCapUSD");
    expect(fetchMock.mock.calls.some(call => /\/coins\/(ethereum|usd-coin|new-asset)$/.test(new URL(call[0]).pathname))).toBe(false);
    expect(result.resolutions.every(row => row.status === "manual_review")).toBe(true);
  });
  it("uses one provider ranking and explicitly namespaces unbound assets without granting trust", async () => {
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); expect(result.source).toBe("coingecko"); expect(result.fetchLimit).toBe(120); expect(result.targetSize).toBe(100); expect(display(result.tokens[1]).marketCapUSD).toBe(200); expect(display(result.tokens[1]).marketSource).toBe("coingecko"); expect(result.resolutions).toHaveLength(9); expect(result.resolutions.every(row => row.status === "manual_review" && row.assetId === "coingecko:asset-a")).toBe(true); expect(result.resolutions.find(row => row.chainId === 1)?.sources.find(row => row.provider === "lifi")?.lookupMode).toBe("candidate-bound");
  });
  it("coalesces complete universe requests", async () => {
    const { getMarketUniverse } = await import("../lib/security/universe.server"); expect(display((await Promise.all([getMarketUniverse(), getMarketUniverse()]))[0].tokens[1])).toBeDefined(); expect(fetchMock.mock.calls.filter(call => new URL(call[0]).pathname.endsWith("/coins/markets"))).toHaveLength(1);
  });
  it("resolves primary stable IDs individually when full CG platforms exceed the limit", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation(async raw => new URL(raw).pathname.endsWith("/coins/list") ? new Response("too large", { headers: { "content-length": "9000000" } }) : original(raw));
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); expect(display(result.tokens[1]).marketSource).toBe("coingecko"); expect(result.failures).toContainEqual({ provider: "coingecko", chainId: 0, reason: "response_too_large" });
  });
  it("includes a top-market contract omitted from LI.FI's initial 100", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation(async raw => new URL(raw).pathname === "/v1/tokens" ? Response.json({ tokens: Object.fromEntries(chains.map(id => [id, []])) }) : original(raw));
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); await vi.waitFor(() => expect(display(result.tokens[1])).toBeDefined()); expect(display(result.tokens[1])).toMatchObject({ address: A, marketCapUSD: 200, marketSource: "coingecko" }); expect(fetchMock.mock.calls.some(call => new URL(call[0]).pathname === "/v1/token")).toBe(true);
  });
  it("uses CMC fallback with exact platform-ID metadata, not same-symbol joins", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation(async raw => {
      const url = new URL(raw); if (url.host.includes("coingecko")) return new Response("private-key-in-body", { status: 503 });
      if (url.pathname.endsWith("/listings/latest")) return Response.json({ status: { error_code: 0 }, data: [{ id: 3408, name: "Asset", symbol: "SAME", cmc_rank: 1, quote: [{ id: 2781, market_cap: 300 }] }] });
      if (url.pathname.endsWith("/info")) return Response.json({ status: { error_code: 0 }, data: { "3408": { id: 3408, symbol: "SAME", platform: { slug: "ethereum", token_address: A } } } }); return original(raw);
    }); const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); expect(result.source).toBe("coinmarketcap"); expect(display(result.tokens[1]).marketCapUSD).toBe(300); expect(display(result.tokens[1]).marketSource).toBe("coinmarketcap"); expect(result.failures[0]).toMatchObject({ provider: "coingecko", reason: "upstream_unavailable" }); expect(JSON.stringify(result)).not.toContain("private-key-in-body");
  });
  it("does not rank a same-symbol contract with another address", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation(async raw => new URL(raw).pathname === "/v1/tokens" ? Response.json({ tokens: Object.fromEntries(chains.map(id => [id, id === 1 ? [tok(B)] : []])) }) : original(raw));
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); const other = result.tokens[1].find(row => row.address.toLowerCase() === B)!; expect(other).not.toHaveProperty("marketCapUSD"); expect(other).not.toHaveProperty("marketSource");
  });
  it("keeps provider failures visible while discovery remains separate", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation(async raw => (new URL(raw).pathname.endsWith("/coins/asset-a") || new URL(raw).pathname.endsWith("/coins/list")) ? new Response("bad", { status: 503 }) : original(raw)); const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); expect(display(result.tokens[1])).toBeDefined(); expect(display(result.tokens[1])).not.toHaveProperty("marketSource"); expect(result.resolutions[0].unavailable.some(row => row.provider === "coingecko" && row.reason === "metadata_unavailable")).toBe(true);
  });
  it.each([{ TOP_ASSET_PRIMARY_PROVIDER: "lifi" }, { TOP_ASSET_FETCH_LIMIT: "251" }, { TARGET_UNIVERSE_SIZE: "121" }, { TARGET_UNIVERSE_SIZE: "1e2" }])("fails invalid universe config before provider requests", async config => {
    Object.entries(config).forEach(([key, value]) => vi.stubEnv(key, value)); const { getTopAssets } = await import("../lib/security/universe.server"); await expect(getTopAssets()).rejects.toThrow("invalid_configuration"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps LI.FI discovery visible if both market sources are unavailable without inventing ranking", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async raw => new URL(raw).hostname !== "li.quest" ? new Response("unavailable", { status: 503 }) : original(raw));
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse();
    expect(result.source).toBeNull(); expect(result.assets).toEqual([]); expect(display(result.tokens[1])).toBeDefined(); expect(display(result.tokens[1])).not.toHaveProperty("marketCapUSD"); expect(display(result.tokens[1])).not.toHaveProperty("marketSource"); expect(result.failures.map(row => row.provider)).toEqual(["coingecko", "coinmarketcap"]);
    const { validateMarketUniverse } = await import("../lib/tokens/market-universe"); expect(validateMarketUniverse(result).source).toBeNull();
  });
  it("fails closed when both market sources fail; LI.FI does not become a ranking fallback", async () => {
    fetchMock.mockRejectedValue(new Error("secret-api-key")); const { getTopAssets } = await import("../lib/security/universe.server"); await expect(getTopAssets()).rejects.toThrow("market_universe_unavailable"); expect(fetchMock.mock.calls.every(call => !new URL(call[0]).hostname.includes("li.quest"))).toBe(true);
  });
});
describe("universe ingress and browser metadata", () => {
  it("provides no-store for success and rejects origin/parameters before upstream", async () => {
    const { GET } = await import("../app/api/tokens/universe/route"); const bad = await GET(new Request("http://localhost/api/tokens/universe", { headers: { origin: "https://evil.example" } })); expect(bad.status).toBe(403); expect(bad.headers.get("Cache-Control")).toBe("no-store"); expect((await GET(new Request("http://localhost/api/tokens/universe?url=evil"))).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled(); const okay = await GET(new Request("http://localhost/api/tokens/universe")); expect(okay.status).toBe(200); expect(okay.headers.get("Cache-Control")).toBe("no-store");
  });
  it("browser copies only actual selected market provenance and never provider consent", async () => {
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); const { validateMarketUniverse } = await import("../lib/tokens/market-universe"); const raw = { ...result, tokens: { ...result.tokens, 1: [{ ...display(result.tokens[1]), riskAcknowledged: true, marketSource: "lifi", marketCapUSD: 999999 }] } }; const parsed = validateMarketUniverse(raw); expect(parsed.tokens[1][0]).not.toHaveProperty("riskAcknowledged"); expect(parsed.tokens[1][0]).not.toHaveProperty("marketCapUSD"); expect(parsed.tokens[1][0]).not.toHaveProperty("marketSource");
  });
  it("browser preserves flags and rejects malformed metrics/IDs", async () => {
    const { getMarketUniverse } = await import("../lib/security/universe.server"); const result = await getMarketUniverse(); const { validateMarketUniverse } = await import("../lib/tokens/market-universe"); const parsed = validateMarketUniverse({ ...result, tokens: { ...result.tokens, 1: [{ ...display(result.tokens[1]), verificationStatus: "flagged" }] } }); expect(parsed.tokens[1][0].verificationStatus).toBe("flagged"); expect(() => validateMarketUniverse({ ...result, assets: [{ ...result.assets[0], marketCap: -1 }] })).toThrow("invalid_market_universe");
  });
});

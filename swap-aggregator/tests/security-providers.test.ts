// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const fetchMock = vi.fn();
const token = (address = A, extras = {}) => ({ chainId: 1, address, decimals: 6, symbol: "SAME", name: "Asset", priceUSD: "1", ...extras });
const cg = (id = "asset-a", address = A) => ({ id, symbol: "same", asset_platform_id: "ethereum", platforms: { ethereum: address }, detail_platforms: { ethereum: { contract_address: address, decimal_place: 6 } } });
const cmc = (id = 3408, address = A) => ({ status: { error_code: 0 }, data: { [id]: { id, symbol: "SAME", platform: { slug: "ethereum", token_address: address } } } });
beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.stubEnv("CG_API_KEY", ""); vi.stubEnv("CG_API_TIER", "demo"); vi.stubEnv("CMC_API_KEY", ""); vi.stubEnv("LIFI_API_KEY", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("market source adapters", () => {
  it("uses CoinGecko market cap rank and stable IDs, keeping same-symbol assets separate", async () => {
    fetchMock.mockResolvedValue(Response.json([{ id: "asset-a", name: "Asset A", symbol: "SAME", market_cap: 20, market_cap_rank: 2 }, { id: "asset-b", name: "Asset B", symbol: "SAME", market_cap: 30, market_cap_rank: 1 }]));
    const { getCoinGeckoTopAssets } = await import("../lib/security/providers/coingecko.server"); const result = await getCoinGeckoTopAssets(120);
    expect(result.map(row => row.providerAssetId)).toEqual(["asset-b", "asset-a"]); const url = new URL(fetchMock.mock.calls[0][0]); expect(url.searchParams.get("per_page")).toBe("120"); expect(url.searchParams.get("order")).toBe("market_cap_desc"); expect(url.searchParams.has("symbols")).toBe(false);
  });
  it.each([{ market_cap: -1 }, { market_cap_rank: null }, { id: "../bad" }, { symbol: "\u202eBAD" }])("rejects invalid ranked market metadata %j", async change => {
    fetchMock.mockResolvedValue(Response.json([{ id: "asset-a", name: "Asset", symbol: "SAME", market_cap: 20, market_cap_rank: 1, ...change }])); const { getCoinGeckoTopAssets } = await import("../lib/security/providers/coingecko.server"); await expect(getCoinGeckoTopAssets(120)).rejects.toThrow("invalid_response");
  });
  it("requires exact CoinGecko ID/platform binding and normalizes case", async () => {
    fetchMock.mockResolvedValue(Response.json(cg())); const { resolveCoinGeckoAsset } = await import("../lib/security/providers/coingecko.server");
    expect(await resolveCoinGeckoAsset("asset-a", 1)).toMatchObject({ providerAssetId: "asset-a", chainId: 1, address: A, decimals: 6, lookupMode: "asset-id" }); await expect(resolveCoinGeckoAsset("asset-a", 8453)).rejects.toThrow("chain_deployment_unavailable");
  });
  it("never treats ETH metadata as WETH or infers native deployment on arbitrary chains", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "ethereum", symbol: "eth", asset_platform_id: null, platforms: { "": "" }, detail_platforms: {} })); const { resolveCoinGeckoAsset } = await import("../lib/security/providers/coingecko.server");
    await expect(resolveCoinGeckoAsset("ethereum", 1)).rejects.toThrow("chain_deployment_unavailable"); expect(await resolveCoinGeckoAsset("ethereum", 1, { nativeBinding: true })).toMatchObject({ tokenType: "native", address: null });
  });
  it("normalizes a native sentinel instead of treating it as a contract", async () => {
    fetchMock.mockResolvedValue(Response.json(cg("asset-a", `0x${"0".repeat(40)}`))); const { resolveCoinGeckoAsset } = await import("../lib/security/providers/coingecko.server"); expect(await resolveCoinGeckoAsset("asset-a", 1)).toMatchObject({ address: null, tokenType: "native" });
  });
  it("rejects contradictory CoinGecko platform addresses", async () => {
    const data = cg(); data.platforms.ethereum = B; fetchMock.mockResolvedValue(Response.json(data)); const { resolveCoinGeckoAsset } = await import("../lib/security/providers/coingecko.server"); await expect(resolveCoinGeckoAsset("asset-a", 1)).rejects.toThrow("ambiguous_deployment");
  });
  it("requests include_platform and rejects duplicate asset IDs in the map", async () => {
    fetchMock.mockResolvedValue(Response.json([{ id: "asset-a", platforms: { ethereum: A } }, { id: "asset-a", platforms: { ethereum: B } }])); const { getCoinGeckoPlatformList } = await import("../lib/security/providers/coingecko.server"); await expect(getCoinGeckoPlatformList()).rejects.toThrow("ambiguous_asset"); expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("include_platform")).toBe("true");
  });
  it("uses documented keyless CMC v3 ranking and normalized USD quote arrays", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: { error_code: 0 }, data: [{ id: 3408, name: "USDC", symbol: "USDC", cmc_rank: 5, quote: [{ id: 2781, market_cap: 100 }] }] })); const { getCoinMarketCapTopAssets } = await import("../lib/security/providers/coinmarketcap.server"); expect(await getCoinMarketCapTopAssets(120)).toMatchObject([{ providerAssetId: "3408", marketCapRank: 5 }]); expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/public-api/v3/cryptocurrency/listings/latest");
  });
  it("uses credentialed CMC v1 in server headers and never URL keys", async () => {
    vi.stubEnv("CMC_API_KEY", "private-cmc-key"); fetchMock.mockResolvedValue(Response.json({ status: { error_code: 0 }, data: [{ id: 3408, name: "USDC", symbol: "USDC", cmc_rank: 5, quote: { USD: { market_cap: 100 } } }] })); const { getCoinMarketCapTopAssets } = await import("../lib/security/providers/coinmarketcap.server"); await getCoinMarketCapTopAssets(120); const url = new URL(fetchMock.mock.calls[0][0]); expect(url.pathname).toBe("/v1/cryptocurrency/listings/latest"); expect(url.href).not.toContain("private-cmc-key"); expect(fetchMock.mock.calls[0][1].headers["X-CMC_PRO_API_KEY"]).toBe("private-cmc-key");
  });
  it("binds CMC metadata by numeric ID and platform; does not invent decimals", async () => {
    fetchMock.mockResolvedValue(Response.json(cmc())); const { resolveCoinMarketCapAsset } = await import("../lib/security/providers/coinmarketcap.server"); const result = await resolveCoinMarketCapAsset("3408", 1); expect(result).toMatchObject({ address: A, providerAssetId: "3408" }); expect(result).not.toHaveProperty("decimals"); await expect(resolveCoinMarketCapAsset("3408", 8453)).rejects.toThrow("chain_deployment_unavailable");
  });
  it("normalizes current CMC multi-chain rows by explicit protocol slug and blocks multiple addresses", async () => {
    const data = cmc(); const item = data.data[3408] as Record<string, unknown>;
    item.contract_address = [{ contract_address: A, platform: { coin: { slug: "base" } } }];
    fetchMock.mockResolvedValueOnce(Response.json(data));
    const { resolveCoinMarketCapAsset } = await import("../lib/security/providers/coinmarketcap.server");
    expect(await resolveCoinMarketCapAsset("3408", 8453)).toMatchObject({ address: A, chainId: 8453 });
    item.contract_address = [{ contract_address: A, platform: { coin: { slug: "base" } } }, { contract_address: B, platform: { coin: { slug: "base" } } }];
    fetchMock.mockResolvedValueOnce(Response.json(data)); await expect(resolveCoinMarketCapAsset("3408", 8453, { fresh: true })).rejects.toThrow("ambiguous_deployment");
  });
  it("rejects CMC ID mismatches and multiple deployments without selecting by ticker", async () => {
    fetchMock.mockImplementation(async () => Response.json({ status: { error_code: 0 }, data: { "3408": [{ id: 3408, platform: { slug: "ethereum", token_address: A } }, { id: 3408, platform: { slug: "ethereum", token_address: B } }] } })); const { resolveCoinMarketCapAsset } = await import("../lib/security/providers/coinmarketcap.server"); await expect(resolveCoinMarketCapAsset("3408", 1)).rejects.toThrow("ambiguous_deployment"); expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("symbol")).toBe(false);
  });
});
describe("LI.FI resolution provenance", () => {
  it("marks address corroboration candidate-bound, never an independent vote", async () => {
    fetchMock.mockResolvedValue(Response.json(token())); const { resolveLiFiCandidate } = await import("../lib/security/providers/lifi.server"); expect(await resolveLiFiCandidate(1, A)).toMatchObject({ address: A, lookupMode: "candidate-bound" });
  });
  it("rejects wrong chain/address and retains negative flags in discovery", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(token(B))); const { resolveLiFiCandidate, getLiFiDiscovery } = await import("../lib/security/providers/lifi.server"); await expect(resolveLiFiCandidate(1, A)).rejects.toThrow("identity_mismatch"); fetchMock.mockResolvedValueOnce(Response.json({ tokens: { "1": [token(A, { verificationStatus: "flagged", riskAcknowledged: true })] } })); const discovery = await getLiFiDiscovery([1]); expect(discovery.tokens[1][0].verificationStatus).toBe("flagged"); expect(discovery.tokens[1][0]).not.toHaveProperty("riskAcknowledged");
  });
  it("blocks a flagged live verdict even when a top-level or duplicate provider says verified", async () => {
    const flagged = token(A, { verificationStatus: "verified", verificationStatusBreakdown: [{ provider: "Good", result: "verified" }, { provider: "Bad", result: "flagged" }] });
    fetchMock.mockResolvedValueOnce(Response.json(flagged));
    const { resolveLiFiCandidate, resolveLiFiAsset } = await import("../lib/security/providers/lifi.server");
    await expect(resolveLiFiCandidate(1, A)).rejects.toThrow("token_flagged");
    fetchMock.mockResolvedValueOnce(Response.json({ tokens: { "1": [token(A, { verificationStatus: "verified", coinKey: "explicit" }), { ...flagged, coinKey: "explicit" }] } }));
    await expect(resolveLiFiAsset("explicit", 1)).rejects.toThrow("token_flagged");
  });
  it("independently resolves only an explicit coinKey observed in listing", async () => {
    fetchMock.mockResolvedValue(Response.json({ tokens: { "1": [token(A, { coinKey: "explicit-key" }), token(B, { coinKey: "another-key" })] } })); const { resolveLiFiAsset } = await import("../lib/security/providers/lifi.server"); expect(await resolveLiFiAsset("explicit-key", 1)).toMatchObject({ address: A, providerAssetId: "explicit-key", lookupMode: "asset-id" });
  });
  it("fails ambiguity when a bound coinKey maps to multiple same-symbol contracts", async () => {
    fetchMock.mockResolvedValue(Response.json({ tokens: { "1": [token(A, { coinKey: "same" }), token(B, { coinKey: "same" })] } })); const { resolveLiFiAsset } = await import("../lib/security/providers/lifi.server"); await expect(resolveLiFiAsset("same", 1)).rejects.toThrow("ambiguous_deployment");
  });
  it("never uses symbol as coinKey fallback", async () => {
    fetchMock.mockResolvedValue(Response.json({ tokens: { "1": [token()] } })); const { resolveLiFiAsset } = await import("../lib/security/providers/lifi.server"); await expect(resolveLiFiAsset("SAME", 1)).rejects.toThrow("asset_binding_unavailable");
  });
});
describe("bounded transport and resolver", () => {
  it("coalesces/cache requests, forces no-store/no-redirect, and sanitizes provider errors", async () => {
    fetchMock.mockImplementation(async () => Response.json(cg())); const { requestSecurityProvider } = await import("../lib/security/providers/transport.server"); const url = new URL("https://api.coingecko.com/api/v3/coins/asset-a"); await Promise.all([requestSecurityProvider("coingecko", url), requestSecurityProvider("coingecko", url)]); expect(fetchMock).toHaveBeenCalledOnce(); await requestSecurityProvider("coingecko", url); expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) });
    fetchMock.mockRejectedValueOnce(new Error("https://evil/?key=secret")); await expect(requestSecurityProvider("coingecko", url, { fresh: true })).rejects.toThrow("upstream_unavailable");
  });
  it("rejects foreign hosts, URL credentials, arbitrary paths and URL keys before network", async () => {
    const { requestSecurityProvider } = await import("../lib/security/providers/transport.server"); for (const raw of ["https://evil.example/api/v3/coins/markets", "https://user:secret@api.coingecko.com/api/v3/coins/markets", "https://api.coingecko.com/unrelated", "https://api.coingecko.com/api/v3/coins/markets?api_key=secret"]) await expect(requestSecurityProvider("coingecko", new URL(raw))).rejects.toThrow("invalid_endpoint"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows a streamed CG bulk platform map above 2 MiB while retaining its dedicated 8 MiB bound", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ id: "asset-a", platforms: { ethereum: A }, padding: "x".repeat(3 * 1024 * 1024) }]));
    const { getCoinGeckoPlatformList } = await import("../lib/security/providers/coingecko.server"); expect((await getCoinGeckoPlatformList()).get("asset-a")?.[1]).toBe(A);
    fetchMock.mockResolvedValueOnce(new Response("huge", { headers: { "content-length": "9000000" } }));
    const { requestSecurityProvider } = await import("../lib/security/providers/transport.server"); await expect(requestSecurityProvider("coingecko", new URL("https://api.coingecko.com/api/v3/coins/list?include_platform=true"), { fresh: true })).rejects.toThrow("response_too_large");
  });
  it("bounds response size without exposing provider body", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1))); const { getCoinGeckoTopAssets } = await import("../lib/security/providers/coingecko.server"); await expect(getCoinGeckoTopAssets(120)).rejects.toThrow("response_too_large");
  });
  it("enforces per-provider concurrency and minute quotas, then resets", async () => {
    vi.useFakeTimers(); const { requestSecurityProvider } = await import("../lib/security/providers/transport.server"); let release!: (response: Response) => void; fetchMock.mockReturnValue(new Promise(done => { release = done; }));
    const pending = Array.from({ length: 8 }, (_, i) => requestSecurityProvider("coingecko", new URL(`https://api.coingecko.com/api/v3/coins/asset-${i}`))); await expect(requestSecurityProvider("coingecko", new URL("https://api.coingecko.com/api/v3/coins/ninth"))).rejects.toThrow("rate_limited");
    // Each fetch needs a distinct body even when transport is held concurrently.
    release(Response.json({})); await Promise.allSettled(pending); fetchMock.mockImplementation(async () => Response.json({}));
    for (let i = 8; i < 120; i++) await requestSecurityProvider("coingecko", new URL(`https://api.coingecko.com/api/v3/coins/asset-${i}`));
    await expect(requestSecurityProvider("coingecko", new URL("https://api.coingecko.com/api/v3/coins/limited"))).rejects.toThrow("rate_limited"); vi.advanceTimersByTime(60_000); expect(await requestSecurityProvider("coingecko", new URL("https://api.coingecko.com/api/v3/coins/reset"))).toEqual({});
  });
  it("reports missing explicit CG/CMC bindings and does not link by symbol", async () => {
    fetchMock.mockResolvedValue(Response.json(token())); const { resolveTokenSources } = await import("../lib/security/resolver.server");
    const result = await resolveTokenSources({ assetId: "local-usdc", chainId: 1, type: "erc20", address: A, decimals: 6, symbol: "SAME", status: "trusted", consensusSources: [], firstVerifiedAt: "2026-10-02T00:00:00Z", lastVerifiedAt: "2026-10-02T00:00:00Z", version: 1 }); expect(result.results).toMatchObject([{ provider: "lifi", lookupMode: "candidate-bound" }]); expect(result.unavailable.map(row => row.provider)).toEqual(["coingecko", "coinmarketcap", "lifi"]); expect(fetchMock).toHaveBeenCalledOnce();
  });
});

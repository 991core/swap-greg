// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const getToken = vi.fn(); const getTokens = vi.fn(); const fetchMock = vi.fn();
import { fromToken, toToken } from "./fixtures";
import { APP_CHAINS } from "../lib/chains";
import { POPULAR_TOKEN_LIMIT } from "../lib/tokens/types";
let GET: typeof import("../app/api/tokens/search/route").GET;
const request = (query = "", chainId = 8453, extra = "") => GET(new Request("http://localhost/api/tokens/search?chainId=" + chainId + "&query=" + encodeURIComponent(query) + extra));
beforeEach(async () => {
  vi.resetModules(); vi.mocked(getToken).mockReset(); vi.mocked(getTokens).mockReset(); fetchMock.mockReset();
  vi.stubEnv("TOKEN_SEARCH_REQUESTS_PER_MINUTE", "60");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (href: string, init: RequestInit) => {
    const url = new URL(href);
    try {
      const data = url.pathname === "/v1/token" ? await getToken({}, Number(url.searchParams.get("chain")), url.searchParams.get("token"), { signal: init.signal }) : await getTokens({}, {
        chains: [Number(url.searchParams.get("chains"))], chainTypes: ["EVM"], extended: true, minPriceUSD: 0,
        orderBy: url.searchParams.get("orderBy"), limit: Number(url.searchParams.get("limit")), ...(url.searchParams.has("search") ? { search: url.searchParams.get("search") } : {}),
      }, { signal: init.signal });
      return Response.json(data);
    } catch (error) {
      const status = (error as { cause?: { status?: number } }).cause?.status;
      if (status) return new Response("private upstream diagnostic", { status });
      throw error;
    }
  });
  vi.mocked(getToken).mockResolvedValue(fromToken);
  vi.mocked(getTokens).mockResolvedValue({ tokens: { 8453: [fromToken], 1: [toToken] } });
  ({ GET } = await import("../app/api/tokens/search/route"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("token search API", () => {
  it.each(APP_CHAINS.map(chain => chain.id))("returns up to 100 valid LI.FI assets in stable discovery order on chain %s", async chainId => {
    const tokens = Array.from({ length: 101 }, (_, index) => ({ ...fromToken, chainId,
      address: "0x" + (index + 1).toString(16).padStart(40, "0"), marketCapUSD: index, volumeUSD24H: index * 2 }));
    vi.mocked(getTokens).mockResolvedValue({ tokens: { [chainId]: tokens } });
    const data = await (await request("", chainId, `&limit=${POPULAR_TOKEN_LIMIT}`)).json();
    expect(data.tokens).toHaveLength(100);
    expect(data.tokens[0]).toMatchObject({ marketCapUSD: 0, volumeUSD24H: 0 });
    expect(data.tokens[99].marketCapUSD).toBe(99);
    expect(data.truncated).toBe(true);
    expect(getTokens).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chains: [chainId], minPriceUSD: 0, extended: true, orderBy: "volumeUSD24H", limit: 101 }), expect.anything());
  });
  it("prioritizes exact name/symbol matches without ranking by LI.FI capitalization", async () => {
    const token = (index: number) => ({ ...fromToken, address: "0x" + index.toString(16).padStart(40, "0") });
    vi.mocked(getTokens).mockResolvedValue({ tokens: { 8453: [
      { ...token(1), symbol: "BIG", marketCapUSD: 100 },
      { ...token(2), symbol: "needle", marketCapUSD: null },
      { ...token(3), symbol: "UNKNOWN", marketCapUSD: "1000", volumeUSD24H: -1 },
      { ...token(4), symbol: "ZERO", marketCapUSD: 0 },
    ] } } as never);
    const data = await (await request("needle")).json();
    expect(data.tokens.map((item: { symbol: string }) => item.symbol)).toEqual(["needle", "BIG", "UNKNOWN", "ZERO"]);
    expect(data.tokens[0]).not.toHaveProperty("marketCapUSD");
    expect(data.tokens[2]).not.toHaveProperty("marketCapUSD");
    expect(data.tokens[2]).not.toHaveProperty("volumeUSD24H");
  });
  it("searches the LI.FI catalogue without a price or top-symbol exclusion", async () => {
    vi.mocked(getTokens).mockResolvedValue({ tokens: { 8453: [
      { ...fromToken, address: "0x2222222222222222222222222222222222222222", symbol: "TINY", priceUSD: "0.000000001" },
      { ...fromToken, address: "0x3333333333333333333333333333333333333333", symbol: "TINY", priceUSD: "0.000000001" },
    ] } });
    const response = await request("TINY");
    expect(response.status).toBe(200);
    expect((await response.json()).tokens).toHaveLength(2);
    expect(getTokens).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chains: [8453], search: "tiny", minPriceUSD: 0, extended: true, limit: 26 }), expect.anything());
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("deduplicates addresses case-insensitively and keeps a negative verdict", async () => {
    const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    vi.mocked(getTokens).mockResolvedValue({ tokens: { 8453: [
      { ...fromToken, address },
      { ...fromToken, address: "0x" + address.slice(2).toUpperCase(), verificationStatusBreakdown: [{ provider: "screening", result: "flagged", reason: "Risk" }] },
      { ...fromToken, address },
    ] } });
    const data = await (await request("token")).json();
    expect(data.tokens).toHaveLength(1); expect(data.tokens[0].verificationStatus).toBe("flagged");
  });
  it.each([
    ["", 999, ""], ["0x123", 8453, ""], ["x".repeat(101), 8453, ""],
    ["abc", 8453, "&limit=99999"], ["abc", 8453, "&fresh=1"], ["abc\u202e", 8453, ""],
  ])("rejects invalid input before any upstream call", async (query, chainId, extra) => {
    expect((await request(query as string, chainId as number, extra as string)).status).toBe(400);
    expect(getToken).not.toHaveBeenCalled(); expect(getTokens).not.toHaveBeenCalled();
  });
  it.each(["0x", "0xBitcoin"])("keeps the token name %s searchable", async (query) => {
    expect((await request(query)).status).toBe(200); expect(getTokens).toHaveBeenCalledOnce();
  });
  it("caches normalized requests for a minute, then refreshes", async () => {
    let now = 1_000_000; vi.spyOn(Date, "now").mockImplementation(() => now);
    await request(" ETH "); await request("eth"); expect(getTokens).toHaveBeenCalledOnce();
    now += 60_001; await request("eth"); expect(getTokens).toHaveBeenCalledTimes(2);
  });
  it("coalesces simultaneous identical requests", async () => {
    let finish!: (value: { tokens: { 8453: typeof fromToken[] } }) => void;
    vi.mocked(getTokens).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = request("same"); const second = request("same");
    await Promise.resolve(); expect(getTokens).toHaveBeenCalledOnce();
    finish({ tokens: { 8453: [fromToken] } });
    expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  });
  it("bypasses cached metadata when fresh validation is requested", async () => {
    await request(fromToken.address); await request(fromToken.address);
    expect(getToken).toHaveBeenCalledOnce();
    vi.mocked(getToken).mockResolvedValue({ ...fromToken, verificationStatus: "flagged" });
    const response = await request(fromToken.address, 8453, "&fresh=1");
    expect((await response.json()).tokens[0].verificationStatus).toBe("flagged"); expect(getToken).toHaveBeenCalledTimes(2);
    expect(getTokens).not.toHaveBeenCalled();
  });
  it.each([{ chainId: 1 }, { address: "0x2222222222222222222222222222222222222222" }, { decimals: 256 }, { decimals: -1 }, { decimals: 6 }])("rejects inconsistent exact-address metadata: %j", async (override) => {
    vi.mocked(getToken).mockResolvedValue({ ...fromToken, ...override });
    expect((await request(fromToken.address)).status).toBe(503);
  });
  it("does not cache upstream failures as empty results or expose their details", async () => {
    vi.mocked(getToken).mockRejectedValueOnce(new Error("private upstream diagnostic"));
    const response = await request(fromToken.address);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "tokens_unavailable" });
    expect((await request(fromToken.address)).status).toBe(200);
  });
  it("returns an empty result only for a confirmed LI.FI 404", async () => {
    vi.mocked(getToken).mockRejectedValue({ cause: { status: 404 } });
    const response = await request(fromToken.address);
    expect(response.status).toBe(200); expect((await response.json()).tokens).toEqual([]);
  });
  it("limits fresh upstream calls while allowing cached reads", async () => {
    vi.stubEnv("TOKEN_SEARCH_REQUESTS_PER_MINUTE", "2");
    await request("one"); await request("two");
    expect((await request("one")).status).toBe(200);
    const rejected = await request("three"); expect(rejected.status).toBe(429); expect(rejected.headers.get("retry-after")).toBe("60");
    expect(getTokens).toHaveBeenCalledTimes(2);
  });
  it("caps parallel upstream work", async () => {
    const finishers: Array<() => void> = [];
    vi.mocked(getTokens).mockImplementation(() => new Promise((resolve) => finishers.push(() => resolve({ tokens: { 8453: [fromToken] } }))));
    const running = Array.from({ length: 8 }, (_, index) => request("query" + index));
    expect((await request("overflow")).status).toBe(429);
    finishers.forEach((finish) => finish()); await Promise.all(running);
    expect(getTokens).toHaveBeenCalledTimes(8);
  });
  it("returns bounded results with an explicit refine-search signal at the maximum", async () => {
    const tokens = Array.from({ length: 201 }, (_, index) => ({ ...fromToken, address: "0x" + (index + 1).toString(16).padStart(40, "0") }));
    vi.mocked(getTokens).mockResolvedValue({ tokens: { 8453: tokens } });
    const first = await (await request("eth")).json();
    expect(first.tokens).toHaveLength(25); expect(first.hasMore).toBe(true);
    const last = await (await request("eth", 8453, "&limit=200")).json();
    expect(last.tokens).toHaveLength(200); expect(last.truncated).toBe(true); expect(last.hasMore).toBe(false);
  });
  it("keeps the key server-side and strips untrusted consent and unsafe logos", async () => {
    vi.stubEnv("LIFI_API_KEY", "test-private-token-key");
    vi.mocked(getToken).mockResolvedValue({ ...fromToken, riskAcknowledged: true, logoURI: "javascript:alert(1)", verificationStatus: undefined } as never);
    const data = await (await request(fromToken.address)).json();
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "x-lifi-api-key": "test-private-token-key" });
    expect(data.tokens[0]).not.toHaveProperty("riskAcknowledged"); expect(data.tokens[0]).not.toHaveProperty("logoURI");
    expect(data.tokens[0].verificationStatus).toBe("unverified"); expect(JSON.stringify(data)).not.toContain("test-private-token-key");
  });
});

// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fromToken } from "./fixtures";
const fetchMock = vi.fn();
beforeEach(() => { vi.resetModules(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("LIFI_API_KEY", "server-test-key"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("keeps the installed LI.FI SDK endpoint contract for text discovery with no price restriction", async () => {
  const sdk = await import("@lifi/sdk");
  fetchMock.mockImplementation(async () => Response.json({ tokens: { 8453: [fromToken] } }));
  const client = sdk.createClient({ integrator: "hermes-hms", apiKey: "server-test-key", preloadChains: false });
  await sdk.getTokens(client, { chains: [8453], chainTypes: [sdk.ChainType.EVM], extended: true, minPriceUSD: 0, orderBy: "volumeUSD24H", limit: 101, search: "eth" });
  const sdkUrl = new URL(String(fetchMock.mock.calls[0][0]));
  const { GET } = await import("../app/api/tokens/search/route");
  const response = await GET(new Request("http://localhost/api/tokens/search?chainId=8453&query=eth&limit=100"));
  expect(response.status).toBe(200);
  const serverUrl = new URL(String(fetchMock.mock.calls[1][0]));
  expect(serverUrl.href).toBe(sdkUrl.href);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: "error", cache: "no-store", headers: { "x-lifi-integrator": "hermes-hms", "x-lifi-api-key": "server-test-key" } });
});
it("keeps the installed SDK exact-address endpoint and returns metadata independently of discovery", async () => {
  const sdk = await import("@lifi/sdk"); fetchMock.mockImplementation(async () => Response.json(fromToken));
  await sdk.getToken(sdk.createClient({ integrator: "hermes-hms", preloadChains: false }), 8453, fromToken.address);
  const sdkUrl = String(fetchMock.mock.calls[0][0]);
  const { GET } = await import("../app/api/tokens/search/route");
  expect((await GET(new Request(`http://localhost/api/tokens/search?chainId=8453&query=${fromToken.address}&fresh=1`))).status).toBe(200);
  expect(String(fetchMock.mock.calls[1][0])).toBe(sdkUrl);
});
it("rejects declared/chunked oversized LI.FI responses without caching a false empty list", async () => {
  fetchMock.mockImplementationOnce(async () => new Response("x", { headers: { "Content-Length": "2097153" } }));
  fetchMock.mockImplementationOnce(async () => new Response("x".repeat(2097153)));
  fetchMock.mockImplementation(async () => Response.json({ tokens: { 8453: [fromToken] } }));
  const { GET } = await import("../app/api/tokens/search/route");
  const request = () => GET(new Request("http://localhost/api/tokens/search?chainId=8453&query=eth"));
  expect((await request()).status).toBe(503); expect((await request()).status).toBe(503); expect((await request()).status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("shares the actual LI.FI fetch budget between discovery and market enrichment while preserving cached reads", async () => {
  vi.stubEnv("LIFI_SERVER_REQUESTS_PER_MINUTE", "2");
  fetchMock.mockImplementation(async (url: string) => new URL(url).pathname === "/v1/token" ? Response.json(fromToken) : Response.json({ tokens: { 8453: [fromToken] } }));
  const { GET } = await import("../app/api/tokens/search/route");
  const transport = await import("../lib/security/providers/transport.server");
  expect((await GET(new Request("http://localhost/api/tokens/search?chainId=8453&query=eth"))).status).toBe(200);
  expect(await transport.requestSecurityProvider("lifi", new URL(`https://li.quest/v1/token?chain=8453&token=${fromToken.address}`))).toEqual(fromToken);
  expect((await GET(new Request("http://localhost/api/tokens/search?chainId=8453&query=other"))).status).toBe(429);
  expect((await GET(new Request("http://localhost/api/tokens/search?chainId=8453&query=eth"))).status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

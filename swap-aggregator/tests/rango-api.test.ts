import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { rangoQuery, RANGO_PUBLIC_TEST_KEY } from "../lib/aggregators/rango/server";
import { POST } from "../app/api/rango/[operation]/route";
import { params, wallet } from "./fixtures";
import { hash, rangoQuote, requestId } from "./rango-fixtures";

const fetchMock = vi.fn();
const request = (body: unknown, operation = "quote", headers: Record<string,string> = {}) => POST(new Request(`http://localhost/api/rango/${operation}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), { params: { operation } });
beforeEach(() => { vi.stubEnv("RANGO_API_KEY", ""); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json(rangoQuote())); });
afterEach(() => vi.unstubAllEnvs());
describe("Rango server boundary", () => {
  it("defaults to the documented public test key and percent slippage", () => {
    const url = rangoQuery("quote", { params });
    expect(url.origin).toBe("https://public-api.rango.exchange"); expect(url.searchParams.get("apiKey")).toBe(RANGO_PUBLIC_TEST_KEY);
    expect(url.searchParams.get("slippage")).toBe("0.5"); expect(url.searchParams.get("referrerFee")).toBe("0");
    expect(url.searchParams.get("enableCentralizedSwappers")).toBe("false"); expect(url.searchParams.get("avoidNativeFee")).toBe("true");
  });
  it("uses only the private host for a configured key, never a user URL", () => {
    vi.stubEnv("RANGO_API_KEY", "test-private-key");
    const url = rangoQuery("quote", { params, url: "https://evil.example", apiKey: "evil" });
    expect(url.origin).toBe("https://api.rango.exchange"); expect(url.searchParams.get("apiKey")).toBe("test-private-key");
  });
  it("pins recipient, selected swapper, finite approval and server-owned settings", () => {
    const url = rangoQuery("swap", { params, swapper: "Bridge", toAddress: "evil", infiniteApprove: true, slippage: 99 });
    expect(url.searchParams.get("toAddress")).toBe(wallet); expect(url.searchParams.get("swappers")).toBe("Bridge");
    expect(url.searchParams.get("infiniteApprove")).toBe("false"); expect(url.searchParams.get("disableEstimate")).toBe("false");
    expect(url.searchParams.get("slippage")).toBe("0.5");
  });
  it.each([{ ...params, fromAmount: "1e18" },{ ...params, fromAmount: "-1" },{ ...params, fromChainId: 999 },{ ...params, fromAddress: "bad" }])("rejects malformed input before the network", async input => {
    expect((await request({ params: input })).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("validates tracking IDs and refuses arbitrary operation paths", () => {
    expect(rangoQuery("status", { requestId, txId: hash }).pathname).toBe("/basic/status");
    expect(() => rangoQuery("status", { requestId: "bad", txId: hash })).toThrow();
    expect(() => rangoQuery("../meta", { params })).toThrow();
  });
  it("serves a valid quote with no-store headers and no private key", async () => {
    vi.stubEnv("RANGO_API_KEY", "test-private-key"); const response = await request({ params });
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("test-private-key");
  });
  it("does not expose upstream key-bearing errors", async () => {
    fetchMock.mockRejectedValue(new Error("https://api.rango.exchange/?apiKey=secret"));
    const response = await request({ params }); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret");
  });
  it("preserves 429 as a retriable response", async () => { fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 })); const response = await request({ params }); expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60"); });
  it("blocks a cross-origin request before calling the provider", async () => { expect((await request({ params }, "quote", { origin: "https://evil.example" })).status).toBe(403); expect(fetchMock).not.toHaveBeenCalled(); });
  it("accepts the public origin when Next uses an internal request URL", async () => {
    const response = await request({ params }, "quote", { host: "hermes.example", origin: "https://hermes.example", "x-forwarded-proto": "https" });
    expect(response.status).toBe(200);
  });
  it("rejects the wrong origin port or scheme", async () => {
    expect((await request({ params }, "quote", { host: "localhost:3000", origin: "http://localhost:3001" })).status).toBe(403);
    expect((await request({ params }, "quote", { host: "hermes.example", origin: "http://hermes.example", "x-forwarded-proto": "https" })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects oversized input", async () => { expect((await request({ value: "x".repeat(5000) })).status).toBe(413); expect(fetchMock).not.toHaveBeenCalled(); });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const wallet = "0x1111111111111111111111111111111111111111";
const deposit = "0x2222222222222222222222222222222222222222";
const origin = { assetId: "nep141:base-usdc.omft.near", blockchain: "base", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, symbol: "USDC" };
const destination = { assetId: "nep141:eth-usdc.omft.near", blockchain: "eth", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, symbol: "USDC" };
const input = { fromChainId: 8453, toChainId: 1, fromTokenAddress: origin.contractAddress, toTokenAddress: destination.contractAddress, fromTokenDecimals: 6, toTokenDecimals: 6, fromAmount: "1000000", wallet, dry: false };
const fetchMock = vi.fn();
let mutate: (value: any) => any;
function proof(request: any) {
  return { correlationId: "test-proof", timestamp: new Date().toISOString(), signature: "test-signature", quoteRequest: request,
    quote: { amountIn: request.amount, amountOut: "990000", minAmountOut: "980000", timeEstimate: 60,
      ...(request.dry ? {} : { depositAddress: deposit, deadline: request.deadline }) } };
}
async function quote(body: unknown = input, headers: Record<string, string> = {}) {
  const { POST } = await import("../app/api/oneclick/quote/route");
  return POST(new Request("http://localhost/api/oneclick/quote", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
}
async function status(data: unknown, query = `depositAddress=${deposit}`, headers: Record<string, string> = {}) {
  fetchMock.mockResolvedValue(Response.json(data));
  const { GET } = await import("../app/api/oneclick/status/route");
  return GET(new Request(`http://localhost/api/oneclick/status?${query}`, { headers }));
}
beforeEach(() => {
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_PLATFORM_FEE_PERCENT", "0"); vi.stubEnv("NEAR_1CLICK_API_KEY", "private-test-key");
  mutate = value => value; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith("/tokens") ? Response.json([origin, destination]) : Response.json(mutate(proof(JSON.parse(String(init?.body))))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("1Click quote server boundary", () => {
  it("returns a complete linked proof, real minimum and server-owned parameters without credentials", async () => {
    const response = await quote(); const data = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data.originToken).toEqual(origin); expect(data.destinationToken).toEqual(destination);
    expect(data.quoteResponse.signature).toBe("test-signature"); expect(data.quoteResponse.quoteRequest).toMatchObject({ recipient: wallet, refundTo: wallet, depositMode: "SIMPLE", dry: false, slippageTolerance: 50 });
    expect(data.minAmountOut).toBe("980000"); expect(JSON.stringify(data)).not.toContain("private-test-key");
  });
  it("keeps anonymous preview proofs without deposit instructions", async () => {
    const response = await quote({ ...input, wallet: undefined, dry: true });
    expect(response.status).toBe(200); const data = await response.json();
    expect(data).not.toHaveProperty("depositAddress"); expect(data.quoteResponse.quoteRequest.dry).toBe(true); expect(data.quoteResponse.quote).not.toHaveProperty("depositAddress");
  });
  it.each([
    { fromAmount: "0" }, { fromAmount: "1e6" }, { fromAmount: "01" }, { fromAmount: (BigInt(1) << BigInt(256)).toString() },
    { fromTokenDecimals: -1 }, { toTokenDecimals: 256 }, { fromChainId: 999 }, { fromChainId: "8453" },
    { dry: "false" }, { wallet: undefined }, { wallet: `0x${"0".repeat(40)}` }, { fromTokenAddress: "bad" },
    { toChainId: 8453, toTokenAddress: origin.contractAddress },
  ])("rejects invalid input before upstream work %j", async change => {
    const response = await quote({ ...input, ...change }); expect(response.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled(); expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each(["recipient", "refundTo", "dry", "swapType", "depositType", "refundType", "recipientType", "originAsset", "destinationAsset", "amount", "slippageTolerance", "deadline", "depositMode"])("rejects absent or altered request binding %s", async field => {
    mutate = data => { delete data.quoteRequest[field]; return data; }; expect((await quote()).status).toBe(502);
  });
  it.each([
    (data: any) => ({ ...data, quoteRequest: undefined }),
    (data: any) => ({ ...data, signature: undefined }),
    (data: any) => ({ ...data, quoteRequest: { ...data.quoteRequest, recipient: deposit } }),
    (data: any) => ({ ...data, quoteRequest: { ...data.quoteRequest, refundTo: deposit } }),
    (data: any) => ({ ...data, quoteRequest: { ...data.quoteRequest, appFees: [{ recipient: "fee.near", fee: 10 }] } }),
    (data: any) => ({ ...data, quote: { ...data.quote, minAmountOut: "0" } }),
    (data: any) => ({ ...data, quote: { ...data.quote, minAmountOut: "1000000" } }),
    (data: any) => ({ ...data, quote: { ...data.quote, depositAddress: `0x${"0".repeat(40)}` } }),
    (data: any) => ({ ...data, quote: { ...data.quote, deadline: new Date(Date.now() + 10_000).toISOString() } }),
    (data: any) => ({ ...data, quote: { ...data.quote, depositMemo: "memo" } }),
    (data: any) => ({ ...data, quote: { ...data.quote, timeEstimate: undefined } }),
  ])("rejects conflicting recipients, fees, deposits and output", async mutation => { mutate = mutation; expect((await quote()).status).toBe(502); });
  it("rejects registry decimal mismatch", async () => { expect((await quote({ ...input, toTokenDecimals: 18 })).status).toBe(400); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("bounds JSON, body bytes and origin before network work", async () => {
    expect((await quote(input, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await quote({ padding: "x".repeat(4097) })).status).toBe(413);
    expect((await quote(input, { origin: "https://evil.example" })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts trusted public host/protocol and rejects a different origin port", async () => {
    expect((await quote(input, { host: "hermes.example", "x-forwarded-proto": "https", origin: "https://hermes.example" })).status).toBe(200);
    expect((await quote(input, { host: "localhost:3000", origin: "http://localhost:3001" })).status).toBe(403);
  });
  it("sanitizes provider errors and preserves retriable rate limits", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Authorization Bearer private-test-key")); const bad = await quote(); expect(bad.status).toBe(502); expect(await bad.text()).not.toContain("private-test-key");
    fetchMock.mockResolvedValueOnce(new Response("secret", { status: 429 })); const limited = await quote(); expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("60"); expect(limited.headers.get("Cache-Control")).toBe("no-store");
  });
});
describe("1Click status proof", () => {
  const request = () => ({ dry: false, swapType: "EXACT_INPUT", slippageTolerance: 50, originAsset: origin.assetId, destinationAsset: destination.assetId, amount: input.fromAmount, depositType: "ORIGIN_CHAIN", recipient: wallet, recipientType: "DESTINATION_CHAIN", refundTo: wallet, refundType: "ORIGIN_CHAIN", depositMode: "SIMPLE", deadline: new Date(Date.now() - 60_000).toISOString() });
  const completed = () => ({ status: "SUCCESS", quoteResponse: proof(request()), swapDetails: { amountIn: input.fromAmount, amountOut: "980000", originChainTxHashes: [{ hash: `0x${"a".repeat(64)}` }], destinationChainTxHashes: [{ hash: `0x${"b".repeat(64)}`, explorerUrl: "https://etherscan.io/tx/test" }] } });
  it("does not terminate bare SUCCESS, failed or refunded provider assertions", async () => {
    for (const value of ["SUCCESS", "FAILED", "REFUNDED"]) expect(await (await status({ status: value })).json()).toEqual({ status: "PROCESSING" });
  });
  it("accepts full settlement evidence after quote expiry and preserves its proof", async () => {
    const response = await status(completed()); expect(response.status).toBe(200); const data = await response.json(); expect(data.status).toBe("SUCCESS"); expect(data.quoteResponse.signature).toBe("test-signature"); expect(data.swapDetails.amountOut).toBe("980000");
  });
  it.each(["amountOut", "amountIn", "originChainTxHashes", "destinationChainTxHashes"])("requires complete output and source evidence %s", async field => {
    const data = completed(); delete (data.swapDetails as any)[field]; expect((await (await status(data)).json()).status).toBe("PROCESSING");
  });
  it("keeps wrong deposits, low output and malformed hashes pending", async () => {
    const data = completed(); data.quoteResponse.quote.depositAddress = wallet; expect((await (await status(data)).json()).status).toBe("PROCESSING");
    const low = completed(); low.swapDetails.amountOut = "1"; expect((await (await status(low)).json()).status).toBe("PROCESSING");
    const malformed = completed(); malformed.swapDetails.destinationChainTxHashes[0].hash = "bad"; expect((await (await status(malformed)).json()).status).toBe("PROCESSING");
  });
  it("rejects extra or duplicate status parameters and cross-origin before upstream", async () => {
    expect((await status({}, `depositAddress=${deposit}&depositAddress=${wallet}`)).status).toBe(400);
    expect((await status({}, `depositAddress=${deposit}&url=https://evil.example`)).status).toBe(400);
    expect((await status({}, `depositAddress=${deposit}`, { origin: "https://evil.example" })).status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never forwards unsafe explorer links", async () => {
    const data = completed(); data.swapDetails.destinationChainTxHashes[0].explorerUrl = "javascript:alert(1)"; const result = await (await status(data)).json(); expect(result.status).toBe("SUCCESS"); expect(result).not.toHaveProperty("destinationUrl");
  });
});

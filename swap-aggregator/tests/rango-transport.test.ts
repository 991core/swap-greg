// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { params } from "./fixtures";
import { hash, requestId, rangoQuote } from "./rango-fixtures";
const fetchMock = vi.fn();
beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
it("bounds declared and chunked Rango responses before JSON accumulation", async () => {
  const { requestRangoOnServer } = await import("../lib/aggregators/rango/server");
  const cancel = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { "Content-Length": "2097153" } }));
  await expect(requestRangoOnServer("quote", { params })).rejects.toMatchObject({ status: 502 }); expect(cancel).toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(new Response("x".repeat(2097153)));
  await expect(requestRangoOnServer("quote", { params })).rejects.toMatchObject({ status: 502 });
  fetchMock.mockResolvedValueOnce(Response.json(rangoQuote())); expect(await requestRangoOnServer("quote", { params })).toHaveProperty("requestId");
});
it("retains documented Rango source/destination diagnostics and strips unsafe URLs/unknown fields", async () => {
  const { requestRangoOnServer } = await import("../lib/aggregators/rango/server");
  fetchMock.mockResolvedValue(Response.json({ status: "running", error: "apiKey=secret", output: null,
    explorerUrl: [{ url: `https://basescan.org/tx/${hash}`, description: "Inbound" }, { url: "javascript:alert(1)" }, { url: "https://explorer.example/tx?apiKey=secret" }], diagnosisUrl: "https://rango.exchange/diagnosis/wormhole?iframe=1",
    bridgeData: { srcChainId: 8453, srcTxHash: hash, srcToken: null, srcTokenAmt: "1000", srcTokenDecimals: 18, destChainId: 1, destTxHash: hash, destToken: null, destTokenAmt: "995", destTokenDecimals: 18, privateDiagnostic: "apiKey=secret" }, privateDebug: "secret" }));
  const value = await requestRangoOnServer("status", { requestId, txId: hash });
  expect(value).toMatchObject({ bridgeData: { srcChainId: 8453, srcTxHash: hash, destTokenAmt: "995" }, explorerUrl: [{ url: `https://basescan.org/tx/${hash}`, description: "Inbound" }], diagnosisUrl: "https://rango.exchange/diagnosis/wormhole?iframe=1" });
  expect(JSON.stringify(value)).not.toContain("secret");
});

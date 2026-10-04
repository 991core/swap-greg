// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.fn();
beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.stubEnv("HERMES_EXECUTION_DISABLED", "false"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([undefined, "quotes", "incident", "invalid"])("blocks executable Rango preparations in %s mode before upstream work", async mode => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_MODE", mode);
  const { POST } = await import("../app/api/rango/[operation]/route");
  const response = await POST(new Request("http://localhost/api/rango/swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), { params: Promise.resolve({ operation: "swap" }) });
  expect(response.status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
});
it("blocks a non-dry 1Click preparation in quotes mode while rejecting before token/provider work", async () => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_MODE", "quotes");
  const { POST } = await import("../app/api/oneclick/quote/route");
  const response = await POST(new Request("http://localhost/api/oneclick/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromChainId: 8453, toChainId: 1, fromTokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", toTokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", fromTokenDecimals: 6, toTokenDecimals: 6, fromAmount: "1000000", wallet: "0x1111111111111111111111111111111111111111", dry: false }) }));
  expect(response.status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
});
it("incident runtime switch closes new preparations and leaves status endpoint live", async () => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_MODE", "enabled"); vi.stubEnv("HERMES_EXECUTION_DISABLED", "true");
  const { GET } = await import("../app/api/release/route"); expect(await (await GET()).json()).toEqual({ executionEnabled: false });
  const status = await import("../app/api/oneclick/status/route");
  fetchMock.mockResolvedValue(Response.json({ status: "PROCESSING" }));
  const response = await status.GET(new Request("http://localhost/api/oneclick/status?depositAddress=0x1111111111111111111111111111111111111111"));
  expect(response.status).toBe(200); expect(fetchMock).toHaveBeenCalledOnce();
});
it("health and release are no-store and never call providers", async () => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_MODE", "quotes");
  const health = await import("../app/api/health/route"); const release = await import("../app/api/release/route");
  expect(await (await health.GET()).json()).toEqual({ status: "ok", service: "hermes" });
  const response = await release.GET(); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(await response.json()).toEqual({ executionEnabled: false }); expect(fetchMock).not.toHaveBeenCalled();
});
it("also closes executable preparations at the server transport boundary", async () => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_MODE", "quotes");
  const rango = await import("../lib/aggregators/rango/server"); const oneclick = await import("../lib/aggregators/oneclick/server");
  await expect(rango.requestRangoOnServer("swap", {})).rejects.toMatchObject({ status: 403 });
  await expect(oneclick.oneClickRequest("/quote", { method: "POST", body: JSON.stringify({ dry: false }) })).rejects.toMatchObject({ status: 403 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("public diagnostic APIs cannot be enabled in production and do not touch files", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("HERMES_ENABLE_DIAGNOSTIC_API", "true");
  const registry = await import("../app/api/security/registry/route"); const validation = await import("../app/api/security/validate/route");
  expect((await registry.GET()).status).toBe(410);
  expect((await validation.POST(new Request("http://localhost", { method: "POST", body: "not JSON" }))).status).toBe(410);
  expect(fetchMock).not.toHaveBeenCalled();
});

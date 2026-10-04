// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let api: typeof import("../lib/server/api");
const req = (ip = "192.0.2.1", extra: Record<string, string> = {}) => new Request("http://internal/api/test", { headers: { host: "hermes.example", origin: "https://hermes.example", "x-hermes-client-ip": ip, ...extra } });
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv("HERMES_PUBLIC_ORIGIN", "https://hermes.example"); vi.stubEnv("HERMES_TRUST_PROXY", "true");
  vi.stubEnv("HERMES_EXECUTION_DISABLED", "false"); vi.stubEnv("HERMES_API_LOGS", "false");
  api = await import("../lib/server/api");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("public API authority and budgets", () => {
  it("accepts canonical HTTPS behind internal HTTP without trusting forwarded protocol", () => {
    expect(() => api.validateApiOrigin(req("192.0.2.1", { "x-forwarded-proto": "file,https" }))).not.toThrow();
    expect(() => api.validateApiOrigin(req("192.0.2.1", { origin: "http://hermes.example", "x-forwarded-proto": "http" }))).toThrow();
    expect(() => api.validateApiOrigin(req("192.0.2.1", { host: "evil.example" }))).toThrow();
  });
  it("ignores spoofed forwarded identity and isolates a second trusted client plus status", async () => {
    const task = vi.fn(async () => Response.json({ ok: true }));
    for (let index = 0; index < 20; index++) expect((await api.withApiGuard("rango.quote", req("192.0.2.1", { "x-forwarded-for": `198.51.100.${index}` }), task)).status).toBe(200);
    const limited = await api.withApiGuard("rango.quote", req(), task);
    expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("60");
    expect((await api.withApiGuard("rango.quote", req("192.0.2.2"), task)).status).toBe(200);
    expect((await api.withApiGuard("rango.status", req(), task)).status).toBe(200);
    expect(task).toHaveBeenCalledTimes(22);
  });
  it("does not trust IP headers without explicit proxy mode and fails closed for invalid trusted IP", async () => {
    const task = vi.fn(async () => Response.json({ ok: true }));
    expect((await api.withApiGuard("rango.quote", req("1.2.3.4,5.6.7.8"), task)).status).toBe(403);
    vi.stubEnv("HERMES_TRUST_PROXY", "false");
    for (let index = 0; index < 60; index++) await api.withApiGuard("rango.quote", req(`198.51.100.${index}`), task);
    expect((await api.withApiGuard("rango.quote", req("198.51.100.99"), task)).status).toBe(429);
  });
  it("bounds concurrency and frees slots after failures without consuming tracking capacity", async () => {
    const resolvers: Array<() => void> = [];
    const pending = Array.from({ length: 8 }, (_, index) => api.withApiGuard("rango.quote", req(`192.0.2.${index}`), () => new Promise<Response>(resolve => resolvers.push(() => resolve(Response.json({}))))));
    expect((await api.withApiGuard("rango.quote", req("192.0.2.99"), async () => Response.json({}))).status).toBe(429);
    expect((await api.withApiGuard("rango.status", req(), async () => Response.json({}))).status).toBe(200);
    resolvers.forEach(resolve => resolve()); await Promise.all(pending);
    const failure = await api.withApiGuard("rango.quote", req(), async () => { throw new Error("apiKey=secret and 0xwallet"); });
    expect(await failure.text()).not.toMatch(/secret|wallet/);
    expect((await api.withApiGuard("rango.quote", req(), async () => Response.json({}))).status).toBe(200);
  });
  it("logs only fixed operation, numeric aggregates and never financial or IP data", async () => {
    vi.stubEnv("HERMES_API_LOGS", "true"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const url = new Request("http://internal/api/oneclick/status?depositAddress=0x123456", { headers: { host: "hermes.example", "x-hermes-client-ip": "192.0.2.1" } });
    await api.withApiGuard("oneclick.status", url, async () => { throw new Error("private-key and quote"); });
    api.observeApiCache("oneclick.tokens", true);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|quote|192\.0\.2|123456|depositAddress/);
    expect(api.apiMetricsSnapshot()["oneclick.status"]).toMatchObject({ requests: 1, errors: 1 });
    expect(api.apiMetricsSnapshot()["oneclick.tokens"].cacheHits).toBe(1);
  });
});
describe("byte bounds before accumulation and slow streams", () => {
  it("rejects chunked oversized input and cancels the reader before later chunks", async () => {
    const cancel = vi.fn(); let pulls = 0;
    const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(3000)); }, cancel });
    const request = new Request("http://internal", { method: "POST", body, duplex: "half", headers: { "Content-Type": "application/json" } } as RequestInit);
    await expect(api.readApiJson(request)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled(); expect(pulls).toBeLessThanOrEqual(3);
  });
  it("uses UTF-8 byte length rather than character count and preserves boundary-spanning characters", async () => {
    await expect(api.readBoundedText(new Response("é".repeat(2049)), 4096)).rejects.toMatchObject({ status: 413 });
    const body = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from([0xc3])); controller.enqueue(Uint8Array.from([0xa9])); controller.close(); } });
    expect(await api.readBoundedText(new Response(body), 2)).toBe("é");
  });
  it("rejects declared response size without reading it and bounds unknown-length provider streams", async () => {
    const cancel = vi.fn(); const stream = new ReadableStream({ cancel });
    await expect(api.readBoundedText(new Response(stream, { headers: { "Content-Length": "2097153" } }), 2097152, { upstream: true })).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalled();
    await expect(api.readBoundedText(new Response("x".repeat(4097)), 4096, { upstream: true })).rejects.toMatchObject({ status: 502 });
  });
  it("times out a stalled body and cancels it instead of holding a concurrency slot indefinitely", async () => {
    const cancel = vi.fn(); const source = new Response(new ReadableStream({ cancel }));
    await expect(api.readBoundedText(source, 4096, { timeoutMs: 20 })).rejects.toMatchObject({ status: 408 });
    expect(cancel).toHaveBeenCalled();
  });
  it("cancels a stalled read with the caller signal", async () => {
    const controller = new AbortController(); const reading = api.readBoundedText(new Response(new ReadableStream({})), 4096, { signal: controller.signal });
    controller.abort(); await expect(reading).rejects.toMatchObject({ status: 408 });
  });
});

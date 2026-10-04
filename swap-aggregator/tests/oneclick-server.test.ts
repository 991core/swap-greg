// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const token = { assetId: "nep141:base-usdc.omft.near", blockchain: "base", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, symbol: "USDC" };
const fetchMock = vi.fn();
beforeEach(() => { vi.resetModules(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockImplementation(async () => Response.json([token])); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("1Click token registry", () => {
  it("coalesces, caches for five minutes, and expires the registry", async () => {
    vi.useFakeTimers(); const { getOneClickTokens } = await import("../lib/aggregators/oneclick/server");
    const results = await Promise.all([getOneClickTokens(), getOneClickTokens()]); expect(results[0]).toEqual([token]); expect(fetchMock).toHaveBeenCalledOnce();
    await getOneClickTokens(); expect(fetchMock).toHaveBeenCalledOnce(); vi.advanceTimersByTime(300_001); await getOneClickTokens(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("deduplicates identical rows deterministically", async () => {
    fetchMock.mockResolvedValue(Response.json([token, { ...token }]));
    const { getOneClickTokens } = await import("../lib/aggregators/oneclick/server"); expect(await getOneClickTokens()).toEqual([token]);
  });
  it.each([
    [{ ...token, decimals: -1 }], [{ ...token, decimals: 256 }], [{ ...token, decimals: 1.5 }], [{ ...token, assetId: "x".repeat(257) }], [{ ...token, symbol: "x".repeat(65) }],
    [token, { ...token, decimals: 18 }], [token, { ...token, assetId: "different" }],
    [token, { ...token, contractAddress: "0x1111111111111111111111111111111111111111" }], [token, { ...token, symbol: "IMPOSTOR" }],
    Array.from({ length: 5001 }, () => token),
  ])("fails closed on malformed or conflicting bounded registry rows", async registry => {
    fetchMock.mockResolvedValue(Response.json(registry)); const { getOneClickTokens } = await import("../lib/aggregators/oneclick/server"); await expect(getOneClickTokens()).rejects.toThrow();
  });
  it("does not cache malformed responses", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...token, decimals: -1 }])); const { getOneClickTokens } = await import("../lib/aggregators/oneclick/server");
    await expect(getOneClickTokens()).rejects.toThrow(); expect(await getOneClickTokens()).toEqual([token]); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("allows one consumer to abort without poisoning shared registry work", async () => {
    let resolve!: (value: Response) => void; fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const { getOneClickTokens } = await import("../lib/aggregators/oneclick/server"); const controller = new AbortController();
    const cancelled = getOneClickTokens(controller.signal); const second = getOneClickTokens(); controller.abort(); await expect(cancelled).rejects.toThrow("cancelled"); resolve(Response.json([token])); expect(await second).toEqual([token]);
  });
});
describe("1Click transport and budgets", () => {
  it("uses fixed hosts, credentials and no redirects or retries with a fourteen second bound", async () => {
    const { oneClickRequest } = await import("../lib/aggregators/oneclick/server"); await oneClickRequest("/quote", { method: "POST", body: JSON.stringify({ dry: true }), headers: { Authorization: "untrusted" } });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock.mock.calls[0][0]).toBe("https://1click.chaindefuser.com/v0/quote"); expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).not.toBe("untrusted"); await expect(oneClickRequest("https://evil.example")).rejects.toThrow("Invalid operation"); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("bounds provider response bytes", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1))); const { oneClickRequest } = await import("../lib/aggregators/oneclick/server"); await expect(oneClickRequest("/tokens")).rejects.toThrow("unavailable");
  });
  it("coalesces equal work, isolates operation budgets and releases in-flight slots", async () => {
    const { runOneClickOperation } = await import("../lib/aggregators/oneclick/server"); let resolve!: (value: string) => void;
    const task = vi.fn(() => new Promise<string>(done => { resolve = done; }));
    const first = runOneClickOperation("quote", "same", task); const second = runOneClickOperation("quote", "same", task); await Promise.resolve(); expect(task).toHaveBeenCalledOnce();
    resolve("proof"); expect(await first).toBe("proof"); expect(await second).toBe("proof");
    for (let i = 0; i < 58; i++) await runOneClickOperation("quote", String(i), async () => i);
    await expect(runOneClickOperation("quote", "limited", async () => 1)).rejects.toMatchObject({ status: 429 });
    expect(await runOneClickOperation("status", "independent", async () => "status")).toBe("status"); expect(await runOneClickOperation("tokens", "independent", async () => "tokens")).toBe("tokens");
  });
  it("bounds distinct concurrent work and releases slots on failure", async () => {
    const { runOneClickOperation } = await import("../lib/aggregators/oneclick/server"); const resolve: Array<() => void> = [];
    const pending = Array.from({ length: 8 }, (_, i) => runOneClickOperation("quote", String(i), () => new Promise<void>(done => resolve.push(done)))); await Promise.resolve();
    await expect(runOneClickOperation("quote", "ninth", async () => 1)).rejects.toMatchObject({ status: 429 }); resolve.forEach(done => done()); await Promise.all(pending);
    await expect(runOneClickOperation("quote", "fail", async () => { throw new Error("fail"); })).rejects.toThrow("fail"); expect(await runOneClickOperation("quote", "recovered", async () => 1)).toBe(1);
  });
  it("aborts one coalesced caller without cancelling another", async () => {
    const { runOneClickOperation } = await import("../lib/aggregators/oneclick/server"); let resolve!: (value: string) => void; const controller = new AbortController();
    const first = runOneClickOperation("status", "same", () => new Promise<string>(done => { resolve = done; }), controller.signal);
    const second = runOneClickOperation("status", "same", async () => "wrong"); await Promise.resolve(); controller.abort(); await expect(first).rejects.toThrow("cancelled"); resolve("status"); expect(await second).toBe("status");
  });
  it("expires per-operation minute quotas", async () => {
    vi.useFakeTimers(); const { runOneClickOperation } = await import("../lib/aggregators/oneclick/server");
    for (let i = 0; i < 60; i++) await runOneClickOperation("tokens", String(i), async () => i);
    await expect(runOneClickOperation("tokens", "limited", async () => 1)).rejects.toMatchObject({ status: 429 }); vi.advanceTimersByTime(60_000); expect(await runOneClickOperation("tokens", "reset", async () => 1)).toBe(1);
  });
});

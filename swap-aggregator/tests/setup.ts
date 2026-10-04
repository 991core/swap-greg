import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetTokenVerdictsForTests } from "../lib/tokens/verdicts";
const heldLocks = new Set<string>();
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (input === "/api/release") return Promise.resolve(new Response(JSON.stringify({ executionEnabled: true }), { status: 200, headers: { "content-type": "application/json" } }));
  return originalFetch(input, init);
}) as typeof fetch;
Object.defineProperty(navigator, "locks", { configurable: true, value: {
  request: async <T>(name: string, _options: unknown, callback: (lock: object | null) => Promise<T>): Promise<T> => {
    if (heldLocks.has(name)) return callback(null);
    heldLocks.add(name);
    try { return await callback({ name }); }
    finally { heldLocks.delete(name); }
  },
} });
beforeEach(async () => { heldLocks.clear(); if (typeof localStorage !== "undefined") localStorage.clear(); (await import("../lib/intent/journal")).resetIntentJournalForTests(); (await import("../lib/tokens/popular")).resetPopularTokensForTests(); resetTokenVerdictsForTests(); (await import("../lib/security/client")).resetRegistryForTests(); (await import("../lib/tokens/market-universe")).resetMarketUniverseForTests(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

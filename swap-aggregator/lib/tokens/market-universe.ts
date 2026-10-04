import type { AppToken } from "./types";
import { validateToken } from "./validation";
import { APP_CHAIN_IDS } from "../chains";
import { rememberTokenVerdicts } from "./verdicts";
export type BrowserMarketUniverse = {
  source: "coingecko" | "coinmarketcap" | null; fetchedAt: string;
  assets: Array<{ provider: "coingecko" | "coinmarketcap"; providerAssetId: string; symbol: string; name: string; marketCap: number; marketCapRank: number }>;
  tokens: Record<number, AppToken[]>;
  failures: Array<{ provider: "coingecko" | "coinmarketcap" | "lifi"; chainId: number; reason: string }>;
  targetSize: number; fetchLimit: number;
  enriching?: boolean;
};
export type MarketUniverseState = { status: "idle" | "loading" | "ready" | "error"; result?: BrowserMarketUniverse; error?: string };
const EMPTY: MarketUniverseState = Object.freeze({ status: "idle" });
let snapshot = EMPTY; let pending: Promise<BrowserMarketUniverse> | undefined; let generation = 0;
const listeners = new Set<() => void>();
export const marketUniverseSnapshot = () => snapshot;
export const serverMarketUniverseSnapshot = () => EMPTY;
export function subscribeMarketUniverse(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(state: MarketUniverseState) { snapshot = Object.freeze(state); listeners.forEach(listener => listener()); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value); }
/** Validate display metadata; marketSource describes ranking provenance, never token trust. */
export function validateMarketUniverse(value: unknown): BrowserMarketUniverse {
  if (!record(value) || (value.source !== null && value.source !== "coingecko" && value.source !== "coinmarketcap") || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt)) ||
      !Number.isInteger(value.targetSize) || !Number.isInteger(value.fetchLimit) || Number(value.targetSize) < 1 || Number(value.fetchLimit) > 250 || Number(value.fetchLimit) < Number(value.targetSize) ||
      !Array.isArray(value.assets) || (value.source === null && value.assets.length !== 0) || value.assets.length > Number(value.fetchLimit) || !record(value.tokens) || !Array.isArray(value.failures) || value.failures.length > 4096 || (value.enriching !== undefined && typeof value.enriching !== "boolean")) throw new Error("invalid_market_universe");
  const seen = new Set<string>();
  const assets: BrowserMarketUniverse["assets"] = value.assets.map(asset => {
    if (!record(asset) || asset.provider !== value.source || !text(asset.providerAssetId, 128) || seen.has(asset.providerAssetId) || !text(asset.symbol, 64) || !text(asset.name, 128) ||
        typeof asset.marketCap !== "number" || !Number.isFinite(asset.marketCap) || asset.marketCap < 0 || !Number.isSafeInteger(asset.marketCapRank) || Number(asset.marketCapRank) < 1) throw new Error("invalid_market_universe");
    seen.add(asset.providerAssetId); return { provider: value.source as Exclude<BrowserMarketUniverse["source"], null>, providerAssetId: asset.providerAssetId, symbol: asset.symbol, name: asset.name, marketCap: asset.marketCap, marketCapRank: Number(asset.marketCapRank) };
  });
  const tokens: Record<number, AppToken[]> = {};
  for (const chainId of APP_CHAIN_IDS) {
    const rows = value.tokens[chainId]; if (!Array.isArray(rows) || rows.length > 350) throw new Error("invalid_market_universe");
    tokens[chainId] = rows.map(raw => {
      const token = validateToken(raw, chainId); if (!token || !record(raw)) throw new Error("invalid_market_universe");
      // Generic token validation copies provider metrics for discovery. Preserve only the selected market source.
      delete token.marketCapUSD; delete token.volumeUSD24H;
      if (value.source !== null && raw.marketSource === value.source && typeof raw.marketCapUSD === "number" && Number.isFinite(raw.marketCapUSD) && raw.marketCapUSD >= 0) { token.marketCapUSD = raw.marketCapUSD; token.marketSource = value.source as Exclude<BrowserMarketUniverse["source"], null>; }
      return token;
    });
  }
  const failures = value.failures.map(failure => {
    if (!record(failure) || !["coingecko", "coinmarketcap", "lifi"].includes(String(failure.provider)) || !Number.isInteger(failure.chainId) || !text(failure.reason, 128) || !/^[a-z_]+$/.test(failure.reason)) throw new Error("invalid_market_universe");
    return { provider: failure.provider as BrowserMarketUniverse["failures"][number]["provider"], chainId: Number(failure.chainId), reason: failure.reason };
  });
  return { source: value.source, fetchedAt: value.fetchedAt, assets, tokens, failures, targetSize: Number(value.targetSize), fetchLimit: Number(value.fetchLimit), ...(typeof value.enriching === "boolean" ? { enriching: value.enriching } : {}) };
}
export async function fetchMarketUniverse(): Promise<BrowserMarketUniverse> {
  if (snapshot.status === "ready" && snapshot.result && !snapshot.result.enriching && Date.now() - Date.parse(snapshot.result.fetchedAt) < 60_000) return snapshot.result;
  if (pending) return pending;
  const current = generation; publish({ status: "loading", result: snapshot.result });
  const request = (async () => {
    try {
      const response = await fetch("/api/tokens/universe", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : "market_universe_unavailable");
      const limit = 4 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit || !response.body) { await response.body?.cancel(); throw new Error("invalid_market_universe"); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0; let body = "";
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error("invalid_market_universe"); } body += decoder.decode(value, { stream: true }); }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
      const result = validateMarketUniverse(JSON.parse(body));
      if (current === generation) { rememberTokenVerdicts(Object.values(result.tokens).flat()); publish({ status: "ready", result }); }
      return result;
    } catch (error) { if (current === generation) publish({ status: "error", result: snapshot.result, error: error instanceof Error && ["rate_limited", "invalid_market_universe"].includes(error.message) ? error.message : "market_universe_unavailable" }); throw error; }
    finally { if (current === generation) pending = undefined; }
  })(); pending = request; return request;
}
export function resetMarketUniverseForTests() {
  if (process.env.NODE_ENV !== "test") throw new Error("test_only"); generation++; pending = undefined; snapshot = EMPTY; listeners.forEach(listener => listener());
}

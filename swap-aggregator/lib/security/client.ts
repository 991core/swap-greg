import type { AppToken } from "../tokens/types";
import { lookupTrustedToken, validateTrustedRegistry } from "./identity";
import type { TrustedRegistryDocument } from "./types";
import type { SecuritySwapIntent } from "./quote-validator";
import type { TransactionAuthorizer } from "./transaction-validator";

export type RegistryState = { status: "loading" | "ready" | "error"; registry?: TrustedRegistryDocument; executionConfigured?: boolean };
const EMPTY: RegistryState = Object.freeze({ status: "loading" });
let snapshot = EMPTY;
let pending: Promise<RegistryState> | undefined;
const listeners = new Set<() => void>();
export const registrySnapshot = () => snapshot;
export const serverRegistrySnapshot = () => EMPTY;
export function subscribeRegistry(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function isRegistryToken(state: RegistryState, token: AppToken | null): boolean {
  if (!token || state.status !== "ready" || !state.registry) return false;
  try { const entry = lookupTrustedToken(state.registry, token.chainId, token.address); return entry?.status === "trusted" && entry.decimals === token.decimals; } catch { return false; }
}
export async function preloadTrustedRegistry(): Promise<RegistryState> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch("/api/security/registry", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("REGISTRY_UNAVAILABLE");
      const data = await response.json();
      snapshot = Object.freeze({ status: "ready", registry: validateTrustedRegistry(data.registry), executionConfigured: data.executionConfigured === true });
    } catch { snapshot = Object.freeze({ status: "error" }); }
    listeners.forEach(listener => listener());
    return snapshot;
  })().finally(() => { pending = undefined; });
  return pending;
}
async function authorize(body: unknown): Promise<void> {
  const response = await fetch("/api/security/validate", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SECURITY_VALIDATION_UNAVAILABLE");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8192) { await reader.cancel(); throw new Error("SECURITY_VALIDATION_UNAVAILABLE"); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  let data: { error?: unknown; authorized?: unknown; registryVersion?: unknown };
  try { data = JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new Error("SECURITY_VALIDATION_UNAVAILABLE"); }
  if (!response.ok) throw new Error(typeof data?.error === "string" && /^[A-Z_]{1,80}$/.test(data.error) ? data.error : "SECURITY_VALIDATION_UNAVAILABLE");
  if (!data || data.authorized !== true || !Number.isSafeInteger(data.registryVersion) || Number(data.registryVersion) < 1) throw new Error("SECURITY_VALIDATION_UNAVAILABLE");
}
export function authorizeSwapIntent(intent: SecuritySwapIntent, quote: SecuritySwapIntent): Promise<void> { return authorize({ mode: "quote", intent, quote }); }
export function createTransactionAuthorizer(original: SecuritySwapIntent): TransactionAuthorizer {
  const intent = Object.freeze({ ...original });
  return async (candidate, context) => { await authorize({ mode: "transaction", intent, candidate, context }); };
}
export function resetRegistryForTests() {
  if (process.env.NODE_ENV !== "test") throw new Error("test_only");
  snapshot = EMPTY; pending = undefined; listeners.forEach(listener => listener());
}

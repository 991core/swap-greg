import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readSecurityConfig } from "./config.server";
import { isSafeSecurityText, isSupportedSecurityChain, isValidSecurityDate } from "./identity";
import { atomicWriteSecurityJson, readSecurityJson, readTrustedRegistry, withSecurityFileLock } from "./registry.server";
import { SECURITY_EVENT_TYPES, TOKEN_PROVIDERS, type SecurityEvent, type SecurityEventDocument, type TokenAddressConflictLog, type TokenProvider } from "./types";

function validAddress(value: unknown) {
  if (value === null) return;
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value) || /^0x0{40}$/.test(value) || /^0xe{40}$/.test(value)) throw new Error("INVALID_SECURITY_EVENT_ADDRESS");
}
/** Reconstructs an allowlisted structured event; raw responses, errors and credentials are never copied. */
export function validateSecurityEvent(value: unknown): SecurityEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SECURITY_EVENT");
  const input = value as SecurityEvent;
  if (!(SECURITY_EVENT_TYPES as readonly string[]).includes(input.event) || !isSafeSecurityText(input.assetId) || !isSupportedSecurityChain(input.chainId) || !isValidSecurityDate(input.detectedAt) || !["warning", "high", "critical"].includes(input.severity) || !["allowed_with_warning", "manual_review", "blocked"].includes(input.action)) throw new Error("INVALID_SECURITY_EVENT");
  const event: SecurityEvent = { event: input.event, assetId: input.assetId, chainId: input.chainId, severity: input.severity, action: input.action, detectedAt: input.detectedAt };
  for (const key of ["registryAddress", "consensusAddress", "oldAddress", "newAddress"] as const) {
    if (input[key] !== undefined) { validAddress(input[key]); event[key] = input[key]; }
  }
  if (input.symbol !== undefined) { if (!isSafeSecurityText(input.symbol, 64)) throw new Error("INVALID_SECURITY_EVENT_SYMBOL"); event.symbol = input.symbol; }
  if (input.correlationId !== undefined) { if (!isSafeSecurityText(input.correlationId)) throw new Error("INVALID_SECURITY_EVENT_CORRELATION"); event.correlationId = input.correlationId; }
  if (input.providers !== undefined) {
    if (!input.providers || typeof input.providers !== "object" || Array.isArray(input.providers) || Object.keys(input.providers).some((key) => !(TOKEN_PROVIDERS as readonly string[]).includes(key))) throw new Error("INVALID_SECURITY_EVENT_PROVIDERS");
    event.providers = {};
    for (const provider of TOKEN_PROVIDERS) {
      const source = input.providers[provider]; if (!source) continue;
      validAddress(source.address);
      if (!isValidSecurityDate(source.fetchedAt)) throw new Error("INVALID_SECURITY_EVENT_PROVIDER_DATE");
      if (source.independent !== undefined && typeof source.independent !== "boolean") throw new Error("INVALID_SECURITY_SOURCE_PROVENANCE");
      event.providers[provider] = { address: source.address, fetchedAt: source.fetchedAt, ...(source.independent !== undefined ? { independent: source.independent } : {}) };
    }
  }
  if (input.divergentProviders !== undefined) {
    if (!Array.isArray(input.divergentProviders) || new Set(input.divergentProviders).size !== input.divergentProviders.length || input.divergentProviders.some((provider) => !(TOKEN_PROVIDERS as readonly string[]).includes(provider))) throw new Error("INVALID_DIVERGENT_PROVIDERS");
    event.divergentProviders = [...input.divergentProviders];
  }
  if (input.details) {
    event.details = {};
    // Only bounded diagnostic codes and primitive quantities, never arbitrary messages/URLs or key fields.
    for (const [key, value] of Object.entries(input.details)) {
      if (!/^(reason|provider|field|expectedChainId|actualChainId|count)$/.test(key)) continue;
      if (typeof value === "string") event.details[key] = /^[a-zA-Z0-9_.: -]{1,160}$/.test(value) && !/secret|password|bearer|api.?key|authorization|credential/i.test(value) ? value : "redacted";
      else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) event.details[key] = value;
    }
  }
  if (event.event === "TOKEN_ADDRESS_CONFLICT" || event.event === "TOKEN_CONTRACT_CHANGED") {
    if (!event.providers || Object.keys(event.providers).length < 1 || !event.divergentProviders?.length || event.divergentProviders.some((provider) => !event.providers![provider])) throw new Error("INVALID_TOKEN_CONFLICT_EVENT");
  }
  return event;
}
function conflictKey(event: SecurityEvent): string {
  const addresses = TOKEN_PROVIDERS.map((provider) => [provider, event.providers?.[provider]?.address === null ? "native" : event.providers?.[provider]?.address ?? "unavailable"]);
  return createHash("sha256").update(JSON.stringify([event.assetId, event.chainId, addresses])).digest("hex");
}
function validateStore(value: unknown): SecurityEventDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SECURITY_JOURNAL");
  const doc = value as SecurityEventDocument;
  if (doc.schemaVersion !== 1 || !Number.isSafeInteger(doc.version) || doc.version < 0 || !Array.isArray(doc.conflicts) || !Array.isArray(doc.events) || doc.conflicts.length > 10000 || doc.events.length > 20000) throw new Error("INVALID_SECURITY_JOURNAL");
  const ids = new Set<string>(); const openKeys = new Set<string>();
  for (const conflict of doc.conflicts) {
    validateSecurityEvent(conflict);
    if (!["TOKEN_ADDRESS_CONFLICT", "TOKEN_CONTRACT_CHANGED"].includes(conflict.event) || !isSafeSecurityText(conflict.conflictId) || ids.has(conflict.conflictId) || conflict.deduplicationKey !== conflictKey(conflict) || !["open", "resolved"].includes(conflict.status) || !Number.isSafeInteger(conflict.occurrenceCount) || conflict.occurrenceCount < 1 || !isValidSecurityDate(conflict.firstSeenAt) || !isValidSecurityDate(conflict.lastSeenAt) || Date.parse(conflict.firstSeenAt) > Date.parse(conflict.lastSeenAt)) throw new Error("INVALID_SECURITY_CONFLICT_RECORD");
    if (conflict.status === "resolved" && (!isValidSecurityDate(conflict.resolvedAt) || !["provider_returned_to_consensus", "manual_review"].includes(conflict.resolution ?? ""))) throw new Error("INVALID_SECURITY_CONFLICT_RESOLUTION");
    const openKey = `${conflict.event}:${conflict.deduplicationKey}`;
    if (conflict.status === "open" && openKeys.has(openKey)) throw new Error("DUPLICATE_OPEN_SECURITY_CONFLICT");
    if (conflict.status === "open") openKeys.add(openKey);
    ids.add(conflict.conflictId);
  }
  for (const event of doc.events) {
    validateSecurityEvent(event);
    if (!isSafeSecurityText(event.eventId) || ids.has(event.eventId)) throw new Error("INVALID_SECURITY_EVENT_ID");
    ids.add(event.eventId);
  }
  return doc;
}
async function loadUnlocked(file: string): Promise<SecurityEventDocument> {
  const stored = await readSecurityJson(file);
  return stored === undefined ? { schemaVersion: 1, version: 0, conflicts: [], events: [] } : validateStore(stored);
}
function canResolve(event: SecurityEvent, registry: Awaited<ReturnType<typeof readTrustedRegistry>>): boolean {
  const entry = registry.entries.find((item) => item.assetId === event.assetId && item.chainId === event.chainId && item.status === "trusted");
  if (!entry || event.consensusAddress !== entry.address || event.registryAddress !== entry.address) return false;
  return TOKEN_PROVIDERS.every((provider) => event.providers?.[provider]?.address === entry.address && event.providers?.[provider]?.independent === true);
}
/** Durability is awaited by callers before permitting execution; failure rejects instead of dropping evidence. */
export async function recordSecurityEvents(events: readonly SecurityEvent[]): Promise<void> {
  if (!events.length) return;
  if (events.length > 100) throw new Error("SECURITY_EVENT_BATCH_TOO_LARGE");
  const normalized = events.map(validateSecurityEvent);
  const registry = normalized.some((event) => event.event === "TOKEN_CONSENSUS_RESTORED") ? await readTrustedRegistry() : undefined;
  const file = readSecurityConfig().conflictLogPath;
  await withSecurityFileLock(file, async () => {
    const doc = await loadUnlocked(file);
    let changed = false;
    for (const event of normalized) {
      if (event.event === "TOKEN_CONSENSUS_RESTORED") {
        if (!registry || !canResolve(event, registry)) throw new Error("UNTRUSTED_CONFLICT_RESOLUTION");
        for (const conflict of doc.conflicts) if (conflict.assetId === event.assetId && conflict.chainId === event.chainId && conflict.status === "open" && Date.parse(event.detectedAt) >= Date.parse(conflict.lastSeenAt) && TOKEN_PROVIDERS.every((provider) => Date.parse(event.providers![provider]!.fetchedAt) >= Date.parse(conflict.lastSeenAt))) {
          conflict.status = "resolved"; conflict.resolvedAt = event.detectedAt; conflict.resolution = "provider_returned_to_consensus"; changed = true;
        }
        continue;
      }
      if (event.event === "TOKEN_ADDRESS_CONFLICT" || event.event === "TOKEN_CONTRACT_CHANGED") {
        const key = conflictKey(event);
        const existing = doc.conflicts.find((conflict) => conflict.event === event.event && conflict.deduplicationKey === key && conflict.status === "open");
        if (existing) {
          existing.occurrenceCount++;
          if (Date.parse(event.detectedAt) > Date.parse(existing.lastSeenAt)) existing.lastSeenAt = event.detectedAt;
          existing.providers = event.providers;
          if (event.severity === "critical" || existing.severity !== "critical") { existing.severity = event.severity; existing.action = event.action; existing.divergentProviders = event.divergentProviders; }
        } else doc.conflicts.push({ ...event, event: event.event, conflictId: `conf_${randomUUID()}`, deduplicationKey: key, status: "open", firstSeenAt: event.detectedAt, lastSeenAt: event.detectedAt, occurrenceCount: 1 });
      } else doc.events.push({ ...event, eventId: `evt_${randomUUID()}` });
      changed = true;
    }
    if (!changed) return;
    doc.version++;
    validateStore(doc);
    await atomicWriteSecurityJson(file, doc);
  });
}
export async function listTokenConflicts(): Promise<TokenAddressConflictLog[]> {
  const file = readSecurityConfig().conflictLogPath;
  return withSecurityFileLock(file, async () => (await loadUnlocked(file)).conflicts);
}
export async function listSecurityEvents(): Promise<SecurityEventDocument> {
  const file = readSecurityConfig().conflictLogPath;
  return withSecurityFileLock(file, () => loadUnlocked(file));
}
export const writeSecurityEvents = recordSecurityEvents;
export const readSecurityEvents = listSecurityEvents;
export async function getSecurityMetrics() {
  const doc = await listSecurityEvents();
  const tokenAddressConflictsTotal = Object.fromEntries(TOKEN_PROVIDERS.map((provider) => [provider, doc.conflicts.filter((conflict) => conflict.event === "TOKEN_ADDRESS_CONFLICT" && conflict.divergentProviders?.includes(provider)).reduce((sum, conflict) => sum + conflict.occurrenceCount, 0)])) as Record<TokenProvider, number>;
  return { tokenAddressConflictsTotal, openTokenConflicts: doc.conflicts.filter((entry) => entry.status === "open").length,
    criticalTokenConflicts: doc.conflicts.filter((entry) => entry.status === "open" && entry.severity === "critical").length,
    providerFailures: doc.events.filter((event) => event.event === "TOKEN_PROVIDER_UNAVAILABLE").length,
    blockedSwapsDueToTokenValidation: doc.events.filter((event) => event.action === "blocked").length };
}

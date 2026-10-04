import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTrustedRegistry } from "../lib/security/registry.server";
import { getSecurityMetrics, listSecurityEvents, listTokenConflicts, recordSecurityEvents } from "../lib/security/events.server";
import { verifyTokenConsensus } from "../lib/security/consensus";
import { TOKEN_PROVIDERS, type SecurityEvent, type TrustedTokenEntry } from "../lib/security/types";

let directory: string; let eventFile: string; let registry: TrustedTokenEntry;
const B = "0x" + "b".repeat(40); const C = "0x" + "c".repeat(40);
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-events-")); eventFile = path.join(directory, "events.json"); vi.stubEnv("TOKEN_REGISTRY_PATH", path.join(directory, "registry.json")); vi.stubEnv("TOKEN_CONFLICT_LOG_PATH", eventFile); registry = (await readTrustedRegistry()).entries.find((entry) => entry.chainId === 1 && entry.symbol === "USDC")!; });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });
function consensus(last: string, time = "2026-10-02T12:00:00.000Z") {
  return verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, detectedAt: time,
    results: [registry.address!, registry.address!, last].map((address, index) => ({ provider: TOKEN_PROVIDERS[index], chainId: 1, tokenType: "contract", address, fetchedAt: time, lookupMode: "asset-id" })) });
}
describe("durable token conflict evidence", () => {
  it("deduplicates50 concurrent polls, preserving first/last and provider attribution", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, index) => recordSecurityEvents(consensus(B, new Date(Date.parse("2026-10-02T12:00:00.000Z") + index * 1000).toISOString()).events)));
    const conflicts = await listTokenConflicts(); expect(conflicts).toHaveLength(1); expect(conflicts[0]).toMatchObject({ status: "open", occurrenceCount: 50, firstSeenAt: "2026-10-02T12:00:00.000Z", lastSeenAt: "2026-10-02T12:00:49.000Z", divergentProviders: ["lifi"] });
    expect((await getSecurityMetrics()).tokenAddressConflictsTotal.lifi).toBe(50);
  });
  it("changed provider addresses create new conflicts and restart preserves both", async () => {
    await recordSecurityEvents(consensus(B).events); await recordSecurityEvents(consensus(C).events);
    vi.resetModules(); const restarted = await import("../lib/security/events.server"); const persisted = await restarted.listTokenConflicts(); expect(persisted).toHaveLength(2); expect(persisted.map((record) => record.providers?.lifi?.address)).toEqual([B, C]);
  });
  it("full independent return to trusted A resolves, retains history, and recurrence opens anew", async () => {
    await recordSecurityEvents(consensus(B).events); await recordSecurityEvents(consensus(registry.address!, "2026-10-02T12:05:00.000Z").events);
    expect((await listTokenConflicts())[0]).toMatchObject({ status: "resolved", resolvedAt: "2026-10-02T12:05:00.000Z", resolution: "provider_returned_to_consensus" });
    await recordSecurityEvents(consensus(B, "2026-10-02T12:06:00.000Z").events); const records = await listTokenConflicts(); expect(records).toHaveLength(2); expect(records[0].status).toBe("resolved"); expect(records[1].status).toBe("open");
  });
  it("absence/candidate-bound resolution never erases an open conflict", async () => {
    await recordSecurityEvents(consensus(B).events); const restored = consensus(registry.address!).events[0];
    expect(restored.event).toBe("TOKEN_CONSENSUS_RESTORED"); restored.providers!.lifi!.independent = false;
    await expect(recordSecurityEvents([restored])).rejects.toThrow("UNTRUSTED_CONFLICT_RESOLUTION"); expect((await listTokenConflicts())[0].status).toBe("open");
  });
  it("late restored responses cannot resolve newer conflicts", async () => {
    await recordSecurityEvents(consensus(B, "2026-10-02T12:05:00.000Z").events);
    await recordSecurityEvents(consensus(registry.address!, "2026-10-02T12:00:00.000Z").events);
    expect((await listTokenConflicts())[0].status).toBe("open");
  });
  it("a fake 3/3 majority persists both address-conflict and contract-change evidence", async () => {
    const value = verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: TOKEN_PROVIDERS.map((provider) => ({ provider, chainId: 1, tokenType: "contract", address: B, fetchedAt: "2026-10-02T12:00:00.000Z" })) });
    await recordSecurityEvents(value.events); const conflicts = await listTokenConflicts(); expect(conflicts.map((record) => record.event)).toEqual(["TOKEN_ADDRESS_CONFLICT", "TOKEN_CONTRACT_CHANGED"]); expect(conflicts.every((record) => record.severity === "critical")).toBe(true);
  });
  it("persists structured validation events while redacting raw key fields and messages", async () => {
    const event: SecurityEvent = { event: "QUOTE_VALIDATION_FAILED", assetId: registry.assetId, chainId: 1, severity: "critical", action: "blocked", detectedAt: "2026-10-02T12:00:00.000Z", details: { reason: "Bearer secret-api-key", apiKey: "must-not-store", rawResponse: "must-not-store" } };
    await recordSecurityEvents([event]); const body = await fs.readFile(eventFile, "utf8"); expect(body).not.toContain("must-not-store"); expect(body).not.toContain("secret-api-key"); expect((await listSecurityEvents()).events[0].details).toEqual({ reason: "redacted" });
  });
  it("storage/schema failure rejects logging and reading rather than dropping evidence", async () => {
    await fs.writeFile(eventFile, "broken"); await expect(recordSecurityEvents(consensus(B).events)).rejects.toThrow("SECURITY_STORAGE_READ_FAILED"); await expect(listTokenConflicts()).rejects.toThrow();
    await fs.writeFile(eventFile, JSON.stringify({ schemaVersion: 2, version: 1, conflicts: [], events: [] })); await expect(listTokenConflicts()).rejects.toThrow("INVALID_SECURITY_JOURNAL");
  });
  it("missing attributed provider evidence cannot be persisted", async () => {
    const conflict = consensus(B).events.find((event) => event.event === "TOKEN_ADDRESS_CONFLICT")!;
    delete conflict.providers!.lifi;
    await expect(recordSecurityEvents([conflict])).rejects.toThrow("INVALID_TOKEN_CONFLICT_EVENT");
    expect(await listTokenConflicts()).toEqual([]);
  });
});

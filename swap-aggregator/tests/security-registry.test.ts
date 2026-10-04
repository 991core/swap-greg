import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyRegistryChange, readTrustedRegistry } from "../lib/security/registry.server";
import { lookupTrustedToken, validateTrustedRegistry } from "../lib/security/identity";
import { readSecurityConfig } from "../lib/security/config.server";
import { getPopularTokens } from "../lib/tokens/catalog";
import { APP_CHAIN_IDS } from "../lib/chains";
import type { RegistryApproval, TrustedTokenEntry } from "../lib/security/types";

let directory: string; let registryFile: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-registry-")); registryFile = path.join(directory, "registry.json"); vi.stubEnv("TOKEN_REGISTRY_PATH", registryFile); vi.stubEnv("TOKEN_CONFLICT_LOG_PATH", path.join(directory, "events.json")); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });
const B = "0x" + "b".repeat(40);
function approval(entry: TrustedTokenEntry, version: number, operation: RegistryApproval["operation"] = "migrate"): RegistryApproval {
  return { operation, assetId: entry.assetId, chainId: entry.chainId, oldAddress: entry.address, newAddress: operation === "migrate" ? B : entry.address,
    reason: "Reviewed migration", externalEvidence: ["https://issuer.example/migration"], approvedBy: "operator-review", approvedAt: "2026-10-02T12:00:00.000Z", expectedVersion: version };
}
describe("durable reviewed token registry", () => {
  it("bootstraps exactly all39 catalog identities once, with natives separate", async () => {
    const doc = await readTrustedRegistry(); expect(doc.entries).toHaveLength(39); expect(doc.entries.filter((entry) => entry.type === "native")).toHaveLength(9);
    for (const chainId of APP_CHAIN_IDS) for (const token of getPopularTokens(chainId)) {
      expect(lookupTrustedToken(doc, chainId, token.address)).toMatchObject({ chainId, decimals: token.decimals, symbol: token.symbol, status: "trusted" });
    }
    const persisted = await fs.readFile(registryFile, "utf8"); await readTrustedRegistry(); expect(await fs.readFile(registryFile, "utf8")).toBe(persisted);
    expect(doc.entries.every((entry) => !entry.providerAssetIds)).toBe(true);
  });
  it("approved migration increments version and survives module/process state reset", async () => {
    const doc = await readTrustedRegistry(); const entry = doc.entries.find((item) => item.chainId === 1 && item.symbol === "USDC")!;
    const next = await applyRegistryChange(approval(entry, doc.version)); expect(next.version).toBe(2); expect(next.history).toHaveLength(1);
    vi.resetModules(); const restarted = await import("../lib/security/registry.server"); const loaded = await restarted.readTrustedRegistry();
    expect(loaded).toEqual(next); expect(lookupTrustedToken(loaded, 1, entry.address)).toBeNull(); expect(lookupTrustedToken(loaded, 1, B)?.assetId).toBe(entry.assetId);
  });
  it("explicit onboarding, disabling and resolving preserve audited versions", async () => {
    const doc = await readTrustedRegistry(); const base = doc.entries.find((item) => item.type === "erc20")!;
    const request = { ...approval(base, 1, "onboard"), assetId: "reviewed:new-token", oldAddress: null, newAddress: B, entry: { ...base, assetId: "reviewed:new-token", address: B } };
    const added = await applyRegistryChange(request); expect(added.entries).toHaveLength(40);
    const entry = added.entries.find((item) => item.assetId === request.assetId)!;
    const disabled = await applyRegistryChange(approval(entry, 2, "disable")); expect(lookupTrustedToken(disabled, entry.chainId, B)?.status).toBe("disabled");
    const resolved = await applyRegistryChange(approval(lookupTrustedToken(disabled, entry.chainId, B)!, 3, "resolve")); expect(lookupTrustedToken(resolved, entry.chainId, B)?.status).toBe("trusted"); expect(resolved.history).toHaveLength(3);
  });
  it("serializes competing admin versions: only one change may commit", async () => {
    const doc = await readTrustedRegistry(); const entry = doc.entries.find((item) => item.type === "erc20")!;
    const changes = await Promise.allSettled([applyRegistryChange(approval(entry, 1)), applyRegistryChange(approval(entry, 1))]);
    expect(changes.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect((await readTrustedRegistry()).version).toBe(2);
  });
  it("rejects unreviewed address mutations and corrupt persisted JSON without rebootstrap", async () => {
    const doc = await readTrustedRegistry(); doc.entries[0].decimals = 7; await fs.writeFile(registryFile, JSON.stringify(doc));
    await expect(readTrustedRegistry()).rejects.toThrow("REGISTRY_CONTENT_TAMPERED");
    await fs.writeFile(registryFile, "corrupt"); await expect(readTrustedRegistry()).rejects.toThrow("SECURITY_STORAGE_READ_FAILED"); expect(await fs.readFile(registryFile, "utf8")).toBe("corrupt");
  });
  it("rejects wrong-chain, malformed-address and duplicate schema entries", async () => {
    const doc = await readTrustedRegistry();
    expect(() => validateTrustedRegistry({ ...doc, entries: [{ ...doc.entries[0], chainId: 999 }] })).toThrow();
    const erc20 = doc.entries.find((entry) => entry.type === "erc20")!;
    expect(() => validateTrustedRegistry({ ...doc, entries: [{ ...erc20, address: "0x123" }] })).toThrow();
    expect(() => validateTrustedRegistry({ ...doc, entries: [...doc.entries, { ...erc20, assetId: "duplicate" }] })).toThrow("DUPLICATE_REGISTRY_IDENTITY");
  });
  it("requires explicit approval metadata, expected version and correct old address", async () => {
    const doc = await readTrustedRegistry(); const entry = doc.entries.find((item) => item.type === "erc20")!;
    await expect(applyRegistryChange({ ...approval(entry, 1), approvedBy: "" })).rejects.toThrow("INVALID_REGISTRY_APPROVAL");
    await expect(applyRegistryChange({ ...approval(entry, 1), oldAddress: B })).rejects.toThrow("REGISTRY_OLD_ADDRESS_MISMATCH");
    await expect(applyRegistryChange({ ...approval(entry, 1, "disable"), newAddress: B })).rejects.toThrow("UNAUTHORIZED_REGISTRY_IDENTITY_CHANGE");
    expect((await readTrustedRegistry()).version).toBe(1);
  });
  it("unavailable writable storage fails closed", async () => {
    await fs.writeFile(path.join(directory, "not-a-directory"), "x"); vi.stubEnv("TOKEN_REGISTRY_PATH", path.join(directory, "not-a-directory", "registry.json"));
    await expect(readTrustedRegistry()).rejects.toThrow();
  });
  it("configuration is bounded, excludes keys, and has explicit empty target policies", () => {
    const config = readSecurityConfig({ COINGECKO_API_KEY: "private" }); expect(JSON.stringify(config)).not.toContain("private"); expect(config.lifiAllowedContracts).toEqual([]); expect(config.allowedDepositReceivers).toEqual([]);
    expect(() => readSecurityConfig({ MAX_SLIPPAGE_BPS: "10001" })).toThrow();
    expect(() => readSecurityConfig({ SUPPORTED_CHAIN_IDS: "[1,999]" })).toThrow();
    expect(() => readSecurityConfig({ LIFI_ALLOWED_CONTRACTS: JSON.stringify([{ chainId: 1, address: B }]) })).toThrow();
    expect(() => readSecurityConfig({ TOP_ASSET_FETCH_LIMIT: "99" })).toThrow();
  });
});

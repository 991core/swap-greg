import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import seed from "../../security/trusted-tokens.v1.json";
import { readSecurityConfig } from "./config.server";
import { getTrustedToken, validateRegistryRevision, validateTrustedRegistry, validateTrustedTokenEntry } from "./identity";
import type { RegistryApproval, RegistryRevision, TrustedRegistryDocument, TrustedTokenEntry } from "./types";
export { getTrustedToken, lookupTrustedToken, validateTrustedRegistry } from "./identity";

const queues = new Map<string, Promise<unknown>>();
const MAX_STORE_BYTES = 8 * 1024 * 1024;
function errorCode(error: unknown) { return (error as NodeJS.ErrnoException)?.code; }
/** Serializes this process and uses an exclusive filesystem lock across local processes. Stale locks fail closed. */
export async function withSecurityFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { lock = await fs.open(`${file}.lock`, "wx", 0o600); break; }
      catch (error) { if (errorCode(error) !== "EEXIST") throw new Error("SECURITY_STORAGE_LOCK_FAILED"); await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    if (!lock) throw new Error("SECURITY_STORAGE_LOCKED");
    try { return await task(); }
    finally { await lock.close(); await fs.unlink(`${file}.lock`); }
  });
  queues.set(file, current);
  try { return await current; } finally { if (queues.get(file) === current) queues.delete(file); }
}
export async function atomicWriteSecurityJson(file: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(body) > MAX_STORE_BYTES) throw new Error("SECURITY_STORAGE_FULL");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { throw new Error("SECURITY_STORAGE_WRITE_FAILED"); }
  finally { await fs.unlink(temporary).catch(() => undefined); }
}
export async function readSecurityJson(file: string): Promise<unknown | undefined> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORE_BYTES) throw new Error("INVALID_SECURITY_STORAGE");
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) { if (errorCode(error) === "ENOENT") return undefined; throw new Error("SECURITY_STORAGE_READ_FAILED"); }
}
function initialRegistry(): TrustedRegistryDocument { return validateTrustedRegistry(structuredClone(seed)); }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function applyRevision(entries: TrustedTokenEntry[], revision: RegistryRevision): TrustedTokenEntry[] {
  validateRegistryRevision(revision);
  const old = getTrustedToken({ entries }, revision.assetId, revision.chainId);
  if (!same(old, revision.previousEntry)) throw new Error("REGISTRY_HISTORY_TAMPERED");
  if (revision.operation === "onboard" ? old !== null : old === null) throw new Error("INVALID_REGISTRY_OPERATION");
  if (old && revision.operation !== "migrate" && (revision.nextEntry.address !== old.address || revision.nextEntry.type !== old.type || revision.nextEntry.decimals !== old.decimals || revision.nextEntry.symbol !== old.symbol || !same(revision.nextEntry.providerAssetIds, old.providerAssetIds))) throw new Error("UNAUTHORIZED_REGISTRY_IDENTITY_CHANGE");
  if (revision.operation === "disable" && revision.nextEntry.status !== "disabled") throw new Error("INVALID_REGISTRY_STATUS");
  if ((revision.operation === "onboard" || revision.operation === "migrate" || revision.operation === "resolve") && revision.nextEntry.status !== "trusted") throw new Error("INVALID_REGISTRY_STATUS");
  return [...entries.filter((entry) => !(entry.assetId === revision.assetId && entry.chainId === revision.chainId)), revision.nextEntry];
}
function verifyRegistryHistory(value: unknown): TrustedRegistryDocument {
  const doc = validateTrustedRegistry(value);
  let entries = initialRegistry().entries;
  for (const revision of doc.history) entries = applyRevision(entries, revision);
  const order = (items: TrustedTokenEntry[]) => [...items].sort((a, b) => `${a.assetId}:${a.chainId}`.localeCompare(`${b.assetId}:${b.chainId}`));
  if (!same(order(entries), order(doc.entries))) throw new Error("REGISTRY_CONTENT_TAMPERED");
  return doc;
}
async function loadUnlocked(file: string): Promise<TrustedRegistryDocument> {
  const stored = await readSecurityJson(file);
  if (stored !== undefined) return verifyRegistryHistory(stored);
  const initial = initialRegistry();
  await atomicWriteSecurityJson(file, initial);
  return initial;
}
/** Bootstraps the reviewed seed once, then only reads approved persisted revisions. */
export async function readTrustedRegistry(): Promise<TrustedRegistryDocument> {
  const file = readSecurityConfig().registryPath;
  return withSecurityFileLock(file, () => loadUnlocked(file));
}
/** Admin-only workflow. No provider or consensus service calls this mutation. */
export async function applyRegistryChange(approval: RegistryApproval): Promise<TrustedRegistryDocument> {
  const file = readSecurityConfig().registryPath;
  return withSecurityFileLock(file, async () => {
    const doc = await loadUnlocked(file);
    if (approval.expectedVersion !== doc.version) throw new Error("REGISTRY_VERSION_CONFLICT");
    const previousEntry = getTrustedToken(doc, approval.assetId, approval.chainId);
    if ((previousEntry?.address ?? null) !== approval.oldAddress) throw new Error("REGISTRY_OLD_ADDRESS_MISMATCH");
    if (approval.operation === "onboard" && previousEntry) throw new Error("REGISTRY_ALREADY_EXISTS");
    if (approval.operation !== "onboard" && !previousEntry) throw new Error("REGISTRY_ENTRY_MISSING");
    const supplied = approval.entry ?? previousEntry;
    if (!supplied) throw new Error("REGISTRY_ENTRY_REQUIRED");
    const nextEntry = validateTrustedTokenEntry({ ...supplied, assetId: approval.assetId, chainId: approval.chainId, address: approval.newAddress,
      status: approval.operation === "disable" ? "disabled" : "trusted", version: doc.version + 1,
      firstVerifiedAt: previousEntry?.firstVerifiedAt ?? approval.approvedAt, lastVerifiedAt: approval.approvedAt,
    });
    const { expectedVersion: _expectedVersion, entry: _entry, ...metadata } = approval;
    const revision: RegistryRevision = { ...metadata, version: doc.version + 1, previousEntry, nextEntry };
    const next = validateTrustedRegistry({ ...doc, version: doc.version + 1, entries: applyRevision(doc.entries, revision), history: [...doc.history, revision] });
    verifyRegistryHistory(next);
    await atomicWriteSecurityJson(file, next);
    return next;
  });
}

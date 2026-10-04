export const SUPPORTED_SECURITY_CHAIN_IDS = [8453, 1, 42161, 10, 137, 56, 43114, 100, 1088] as const;
export const NATIVE_SENTINELS = ["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"] as const;

export function isSupportedSecurityChain(chainId: unknown): chainId is number {
  return typeof chainId === "number" && Number.isSafeInteger(chainId) && (SUPPORTED_SECURITY_CHAIN_IDS as readonly number[]).includes(chainId);
}
export function normalizeEvmAddress(address: unknown): string {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("INVALID_EVM_ADDRESS");
  return address.toLowerCase();
}
export function normalizeTokenIdentity(chainId: number, type: "native" | "erc20" | "contract", address: string | null) {
  if (!isSupportedSecurityChain(chainId)) throw new Error("UNSUPPORTED_SECURITY_CHAIN");
  if (!["native", "erc20", "contract"].includes(type)) throw new Error("INVALID_TOKEN_TYPE");
  const normalized = address === null ? null : normalizeEvmAddress(address);
  const sentinel = normalized !== null && (NATIVE_SENTINELS as readonly string[]).includes(normalized);
  if (type === "native" && normalized !== null && !sentinel) throw new Error("NATIVE_CONTRACT_ADDRESS");
  if (normalized === null && type !== "native") throw new Error("MISSING_CONTRACT_ADDRESS");
  return { chainId, type: type === "native" || sentinel ? "native" as const : "erc20" as const, address: sentinel ? null : normalized };
}
export function tokenIdentityKey(chainId: number, address: string | null): string {
  if (!isSupportedSecurityChain(chainId)) throw new Error("UNSUPPORTED_SECURITY_CHAIN");
  return `${chainId}:${address === null ? "native" : normalizeTokenIdentity(chainId, "contract", address).address ?? "native"}`;
}
export function isValidSecurityDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
export function isSafeSecurityText(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}

export function validateTrustedTokenEntry(value: unknown): TrustedTokenEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REGISTRY_ENTRY");
  const entry = value as TrustedTokenEntry;
  if (!isSafeSecurityText(entry.assetId) || !isSafeSecurityText(entry.symbol, 64) || (entry.name !== undefined && !isSafeSecurityText(entry.name)) || !["trusted", "disabled", "pending_migration"].includes(entry.status)) throw new Error("INVALID_REGISTRY_ENTRY");
  const identity = normalizeTokenIdentity(entry.chainId, entry.type, entry.address);
  if (identity.type !== entry.type || identity.address !== entry.address || !Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > 255) throw new Error("INVALID_REGISTRY_IDENTITY");
  if (!Number.isSafeInteger(entry.version) || entry.version < 1 || !isValidSecurityDate(entry.firstVerifiedAt) || !isValidSecurityDate(entry.lastVerifiedAt) || Date.parse(entry.firstVerifiedAt) > Date.parse(entry.lastVerifiedAt)) throw new Error("INVALID_REGISTRY_VERSION");
  if (!Array.isArray(entry.consensusSources) || entry.consensusSources.length < 1 || entry.consensusSources.length > 10 || !entry.consensusSources.every((source) => isSafeSecurityText(source, 64))) throw new Error("INVALID_REGISTRY_SOURCES");
  if (entry.providerAssetIds !== undefined) {
    if (!entry.providerAssetIds || typeof entry.providerAssetIds !== "object" || Array.isArray(entry.providerAssetIds) || Object.entries(entry.providerAssetIds).some(([provider, id]) => !["coingecko", "coinmarketcap", "lifi"].includes(provider) || !isSafeSecurityText(id))) throw new Error("INVALID_REGISTRY_PROVIDER_BINDING");
  }
  return entry;
}
export function validateTrustedRegistry(value: unknown): TrustedRegistryDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REGISTRY_SCHEMA");
  const doc = value as TrustedRegistryDocument;
  if (doc.schemaVersion !== 1 || !Number.isSafeInteger(doc.version) || doc.version < 1 || !Array.isArray(doc.entries) || doc.entries.length > 10000 || !Array.isArray(doc.history) || doc.history.length > 10000) throw new Error("INVALID_REGISTRY_SCHEMA");
  const assets = new Set<string>(); const addresses = new Set<string>();
  for (const raw of doc.entries) {
    const entry = validateTrustedTokenEntry(raw);
    const asset = `${entry.assetId}:${entry.chainId}`; const address = tokenIdentityKey(entry.chainId, entry.address);
    if (entry.version > doc.version || assets.has(asset) || addresses.has(address)) throw new Error("DUPLICATE_REGISTRY_IDENTITY");
    assets.add(asset); addresses.add(address);
  }
  let lastVersion = 1;
  for (const revision of doc.history) {
    validateRegistryRevision(revision);
    if (revision.version !== lastVersion + 1 || revision.version > doc.version) throw new Error("INVALID_REGISTRY_HISTORY");
    lastVersion = revision.version;
  }
  if (lastVersion !== doc.version) throw new Error("INVALID_REGISTRY_HISTORY");
  return doc;
}
export function validateRegistryRevision(revision: RegistryRevision) {
  if (!revision || !["onboard", "migrate", "disable", "resolve"].includes(revision.operation) || !isSafeSecurityText(revision.assetId) || !isSafeSecurityText(revision.reason, 2000) || !isSafeSecurityText(revision.approvedBy) || !isValidSecurityDate(revision.approvedAt) || !Array.isArray(revision.externalEvidence) || revision.externalEvidence.length < 1 || revision.externalEvidence.length > 20 || !revision.externalEvidence.every((item) => isSafeSecurityText(item, 2000))) throw new Error("INVALID_REGISTRY_APPROVAL");
  validateTrustedTokenEntry(revision.nextEntry);
  if (revision.previousEntry !== null) validateTrustedTokenEntry(revision.previousEntry);
  if (revision.nextEntry.assetId !== revision.assetId || revision.nextEntry.chainId !== revision.chainId || revision.nextEntry.version !== revision.version || revision.nextEntry.address !== revision.newAddress || (revision.previousEntry?.address ?? null) !== revision.oldAddress) throw new Error("INVALID_REGISTRY_REVISION");
}
export function getTrustedToken(document: Pick<TrustedRegistryDocument, "entries">, assetId: string, chainId: number): TrustedTokenEntry | null {
  return document.entries.find((entry) => entry.assetId === assetId && entry.chainId === chainId) ?? null;
}
export function lookupTrustedToken(document: Pick<TrustedRegistryDocument, "entries">, chainId: number, address: string | null): TrustedTokenEntry | null {
  const key = tokenIdentityKey(chainId, address);
  return document.entries.find((entry) => tokenIdentityKey(entry.chainId, entry.address) === key) ?? null;
}
import type { RegistryRevision, TrustedRegistryDocument, TrustedTokenEntry } from "./types";

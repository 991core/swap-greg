import { isAppChainId } from "../chains";
import type { NormalizedRoute } from "../types/normalized-route";
import type { SwapParams } from "../aggregators/lifi/routes";
import { routeTokens } from "../routing/details";
import { PLATFORM_FEE, SLIPPAGE } from "../routing/config";

export const INTENT_PREFIX = "hermes:intent:v2:";
const LEGACY_KEYS = ["hermes-rango-pending-v1", "hermes:oneclick:latest"] as const;
const MAX_RECORD_BYTES = 1_048_576;
const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const UINT = /^\d{1,78}$/;
const isUint = (value: unknown): value is string => typeof value === "string" && UINT.test(value);
export type IntentStatus = "prepared" | "emitting" | "send_ambiguous" | "source_known" | "source_failed" |
  "destination_pending" | "delivered" | "alternative_output" | "refund_pending" | "refund_verified" |
  "intervention_required" | "rejected" | "approval_only" | "not_emitted";
export type IntentAction = {
  id: string; kind: "approval" | "approval_reset" | "swap" | "deposit"; chainId: number; to: string; data: string; value: string;
  status: "emitting" | "ambiguous" | "known" | "confirmed" | "reverted" | "rejected" | "not_sent"; nonce?: number; hash?: string; evidence?: unknown;
};
export type IntentSeed = {
  provider: NormalizedRoute["provider"]; wallet: string; recipient: string;
  request: SwapParams; quoteId: string; quoteKey: string; minimum: string; expiresAt: number;
  fromToken: { chainId: number; address: string; decimals: number };
  toToken: { chainId: number; address: string; decimals: number };
  economics: { platformFee: number; slippage: number; sourceGasUSD: string | null };
  selectedQuote: NormalizedRoute;
};
export type IntentRecord = {
  version: 2; id: string; provider: "lifi" | "rango" | "oneclick"; wallet: string | null; sourceChainId: number | null;
  createdAt: number; updatedAt: number; status: IntentStatus; seed: IntentSeed | null; actions: IntentAction[];
  providerState?: unknown; evidence?: unknown; legacy?: { key: string; raw: string }; persistenceError?: boolean;
};
export class IntentJournalError extends Error {
  constructor(public readonly code: "storage_unavailable" | "storage_corrupt" | "lock_unavailable" | "execution_locked" | "reconciliation_required" | "invalid_transition") { super(code); }
}
export interface JournalStorage {
  readonly length: number; key(index: number): string | null; getItem(key: string): string | null; setItem(key: string, value: string): void;
}
export interface JournalLockManager {
  request<T>(name: string, options: { mode: "exclusive"; ifAvailable: true }, callback: (lock: unknown | null) => Promise<T>): Promise<T>;
}
export type JournalEnvironment = { storage: JournalStorage; locks: JournalLockManager; now?: () => number; id?: () => string };
export interface IntentExecutionSession {
  readonly id: string;
  beforeAction(action: Omit<IntentAction, "id" | "status" | "hash" | "evidence">): Promise<string>;
  sent(actionId: string, hash: string): void;
  rejected(actionId: string): void;
  notSent(actionId: string): void;
  ambiguous(actionId: string): void;
  confirmed(actionId: string, evidence?: unknown): void;
  sourceFailed(actionId: string, evidence?: unknown): void;
  setStatus(status: IntentStatus, evidence?: unknown): void;
  saveProviderState(state: unknown): void;
  snapshot(): IntentRecord;
}
// This memory copy preserves newly received hashes if storage fails after a
// possible emission. Export is voluntary; nothing is sent to a server.
let emergencyStores = new WeakMap<JournalStorage, Map<string, IntentRecord>>();
function emergencyRecords(storage: JournalStorage): Map<string, IntentRecord> {
  let records = emergencyStores.get(storage);
  if (!records) { records = new Map(); emergencyStores.set(storage, records); }
  return records;
}
const STATUSES = new Set<IntentStatus>(["prepared", "emitting", "send_ambiguous", "source_known", "source_failed", "destination_pending", "delivered", "alternative_output", "refund_pending", "refund_verified", "intervention_required", "rejected", "approval_only", "not_emitted"]);
const NONBLOCKING = new Set<IntentStatus>(["delivered", "source_failed", "rejected", "approval_only", "not_emitted", "refund_verified"]);
function json(value: unknown): string { return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item); }
function clone<T>(value: T): T { return JSON.parse(json(value)) as T; }
function storageDefault(): JournalStorage {
  try { if (typeof window !== "undefined") return window.localStorage; } catch { /* fail closed */ }
  throw new IntentJournalError("storage_unavailable");
}
function environmentDefault(): JournalEnvironment {
  const storage = storageDefault();
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new IntentJournalError("lock_unavailable");
  return { storage, locks: navigator.locks as unknown as JournalLockManager };
}
export function buildIntentSeed(route: NormalizedRoute, request: SwapParams): IntentSeed {
  const { fromToken, toToken } = routeTokens(route);
  return { provider: route.provider, wallet: request.fromAddress, recipient: request.fromAddress, request: clone(request),
    quoteId: route.id, quoteKey: [request.fromChainId, request.toChainId, request.fromTokenAddress.toLowerCase(), request.toTokenAddress.toLowerCase(), request.fromAmount, request.fromAddress.toLowerCase()].join(":"),
    minimum: route.toAmountMin, expiresAt: route.expiresAt,
    fromToken: { chainId: fromToken.chainId, address: fromToken.address, decimals: fromToken.decimals },
    toToken: { chainId: toToken.chainId, address: toToken.address, decimals: toToken.decimals },
    economics: { platformFee: PLATFORM_FEE, slippage: SLIPPAGE, sourceGasUSD: route.gasCostUSD }, selectedQuote: clone(route) };
}
function validSeed(seed: IntentSeed): boolean {
  return !!seed && ["lifi", "rango", "oneclick"].includes(seed.provider) && ADDRESS.test(seed.wallet) && ADDRESS.test(seed.recipient) &&
    seed.request?.fromAddress?.toLowerCase() === seed.wallet.toLowerCase() &&
    Number.isSafeInteger(seed.request.fromChainId) && Number.isSafeInteger(seed.request.toChainId) &&
    ADDRESS.test(seed.request.fromTokenAddress) && ADDRESS.test(seed.request.toTokenAddress) && isUint(seed.request.fromAmount) && isUint(seed.minimum) &&
    seed.request.fromChainId > 0 && seed.request.toChainId > 0 &&
    !!seed.selectedQuote && seed.selectedQuote.provider === seed.provider && seed.selectedQuote.id === seed.quoteId && seed.selectedQuote.toAmountMin === seed.minimum &&
    !!seed.economics && Number.isFinite(seed.economics.platformFee) && seed.economics.platformFee >= 0 && seed.economics.platformFee <= 1 &&
    Number.isFinite(seed.economics.slippage) && seed.economics.slippage >= 0 && seed.economics.slippage <= 1 &&
    Number.isSafeInteger(seed.expiresAt) && typeof seed.quoteId === "string" && typeof seed.quoteKey === "string" &&
    [seed.fromToken, seed.toToken].every(token => token && ADDRESS.test(token.address) && Number.isSafeInteger(token.chainId) && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 255) &&
    seed.fromToken.chainId === seed.request.fromChainId && seed.toToken.chainId === seed.request.toChainId &&
    seed.fromToken.address.toLowerCase() === seed.request.fromTokenAddress.toLowerCase() && seed.toToken.address.toLowerCase() === seed.request.toTokenAddress.toLowerCase();
}
function validRecord(value: unknown): value is IntentRecord {
  if (!value || typeof value !== "object") return false;
  const entry = value as IntentRecord;
  return entry.version === 2 && typeof entry.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) &&
    ["lifi", "rango", "oneclick"].includes(entry.provider) && (entry.wallet === null || ADDRESS.test(entry.wallet)) &&
    (entry.sourceChainId === null || Number.isSafeInteger(entry.sourceChainId)) && Number.isSafeInteger(entry.createdAt) && Number.isSafeInteger(entry.updatedAt) &&
    STATUSES.has(entry.status) && ((entry.seed === null && !!entry.legacy && entry.status === "intervention_required") ||
      (validSeed(entry.seed!) && entry.provider === entry.seed!.provider && entry.wallet?.toLowerCase() === entry.seed!.wallet.toLowerCase() && entry.sourceChainId === entry.seed!.request.fromChainId)) &&
    Array.isArray(entry.actions) && entry.actions.length <= 100 && entry.actions.every(action => action && typeof action.id === "string" &&
      ["approval", "approval_reset", "swap", "deposit"].includes(action.kind) && ["emitting", "ambiguous", "known", "confirmed", "reverted", "rejected", "not_sent"].includes(action.status) &&
      Number.isSafeInteger(action.chainId) && (action.nonce === undefined || (Number.isSafeInteger(action.nonce) && action.nonce >= 0)) && ADDRESS.test(action.to) && /^0x(?:[\da-f]{2})*$/i.test(action.data) && isUint(action.value) && (action.hash === undefined || (typeof action.hash === "string" && HASH.test(action.hash))));
}
function save(storage: JournalStorage, record: IntentRecord): void {
  const serialized = json(record);
  if (!validRecord(record) || new TextEncoder().encode(serialized).length > MAX_RECORD_BYTES) throw new IntentJournalError("storage_corrupt");
  try {
    storage.setItem(INTENT_PREFIX + record.id, serialized);
    if (storage.getItem(INTENT_PREFIX + record.id) !== serialized) throw new Error("storage verification failed");
    emergencyRecords(storage).delete(record.id);
  } catch {
    emergencyRecords(storage).set(record.id, clone({ ...record, persistenceError: true }));
    throw new IntentJournalError("storage_unavailable");
  }
}
export function readIntentJournal(storage: JournalStorage = storageDefault()): IntentRecord[] {
  const records: IntentRecord[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(INTENT_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (!raw || raw.length > MAX_RECORD_BYTES) throw new IntentJournalError("storage_corrupt");
      const record: unknown = JSON.parse(raw);
      if (!validRecord(record) || key !== INTENT_PREFIX + record.id) throw new IntentJournalError("storage_corrupt");
      records.push(record);
    }
  } catch (error) { throw error instanceof IntentJournalError ? error : new IntentJournalError("storage_corrupt"); }
  return records.sort((left, right) => right.createdAt - left.createdAt);
}
export function intentNeedsReconciliation(record: IntentRecord): boolean {
  // No wallet call is reachable until an action is durably written. A crash
  // or quota failure on the initial dossier alone cannot have emitted funds.
  if (record.status === "prepared" && record.actions.length === 0) return false;
  const principal = record.actions.filter(action => ["swap", "deposit"].includes(action.kind));
  if (["delivered", "refund_verified"].includes(record.status) && (!record.evidence || !principal.some(action => action.hash))) return true;
  if (record.status === "source_failed" && principal.some(action => action.status !== "reverted" && action.status !== "not_sent" && action.status !== "rejected")) return true;
  if (["rejected", "approval_only", "not_emitted"].includes(record.status) && principal.some(action => !["rejected", "not_sent", "reverted"].includes(action.status))) return true;
  // Even a nominally terminal record cannot free an unresolved wallet action.
  return !!record.persistenceError || !NONBLOCKING.has(record.status) || record.actions.some(action => ["emitting", "ambiguous"].includes(action.status));
}
export function migrateLegacyIntents(storage: JournalStorage = storageDefault(), now = Date.now()): void {
  for (const key of LEGACY_KEYS) {
    const raw = storage.getItem(key);
    if (!raw || raw === "null") continue;
    const id = key === LEGACY_KEYS[0] ? "legacy-rango" : "legacy-oneclick";
    // Keep originals intact, including malformed/recognized legacy records.
    if (storage.getItem(INTENT_PREFIX + id)) continue;
    let old: Record<string, unknown> = {};
    try { old = JSON.parse(raw) as Record<string, unknown>; } catch { /* preserve unknown identity and block all wallets */ }
    if (typeof old?.journalId === "string") {
      const existing = readIntentJournal(storage).find(record => record.id === old.journalId);
      const oldWallet = old.account ?? old.wallet;
      if (existing && existing.provider === (key === LEGACY_KEYS[0] ? "rango" : "oneclick") &&
          typeof oldWallet === "string" && existing.wallet?.toLowerCase() === oldWallet.toLowerCase()) continue;
    }
    const wallet = typeof (old?.account ?? old?.wallet) === "string" && ADDRESS.test(String(old.account ?? old.wallet)) ? String(old.account ?? old.wallet) : null;
    const chain = old?.chainId ?? old?.fromChainId;
    save(storage, { version: 2, id, provider: key === LEGACY_KEYS[0] ? "rango" : "oneclick", wallet,
      sourceChainId: typeof chain === "number" && Number.isSafeInteger(chain) ? chain : null, createdAt: now, updatedAt: now,
      status: "intervention_required", seed: null, actions: [], legacy: { key, raw } });
  }
}
export function exportIntentJournal(storage: JournalStorage = storageDefault()): string {
  // Include raw records so corruption can be diagnosed without deleting data.
  const raw: Record<string, string | null> = {};
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key && (key.startsWith(INTENT_PREFIX) || LEGACY_KEYS.includes(key as typeof LEGACY_KEYS[number]))) raw[key] = storage.getItem(key); }
  return json({ version: 2, exportedAt: Date.now(), records: raw, emergencyRecords: [...emergencyRecords(storage).values()] });
}
function newSession(record: IntentRecord, env: JournalEnvironment, isActive: () => boolean): IntentExecutionSession {
  const update = (mutation: () => void) => { mutation(); record.updatedAt = (env.now ?? Date.now)(); save(env.storage, record); };
  const action = (id: string) => { const found = record.actions.find(item => item.id === id); if (!found) throw new IntentJournalError("invalid_transition"); return found; };
  return {
    id: record.id,
    async beforeAction(input) {
      if (!isActive()) throw new IntentJournalError("invalid_transition");
      if (record.actions.some(item => ["emitting", "ambiguous"].includes(item.status)) || record.persistenceError) throw new IntentJournalError("reconciliation_required");
      if (input.chainId !== record.sourceChainId || !ADDRESS.test(input.to) || !/^0x(?:[\da-f]{2})*$/i.test(input.data) || !isUint(input.value)) throw new IntentJournalError("invalid_transition");
      if (input.nonce !== undefined && readIntentJournal(env.storage).some(previous => previous.wallet?.toLowerCase() === record.wallet?.toLowerCase() &&
          previous.actions.some(action => action.chainId === input.chainId && action.nonce === input.nonce && action.hash))) throw new IntentJournalError("reconciliation_required");
      const id = `${record.id}-${record.actions.length}`;
      update(() => { record.actions.push({ ...input, id, status: "emitting" }); record.status = "emitting"; });
      return id;
    },
    sent(id, hash) {
      if (!HASH.test(hash) || action(id).status !== "emitting") throw new IntentJournalError("invalid_transition");
      update(() => { action(id).hash = hash; action(id).status = "known"; record.status = "source_known"; });
    },
    notSent(id) { if (action(id).status !== "emitting") throw new IntentJournalError("invalid_transition"); update(() => { action(id).status = "not_sent"; record.status = "not_emitted"; }); },
    rejected(id) { if (action(id).status !== "emitting") throw new IntentJournalError("invalid_transition"); update(() => { action(id).status = "rejected"; record.status = "rejected"; }); },
    ambiguous(id) { update(() => { if (!action(id).hash) action(id).status = "ambiguous"; record.status = "send_ambiguous"; }); },
    confirmed(id, evidence) { if (!action(id).hash) throw new IntentJournalError("invalid_transition"); update(() => { action(id).status = "confirmed"; action(id).evidence = evidence; record.status = ["approval", "approval_reset"].includes(action(id).kind) ? "approval_only" : "destination_pending"; }); },
    sourceFailed(id, evidence) { if (!action(id).hash || !evidence) throw new IntentJournalError("invalid_transition"); update(() => { action(id).status = "reverted"; action(id).evidence = evidence; record.status = "source_failed"; }); },
    setStatus(status, evidence) {
      if (!STATUSES.has(status) || (["delivered", "refund_verified"].includes(status) && (!evidence || !record.actions.some(action => ["swap", "deposit"].includes(action.kind) && action.hash)))) throw new IntentJournalError("invalid_transition");
      update(() => { record.status = status; if (evidence !== undefined) record.evidence = clone(evidence); }); },
    saveProviderState(state) { update(() => { record.providerState = clone(state); }); },
    snapshot() { return clone(record); },
  };
}
export async function withIntentExecution<T>(seed: IntentSeed, task: (session: IntentExecutionSession) => Promise<T>, environment?: JournalEnvironment): Promise<T> {
  if (!validSeed(seed)) throw new IntentJournalError("storage_corrupt");
  const env = environment ?? environmentDefault();
  // Web Locks are released by the browser when a tab closes. No time-based
  // lease ever erases durable ambiguous emissions. Do not substitute storage events.
  return env.locks.request(`hermes:wallet:${seed.wallet.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new IntentJournalError("execution_locked");
    migrateLegacyIntents(env.storage, (env.now ?? Date.now)());
    const records = readIntentJournal(env.storage);
    if ([...records, ...emergencyRecords(env.storage).values()].some(record => (record.wallet === null || record.wallet.toLowerCase() === seed.wallet.toLowerCase()) && intentNeedsReconciliation(record))) throw new IntentJournalError("reconciliation_required");
    const now = (env.now ?? Date.now)();
    const record: IntentRecord = { version: 2, id: (env.id ?? (() => crypto.randomUUID()))(), provider: seed.provider,
      wallet: seed.wallet, sourceChainId: seed.request.fromChainId, createdAt: now, updatedAt: now, status: "prepared", seed: clone(seed), actions: [] };
    // UUID collisions or an injected bad generator never overwrite history.
    if (env.storage.getItem(INTENT_PREFIX + record.id)) throw new IntentJournalError("storage_corrupt");
    save(env.storage, record);
    let active = true;
    const session = newSession(record, env, () => active);
    try {
      const result = await task(session);
      if (record.actions.length === 0) session.setStatus("not_emitted");
      return result;
    } catch (error) {
      try {
        if (record.actions.some(action => action.status === "emitting")) session.setStatus("send_ambiguous");
        else if (!record.actions.length || record.actions.every(action => action.status === "not_sent")) session.setStatus("not_emitted");
        else if (record.actions.every(action => ["approval", "approval_reset"].includes(action.kind) && ["confirmed", "rejected", "reverted", "not_sent"].includes(action.status))) session.setStatus("approval_only");
      } catch { /* durable pre-emission state remains blocking; volatile export preserves newer evidence */ }
      throw error;
    } finally { active = false; }
  });
}
// Tracking callers may attach only observed evidence. This API has no wallet,
// provider execution, SDK resumeRoute, signature or resend capability.
export async function updateIntentTracking(id: string, status: IntentStatus, evidence: unknown, environment?: JournalEnvironment, providerState?: unknown): Promise<IntentRecord> {
  if (!["destination_pending", "delivered", "alternative_output", "refund_pending", "refund_verified", "intervention_required"].includes(status)) throw new IntentJournalError("invalid_transition");
  const env = environment ?? environmentDefault();
  return env.locks.request(`hermes:wallet:${(readIntentJournal(env.storage).find(item => item.id === id)?.wallet ?? "unknown").toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new IntentJournalError("execution_locked");
    const record = readIntentJournal(env.storage).find(item => item.id === id);
    if (!record || record.seed === null || record.actions.some(action => ["emitting", "ambiguous"].includes(action.status))) throw new IntentJournalError("reconciliation_required");
    if (["delivered", "refund_verified"].includes(status) && (!evidence || !record.actions.some(action => ["swap", "deposit"].includes(action.kind) && action.hash))) throw new IntentJournalError("invalid_transition");
    record.status = status; record.evidence = clone(evidence); if (providerState !== undefined) record.providerState = clone(providerState); record.updatedAt = (env.now ?? Date.now)(); save(env.storage, record); return clone(record);
  });
}

export type SourceObservation = {
  transaction: { hash: string; from: string; to: string | null; input: string; value: bigint; chainId?: number; nonce?: number };
  receipt?: { transactionHash: string; status: "success" | "reverted" };
};
export type SourceLookup = (chainId: number, hash: `0x${string}`) => Promise<SourceObservation>;
const lookupSource: SourceLookup = async (chainId, hash) => {
  if (!isAppChainId(chainId)) throw new IntentJournalError("reconciliation_required");
  const [{ getTransaction, getTransactionReceipt }, { walletConfig }] = await Promise.all([import("wagmi/actions"), import("../wallet")]);
  const transaction = await getTransaction(walletConfig, { chainId, hash });
  let receipt: SourceObservation["receipt"];
  try { receipt = await getTransactionReceipt(walletConfig, { chainId, hash }); } catch { /* no confirmed receipt yet: source remains pending */ }
  return { transaction, receipt };
};
// Explicit read-only reconciliation: a supplied hash is looked up on the saved
// source chain and must match the exact persisted wallet envelope. It does not
// request a wallet, retry the transaction, approve, refund or resume an SDK route.
export async function reconcileSourceHash(id: string, actionId: string, hash: `0x${string}`, environment?: JournalEnvironment, lookup: SourceLookup = lookupSource): Promise<IntentRecord> {
  if (!HASH.test(hash)) throw new IntentJournalError("invalid_transition");
  const env = environment ?? environmentDefault();
  const before = readIntentJournal(env.storage).find(record => record.id === id);
  if (!before?.wallet || before.seed === null) throw new IntentJournalError("reconciliation_required");
  return env.locks.request(`hermes:wallet:${before.wallet.toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new IntentJournalError("execution_locked");
    const record = readIntentJournal(env.storage).find(item => item.id === id)!;
    const action = record.actions.find(item => item.id === actionId);
    if (!action || ["rejected", "not_sent"].includes(action.status) || (action.hash && action.hash.toLowerCase() !== hash.toLowerCase())) throw new IntentJournalError("invalid_transition");
    if (!Number.isSafeInteger(action.nonce)) throw new IntentJournalError("reconciliation_required");
    const observed = await lookup(action.chainId, hash);
    const tx = observed.transaction;
    if (tx.hash.toLowerCase() !== hash.toLowerCase() || tx.from.toLowerCase() !== record.wallet!.toLowerCase() ||
        tx.to?.toLowerCase() !== action.to.toLowerCase() || tx.input.toLowerCase() !== action.data.toLowerCase() ||
        tx.value !== BigInt(action.value) || tx.nonce !== action.nonce || (tx.chainId !== undefined && tx.chainId !== action.chainId) ||
        (observed.receipt && observed.receipt.transactionHash.toLowerCase() !== hash.toLowerCase())) throw new IntentJournalError("reconciliation_required");
    action.hash = hash;
    action.evidence = { authority: "source_rpc", transaction: tx, receipt: observed.receipt };
    action.status = observed.receipt?.status === "reverted" ? "reverted" : observed.receipt?.status === "success" ? "confirmed" : "known";
    record.status = action.status === "reverted" ? "source_failed" : ["approval", "approval_reset"].includes(action.kind) && action.status === "confirmed" ? "approval_only" : "destination_pending";
    // Other unresolved actions keep the entire record blocked even after this
    // particular hash is reconciled (e.g. a separate approval was ambiguous).
    if (record.actions.some(item => ["emitting", "ambiguous"].includes(item.status))) record.status = "intervention_required";
    record.updatedAt = (env.now ?? Date.now)();
    if (record.providerState && typeof record.providerState === "object" && ["swap", "deposit"].includes(action.kind)) {
      const state = record.providerState as Record<string, unknown>;
      if (record.provider === "rango") state.txHash = hash;
      if (record.provider === "oneclick") { state.hash = hash; state.status = observed.receipt?.status === "reverted" ? "FAILED" : "PENDING_DEPOSIT"; if (observed.receipt?.status === "reverted") state.sourceOutcome = "reverted"; }
    }
    save(env.storage, record); return clone(record);
  });
}

export function resetIntentJournalForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Test reset is unavailable outside tests.");
  emergencyStores = new WeakMap();
}

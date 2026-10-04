import { describe, expect, it, vi } from "vitest";
import { buildIntentSeed, exportIntentJournal, INTENT_PREFIX, intentNeedsReconciliation, migrateLegacyIntents, readIntentJournal, reconcileSourceHash, updateIntentTracking, withIntentExecution, type IntentExecutionSession, type JournalEnvironment, type JournalLockManager, type JournalStorage } from "../lib/intent/journal";
import { normalizedRango } from "./rango-fixtures";
import { params } from "./fixtures";

class Storage implements JournalStorage {
  entries = new Map<string, string>(); fail = false;
  get length() { return this.entries.size; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error("quota exceeded"); this.entries.set(key, value); }
}
class Locks implements JournalLockManager {
  active = new Set<string>();
  async request<T>(name: string, _options: unknown, callback: (lock: unknown | null) => Promise<T>) {
    if (this.active.has(name)) return callback(null);
    this.active.add(name);
    try { return await callback({ name }); } finally { this.active.delete(name); }
  }
}
function setup() { let count = 0; return { storage: new Storage(), locks: new Locks(), id: () => `intent-${++count}`, now: () => 123456 } satisfies JournalEnvironment; }
const seed = () => buildIntentSeed(normalizedRango(), params);
const input = { nonce: 17, kind: "swap" as const, chainId: params.fromChainId, to: params.fromAddress, data: "0x12345678", value: params.fromAmount };
const hash = `0x${"a".repeat(64)}`;

describe("durable browser intent journal", () => {
  it("persists identities, quote, minimum and exact wallet action before an emission", async () => {
    const env = setup();
    await withIntentExecution(seed(), async session => {
      const action = await session.beforeAction(input);
      expect(readIntentJournal(env.storage)[0]).toMatchObject({ status: "emitting", seed: { minimum: seed().minimum, recipient: params.fromAddress }, actions: [{ ...input, status: "emitting" }] });
      session.sent(action, hash);
      session.confirmed(action, { receipt: "source only" });
    }, env);
    expect(readIntentJournal(env.storage)[0]).toMatchObject({ status: "destination_pending", actions: [{ hash }] });
    expect(intentNeedsReconciliation(readIntentJournal(env.storage)[0])).toBe(true);
  });
  it("retains multiple settled and unsubmitted records without overwriting history", async () => {
    const env = setup();
    await withIntentExecution(seed(), async () => null, env);
    await withIntentExecution(seed(), async () => null, env);
    expect(readIntentJournal(env.storage).map(item => item.id)).toEqual(["intent-1", "intent-2"]);
    expect(readIntentJournal(env.storage).every(item => item.status === "not_emitted")).toBe(true);
  });
  it("atomically refuses a simultaneously started tab while the first holds its wallet lock", async () => {
    const env = setup(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const wallet = vi.fn();
    const first = withIntentExecution(seed(), async session => { await session.beforeAction(input); wallet(); await pending; }, env);
    await Promise.resolve();
    await expect(withIntentExecution(seed(), async () => { wallet(); }, env)).rejects.toThrow("execution_locked");
    release(); await first;
    expect(wallet).toHaveBeenCalledOnce();
  });
  it("keeps a crash-window emission blocking after lock loss, reload and an expired local lease", async () => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => { await session.beforeAction(input); throw new Error("tab closed after request"); }, env)).rejects.toThrow("tab closed");
    expect(env.locks.active.size).toBe(0);
    env.storage.setItem("hermes:old-execution-lock", JSON.stringify({ expiresAt: 1 }));
    const wallet = vi.fn();
    await expect(withIntentExecution(seed(), wallet, { ...env, locks: new Locks(), now: () => 999999999 })).rejects.toThrow("reconciliation_required");
    expect(wallet).not.toHaveBeenCalled();
  });
  it("blocks the first emission when initial storage or pre-action persistence fails", async () => {
    const env = setup(); const wallet = vi.fn(); env.storage.fail = true;
    await expect(withIntentExecution(seed(), wallet, env)).rejects.toThrow("storage_unavailable"); expect(wallet).not.toHaveBeenCalled();
    env.storage.fail = false;
    await withIntentExecution(seed(), async () => null, env);
    const another = setup();
    await expect(withIntentExecution(seed(), async session => { another.storage.fail = true; await session.beforeAction(input); wallet(); }, another)).rejects.toThrow("storage_unavailable");
    expect(wallet).not.toHaveBeenCalled();
  });
  it("exports a known hash lost by post-emission storage failure and blocks a renewed execution", async () => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => {
      const id = await session.beforeAction(input); env.storage.fail = true; session.sent(id, hash);
    }, env)).rejects.toThrow("storage_unavailable");
    expect(JSON.parse(exportIntentJournal(env.storage)).emergencyRecords[0].actions[0].hash).toBe(hash);
    env.storage.fail = false;
    await expect(withIntentExecution(seed(), vi.fn(), env)).rejects.toThrow("reconciliation_required");
  });
  it("distinguishes a definite wallet rejection from an ambiguous result without erasing records", async () => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => { const id = await session.beforeAction(input); session.rejected(id); throw { code: 4001 }; }, env)).rejects.toBeTruthy();
    expect(readIntentJournal(env.storage)[0].status).toBe("rejected");
    await withIntentExecution(seed(), async () => null, env);
    await expect(withIntentExecution(seed(), async session => { const id = await session.beforeAction(input); session.ambiguous(id); throw new Error("transport"); }, env)).rejects.toThrow("transport");
    await expect(withIntentExecution(seed(), vi.fn(), env)).rejects.toThrow("reconciliation_required");
    expect(readIntentJournal(env.storage)).toHaveLength(3);
  });
  it("fails closed on malformed/truncated journal data and exports the original for diagnosis", async () => {
    const env = setup(); env.storage.setItem(INTENT_PREFIX + "broken", "{truncated");
    await expect(withIntentExecution(seed(), vi.fn(), env)).rejects.toThrow("storage_corrupt");
    expect(JSON.parse(exportIntentJournal(env.storage)).records[INTENT_PREFIX + "broken"]).toBe("{truncated");
  });
  it("migrates legacy records conservatively, preserving their raw evidence and ambiguity", async () => {
    const env = setup(); const old = JSON.stringify({ wallet: params.fromAddress, fromChainId: params.fromChainId, hash });
    env.storage.setItem("hermes:oneclick:latest", old); migrateLegacyIntents(env.storage);
    expect(env.storage.getItem("hermes:oneclick:latest")).toBe(old);
    expect(readIntentJournal(env.storage)[0]).toMatchObject({ status: "intervention_required", legacy: { raw: old } });
    const wallet = vi.fn(); await expect(withIntentExecution(seed(), wallet, env)).rejects.toThrow("reconciliation_required"); expect(wallet).not.toHaveBeenCalled();
  });
  it("blocks all wallets for malformed legacy data instead of assuming no previous transfer", async () => {
    const env = setup(); env.storage.setItem("hermes-rango-pending-v1", "broken");
    await expect(withIntentExecution(seed(), vi.fn(), env)).rejects.toThrow("reconciliation_required");
    expect(readIntentJournal(env.storage)[0].wallet).toBeNull();
  });
  it("restored tracking can only update evidence, never create wallet actions or release ambiguous sends", async () => {
    const env = setup();
    await withIntentExecution(seed(), async session => { const id = await session.beforeAction(input); session.sent(id, hash); }, env);
    const record = readIntentJournal(env.storage)[0];
    await updateIntentTracking(record.id, "destination_pending", { observed: "running" }, env);
    expect(readIntentJournal(env.storage)[0].actions).toEqual(record.actions);
    await expect(updateIntentTracking(record.id, "rejected", { forged: true }, env)).rejects.toThrow("invalid_transition");
    await expect(updateIntentTracking(record.id, "delivered", null, env)).rejects.toThrow("invalid_transition");
    await updateIntentTracking(record.id, "delivered", { provider: "rango", verifiedOutput: true }, env);
    expect(readIntentJournal(env.storage)[0].status).toBe("delivered");
  });
  it("retains confirmed approval context when the swap never reaches its wallet request", async () => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => { const id = await session.beforeAction({ ...input, kind: "approval" }); session.sent(id, hash); session.confirmed(id, { receiptStatus: "success" }); throw new Error("quote expired"); }, env)).rejects.toThrow("quote expired");
    expect(readIntentJournal(env.storage)[0]).toMatchObject({ status: "approval_only", actions: [{ hash, status: "confirmed" }] });
    await withIntentExecution(seed(), async () => null, env);
  });
  it("reconciles an ambiguous source hash using exact on-chain envelope evidence and never proves destination delivery from a source receipt", async () => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => { await session.beforeAction(input); throw new Error("transport"); }, env)).rejects.toThrow("transport");
    const old = readIntentJournal(env.storage)[0];
    const lookup = vi.fn(async () => ({ transaction: { hash, from: params.fromAddress, to: input.to, input: input.data, value: BigInt(input.value), chainId: input.chainId, nonce: 17 }, receipt: { transactionHash: hash, status: "success" as const } }));
    const recovered = await reconcileSourceHash(old.id, old.actions[0].id, hash as `0x${string}`, env, lookup);
    expect(lookup).toHaveBeenCalledWith(params.fromChainId, hash);
    expect(recovered.status).toBe("destination_pending");
    expect(recovered.actions[0]).toMatchObject({ hash, status: "confirmed", evidence: { authority: "source_rpc" } });
    await expect(withIntentExecution(seed(), vi.fn(), env)).rejects.toThrow("reconciliation_required");
  });
  it.each(["from", "to", "input", "value", "chainId", "nonce", "receiptHash"])("refuses mismatching %s source evidence and preserves the ambiguous record", async field => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => { await session.beforeAction(input); throw new Error("transport"); }, env)).rejects.toThrow("transport");
    const old = readIntentJournal(env.storage)[0];
    const observation = { transaction: { hash, from: params.fromAddress, to: input.to, input: input.data, value: BigInt(input.value), chainId: input.chainId, nonce: 17 }, receipt: { transactionHash: hash, status: "success" as const } };
    if (field === "from") observation.transaction.from = "0x" + "b".repeat(40);
    if (field === "to") observation.transaction.to = "0x" + "b".repeat(40);
    if (field === "input") observation.transaction.input = "0xdeadbeef";
    if (field === "value") observation.transaction.value++;
    if (field === "chainId") observation.transaction.chainId++;
    if (field === "nonce") observation.transaction.nonce = 16;
    if (field === "receiptHash") observation.receipt.transactionHash = "0x" + "b".repeat(64);
    await expect(reconcileSourceHash(old.id, old.actions[0].id, hash as `0x${string}`, env, async () => observation)).rejects.toThrow("reconciliation_required");
    expect(readIntentJournal(env.storage)[0]).toEqual(old);
  });
  it("refuses a wallet action from a timer or stale SDK callback after the execution lock was released", async () => {
    const env = setup(); let stale!: IntentExecutionSession;
    await withIntentExecution(seed(), async session => { stale = session; }, env);
    await expect(stale.beforeAction(input)).rejects.toThrow("invalid_transition");
    expect(readIntentJournal(env.storage)[0]).toMatchObject({ status: "not_emitted", actions: [] });
  });
  it("cannot reconcile an older action without a saved emission nonce using only an identical transaction envelope", async () => {
    const env = setup();
    await expect(withIntentExecution(seed(), async session => { await session.beforeAction(input); throw new Error("transport"); }, env)).rejects.toThrow("transport");
    const old = readIntentJournal(env.storage)[0]; delete old.actions[0].nonce;
    env.storage.setItem(INTENT_PREFIX + old.id, JSON.stringify(old));
    const lookup = vi.fn();
    await expect(reconcileSourceHash(old.id, old.actions[0].id, hash as `0x${string}`, env, lookup)).rejects.toThrow("reconciliation_required");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("refuses reusing an already-observed source nonce even if an RPC reports a stale pending nonce", async () => {
    const env = setup();
    await withIntentExecution(seed(), async session => { const id = await session.beforeAction({ ...input, kind: "approval" }); session.sent(id, hash); session.confirmed(id, { receipt: "success" }); }, env);
    const wallet = vi.fn();
    await expect(withIntentExecution(seed(), async session => { await session.beforeAction(input); wallet(); }, env)).rejects.toThrow("reconciliation_required");
    expect(wallet).not.toHaveBeenCalled();
  });
  it("requires atomic browser locks, and cannot use a localStorage boolean as a fallback", async () => {
    vi.stubGlobal("window", { localStorage: new Storage() }); vi.stubGlobal("navigator", {});
    await expect(withIntentExecution(seed(), vi.fn())).rejects.toThrow("lock_unavailable"); vi.unstubAllGlobals();
  });
});

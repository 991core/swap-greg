import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../lib/security/resolver.server", () => ({ resolveTokenSources: vi.fn(async () => ({ results: [], unavailable: [] })) }));
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), switchChain: vi.fn() }));
vi.mock("../lib/aggregators/lifi/execute", () => ({ executeLifiRoute: vi.fn() }));
import { POST } from "../app/api/security/validate/route";
import { GET } from "../app/api/security/registry/route";
import { readTrustedRegistry } from "../lib/security/registry.server";
import { readSecurityEvents } from "../lib/security/events.server";
import { resolveTokenSources } from "../lib/security/resolver.server";
import { wallet } from "./fixtures";
import type { SecuritySwapIntent } from "../lib/security/quote-validator";
let directory: string;
const intent = (): SecuritySwapIntent => ({ provider: "lifi", protocol: "test", fromChainId: 8453, toChainId: 1,
  fromTokenAddress: "0x0000000000000000000000000000000000000000", toTokenAddress: "0x0000000000000000000000000000000000000000",
  fromTokenDecimals: 18, toTokenDecimals: 18, fromAddress: wallet, receiver: wallet, fromAmount: "1000", toAmount: "1000", minimumAmountOut: "995", expiresAt: Date.now() + 30_000, maxSlippageBps: 50 });
function request(input: unknown, origin = "http://localhost:3000") { return POST(new Request("http://localhost:3000/api/security/validate", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(input) })); }
beforeEach(async () => {
  vi.stubEnv("HERMES_ENABLE_DIAGNOSTIC_API", "true");
  vi.clearAllMocks(); directory = await mkdtemp(path.join(tmpdir(), "hermes-security-api-"));
  vi.stubEnv("TOKEN_REGISTRY_PATH", path.join(directory, "registry.json")); vi.stubEnv("TOKEN_CONFLICT_LOG_PATH", path.join(directory, "events.json"));
  vi.stubEnv("LIFI_ALLOWED_CONTRACTS", "[]"); vi.stubEnv("ALLOWED_APPROVAL_TARGETS", "[]"); vi.stubEnv("ALLOWED_DEPOSIT_RECEIVERS", "[]");
  vi.mocked(resolveTokenSources).mockResolvedValue({ results: [], unavailable: [] });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
it("returns the persisted seed and explicitly reports that signing policy is unconfigured", async () => {
  const response = await GET(); const value = await response.json();
  expect(response.status).toBe(200); expect(value.registry.entries).toHaveLength(39); expect(value.executionConfigured).toBe(false);
});
it("rejects cross-origin authorization before accessing persistent authority", async () => {
  expect((await request({ mode: "quote", intent: intent(), quote: intent() }, "https://attacker.example")).status).toBe(403);
  expect(resolveTokenSources).not.toHaveBeenCalled();
});
it("uses reviewed authority during outages without manufacturing provider votes", async () => {
  const input = intent(); expect((await request({ mode: "quote", intent: input, quote: input })).status).toBe(200);
  const journal = await readSecurityEvents(); expect(journal.conflicts).toHaveLength(0);
  expect(journal.events.filter(event => event.event === "TOKEN_PROVIDER_UNAVAILABLE")).toHaveLength(6);
});
it("blocks an unknown address, persists TOKEN_NOT_IN_REGISTRY, and never queries it as authoritative", async () => {
  const input = { ...intent(), fromTokenAddress: "0x1111111111111111111111111111111111111112" };
  const response = await request({ mode: "quote", intent: input, quote: input });
  expect((await response.json()).error).toBe("TOKEN_NOT_IN_REGISTRY"); expect(resolveTokenSources).not.toHaveBeenCalled();
  expect((await readSecurityEvents()).events.some(event => event.event === "TOKEN_NOT_IN_REGISTRY")).toBe(true);
});
it.each([
  ["toChainId", 10, "QUOTE_CHAIN_MISMATCH"], ["receiver", "0x1111111111111111111111111111111111111112", "QUOTE_RECEIVER_MISMATCH"],
  ["toTokenDecimals", 6, "QUOTE_TOKEN_MISMATCH"], ["minimumAmountOut", "990", "QUOTE_VALIDATION_FAILED"],
])("logs a malicious quote change in %s", async (field, value, event) => {
  const input = intent(); const response = await request({ mode: "quote", intent: input, quote: { ...input, [field]: value } });
  expect((await response.json()).error).toBe(event); expect((await readSecurityEvents()).events.some(item => item.event === event)).toBe(true);
});
it("blocks and logs an unreviewed transaction target before contacting external sources", async () => {
  const input = intent(); const response = await request({ mode: "transaction", intent: input,
    candidate: { chainId: 8453, from: wallet, to: wallet, data: "0x12345678", value: "0" }, context: { provider: "lifi", kind: "swap", protocol: "test" } });
  expect((await response.json()).error).toBe("UNKNOWN_TRANSACTION_TARGET"); expect(resolveTokenSources).not.toHaveBeenCalled();
  expect((await readSecurityEvents()).events.some(item => item.event === "UNKNOWN_TRANSACTION_TARGET")).toBe(true);
});
it("blocks external unanimous fake native contract claims and keeps persistent identity unchanged", async () => {
  const registry = await readTrustedRegistry(); const entry = registry.entries.find(item => item.chainId === 8453 && item.type === "native")!;
  vi.mocked(resolveTokenSources).mockImplementation(async current => ({ results: ["coingecko", "coinmarketcap", "lifi"].map(provider => ({ provider: provider as "coingecko", chainId: current.chainId, assetId: current.assetId, tokenType: "contract", address: wallet, fetchedAt: new Date().toISOString(), lookupMode: "asset-id" })), unavailable: [] }));
  const input = intent(); expect((await request({ mode: "quote", intent: input, quote: input })).status).toBe(422);
  expect((await readTrustedRegistry()).entries.find(item => item.assetId === entry.assetId)).toEqual(entry);
  expect((await readSecurityEvents()).conflicts.some(item => item.event === "TOKEN_CONTRACT_CHANGED" && item.severity === "critical")).toBe(true);
  vi.mocked(resolveTokenSources).mockResolvedValue({ results: [], unavailable: [] });
  expect((await request({ mode: "quote", intent: input, quote: input })).status).toBe(422);
});
it("the standalone registry endpoint still rejects an unregistered address", async () => {
  const input = { ...intent(), fromTokenAddress: "0x2222222222222222222222222222222222222222" };
  const response = await request({ mode: "quote", intent: input, quote: input });
  expect((await response.json()).error).toBe("TOKEN_NOT_IN_REGISTRY");
});

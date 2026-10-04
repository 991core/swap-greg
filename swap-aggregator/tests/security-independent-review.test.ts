import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/security/validate/route";
import * as resolver from "../lib/security/resolver.server";
import * as journal from "../lib/security/events.server";
import { applyRegistryChange, readTrustedRegistry } from "../lib/security/registry.server";
import type { SecuritySwapIntent } from "../lib/security/quote-validator";
import { executeRangoRoute } from "../lib/aggregators/rango/execute";
import { executeOneClickRoute } from "../lib/aggregators/oneclick/execute";
import * as oneClickClient from "../lib/aggregators/oneclick/client";
import { rangoRequest } from "../lib/aggregators/rango/client";
import { getCatalogToken } from "../lib/tokens/catalog";
import { estimateFeesPerGas, estimateGas, getAccount, getBalance, readContract, sendTransaction, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { tokenSwap, hash } from "./rango-fixtures";
import { wallet } from "./fixtures";
import type { OneClickNormalizedRoute } from "../lib/types/normalized-route";

vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(), estimateGas: vi.fn(), estimateFeesPerGas: vi.fn(), writeContract: vi.fn(), sendTransaction: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));

let directory: string;
const native = "0x0000000000000000000000000000000000000000";
function intent(): SecuritySwapIntent {
  return { provider: "lifi", protocol: "review-test", fromChainId: 8453, toChainId: 1,
    fromTokenAddress: native, toTokenAddress: native, fromTokenDecimals: 18, toTokenDecimals: 18,
    fromAddress: wallet, receiver: wallet, fromAmount: "1000", toAmount: "1000", minimumAmountOut: "995",
    expiresAt: Date.now() + 30_000, maxSlippageBps: 50 };
}
function authorize(input = intent()) {
  return POST(new Request("http://localhost:3000/api/security/validate", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ mode: "quote", intent: input, quote: input }) }));
}
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "hermes-independent-review-"));
  vi.stubEnv("TOKEN_REGISTRY_PATH", path.join(directory, "registry.json"));
  vi.stubEnv("TOKEN_CONFLICT_LOG_PATH", path.join(directory, "events.json"));
  vi.stubEnv("LIFI_ALLOWED_CONTRACTS", "[]"); vi.stubEnv("ALLOWED_APPROVAL_TARGETS", "[]"); vi.stubEnv("ALLOWED_DEPOSIT_RECEIVERS", "[]");
  vi.stubEnv("CG_API_KEY", ""); vi.stubEnv("CMC_API_KEY", ""); vi.stubEnv("LIFI_API_KEY", "");
  vi.mocked(getAccount).mockReturnValue({ isConnected: true, address: wallet, chainId: 8453 } as never);
  vi.mocked(getBalance).mockResolvedValue({ value: BigInt("1000000000000000000") } as never);
  vi.mocked(estimateGas).mockResolvedValue(BigInt(100000));
  vi.mocked(estimateFeesPerGas).mockResolvedValue({ maxFeePerGas: BigInt(1) } as never);
  vi.mocked(readContract).mockResolvedValue(BigInt("1000000000000000000"));
  vi.mocked(writeContract).mockResolvedValue(hash); vi.mocked(sendTransaction).mockResolvedValue(hash);
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "success" } as never);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("independent adversarial review of final server authority", () => {
  it("blocks a fresh LI.FI breakdown flag even for a reviewed native pin and missing independent providers", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      return Response.json({ chainId: Number(query.get("chain")), address: query.get("token"), decimals: 18,
        symbol: "ETH", name: "Ether", priceUSD: "1", verificationStatus: "verified",
        verificationStatusBreakdown: [{ provider: "first", result: "verified" }, { provider: "second", result: "flagged" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await authorize();
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("QUOTE_VALIDATION_FAILED");
    expect(fetchMock).toHaveBeenCalled();
    expect((await journal.readSecurityEvents()).events.some(event => event.event === "QUOTE_TOKEN_MISMATCH")).toBe(true);
    expect((await readTrustedRegistry()).version).toBe(1);
  });

  it("retains a server-observed flagged identity during a later outage and process restart", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      return Response.json({ chainId: Number(query.get("chain")), address: query.get("token"), decimals: 18,
        symbol: "ETH", name: "Ether", priceUSD: "1", verificationStatus: "flagged" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await authorize()).status).toBe(422);
    const observed = await journal.readSecurityEvents();
    expect.soft(observed.events.some(event => event.event === "QUOTE_TOKEN_MISMATCH" && event.assetId !== "unknown"
      && event.chainId === 8453 && event.registryAddress === null && event.details?.reason === "token_flagged"
      && event.severity === "critical")).toBe(true);
    // Losing the provider must never turn its prior negative observation into permission.
    fetchMock.mockRejectedValue(new Error("mocked provider transport unavailable"));
    expect.soft((await authorize()).status).toBe(422);
    vi.resetModules();
    const restarted = await import("../app/api/security/validate/route");
    const request = intent();
    const response = await restarted.POST(new Request("http://localhost:3000/api/security/validate", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ mode: "quote", intent: request, quote: request }) }));
    expect.soft(response.status).toBe(422); expect.soft((await response.json()).authorized).not.toBe(true);
  });

  it("requires explicit local resolution of a persisted flag and blocks new flags after that review", async () => {
    const clockStart = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(clockStart);
    let verdict = "flagged";
    const fetchMock = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      return Response.json({ chainId: Number(query.get("chain")), address: query.get("token"), decimals: 18,
        symbol: "ETH", name: "Ether", priceUSD: "1", verificationStatus: verdict });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await authorize()).status).toBe(422);
    verdict = "verified"; vi.setSystemTime(clockStart + 1000);
    expect((await authorize()).status).toBe(422);
    const document = await readTrustedRegistry();
    const entry = document.entries.find(token => token.chainId === 8453 && token.type === "native")!;
    await applyRegistryChange({ operation: "resolve", assetId: entry.assetId, chainId: entry.chainId,
      oldAddress: entry.address, newAddress: entry.address, expectedVersion: document.version,
      reason: "Explicit independent test review of observed flag", externalEvidence: ["mocked-reviewed-flag-evidence"],
      approvedBy: "independent-test", approvedAt: new Date().toISOString() });
    fetchMock.mockRejectedValue(new Error("mocked provider transport unavailable"));
    expect((await authorize()).status).toBe(200);
    vi.setSystemTime(clockStart + 2000); verdict = "flagged";
    fetchMock.mockImplementation(async (url: string) => {
      const query = new URL(url).searchParams;
      return Response.json({ chainId: Number(query.get("chain")), address: query.get("token"), decimals: 18,
        symbol: "ETH", name: "Ether", priceUSD: "1", verificationStatus: verdict });
    });
    expect((await authorize()).status).toBe(422);
    fetchMock.mockRejectedValue(new Error("mocked provider transport unavailable"));
    expect((await authorize()).status).toBe(422);
  });

  it.each(["ambiguous_deployment", "ambiguous_asset", "asset_id_mismatch", "native_asset_mismatch", "invalid_response", "response_too_large"])("does not treat positive malformed identity evidence %s as an outage", async reason => {
    vi.spyOn(resolver, "resolveTokenSources").mockImplementation(async entry => ({ results: [],
      unavailable: [{ provider: "coingecko", chainId: entry.chainId, reason }] }));
    const response = await authorize();
    expect(response.status).toBe(422);
    expect((await response.json()).authorized).not.toBe(true);
    expect((await journal.readSecurityEvents()).events.some(event => event.event === "QUOTE_TOKEN_MISMATCH")).toBe(true);
  });

  it("allows actual transport outages for existing pins without silently approving an unknown address", async () => {
    vi.spyOn(resolver, "resolveTokenSources").mockImplementation(async entry => ({ results: [], unavailable: [
      { provider: "coingecko", chainId: entry.chainId, reason: "access_unavailable" },
      { provider: "coinmarketcap", chainId: entry.chainId, reason: "rate_limited" },
      { provider: "lifi", chainId: entry.chainId, reason: "upstream_unavailable" },
    ] }));
    expect((await authorize()).status).toBe(200);
    const foreign = { ...intent(), fromTokenAddress: "0x9999999999999999999999999999999999999999" };
    const rejected = await authorize(foreign);
    expect(rejected.status).toBe(422); expect((await rejected.json()).error).toBe("TOKEN_NOT_IN_REGISTRY");
    expect((await readTrustedRegistry()).entries).toHaveLength(39);
  });

  it("detects registry revocation during the final awaited journal read", async () => {
    vi.spyOn(resolver, "resolveTokenSources").mockResolvedValue({ results: [], unavailable: [] });
    const document = await readTrustedRegistry();
    const entry = document.entries.find(token => token.chainId === 8453 && token.type === "native")!;
    const originalRead = journal.readSecurityEvents;
    let reads = 0;
    vi.spyOn(journal, "readSecurityEvents").mockImplementation(async () => {
      const result = await originalRead();
      // Two per-token journal reads precede the final whole-intent journal check.
      if (++reads === 3) await applyRegistryChange({ operation: "disable", assetId: entry.assetId, chainId: entry.chainId,
        oldAddress: entry.address, newAddress: entry.address, expectedVersion: document.version,
        reason: "Independent test revocation during journal read", externalEvidence: ["mocked-administrator-review"],
        approvedBy: "independent-test", approvedAt: new Date().toISOString() });
      return result;
    });
    const response = await authorize();
    expect(response.status).toBe(422); expect((await response.json()).error).toBe("QUOTE_VALIDATION_FAILED");
    expect((await readTrustedRegistry()).version).toBe(2);
  });
});

describe("independent balance changes during server authorization", () => {
  it.each(["native", "token"])("blocks Rango final signing when %s funds disappear while authorization awaits", async asset => {
    const { input, data, route } = tokenSwap();
    vi.mocked(rangoRequest).mockResolvedValue(data);
    const authorizeTransaction = vi.fn(async () => {
      if (asset === "native") vi.mocked(getBalance).mockResolvedValue({ value: BigInt(0) } as never);
      else vi.mocked(readContract).mockImplementation(async (_config, request) => request.functionName === "allowance" ? BigInt(input.fromAmount) : BigInt(0));
    });
    await expect(executeRangoRoute(route, input, vi.fn(), vi.fn(), authorizeTransaction)).rejects.toThrow(/balance|fees/i);
    expect(authorizeTransaction).toHaveBeenCalledOnce();
    expect(sendTransaction).not.toHaveBeenCalled(); expect(writeContract).not.toHaveBeenCalled();
  });

  it("blocks 1Click before intention persistence when tokens disappear during authorization", async () => {
    const fromToken = getCatalogToken(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;
    const toToken = getCatalogToken(1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")!;
    const params = { fromChainId: 8453, toChainId: 1, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address,
      fromAddress: wallet, fromAmount: "1000000" };
    const route: OneClickNormalizedRoute = { ...params, provider: "oneclick", id: "review-oneclick", toAmount: "1000000",
      toAmountMin: "995000", gasCostUSD: null, toolLabel: "1Click", durationSeconds: 30, expiresAt: Date.now() + 30_000,
      raw: { fromToken, toToken, minAmountOut: "995000" } };
    vi.spyOn(oneClickClient, "fetchOneClickQuote").mockResolvedValue({ amountIn: params.fromAmount, amountOut: "1000000", minAmountOut: "995000",
      timeEstimate: 30, depositAddress: "0x2222222222222222222222222222222222222222", deadline: new Date(Date.now() + 120_000).toISOString() } as oneClickClient.OneClickQuote);
    const onPending = vi.fn();
    await expect(executeOneClickRoute(route, params, vi.fn(), { confirm: () => true, onPending }, async () => {
      vi.mocked(readContract).mockResolvedValue(BigInt(0));
    })).rejects.toThrow(/token balance/i);
    expect(writeContract).not.toHaveBeenCalled(); expect(onPending).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@lifi/sdk", () => ({ getStatus: vi.fn() }));
vi.mock("../lib/aggregators/lifi/client", () => ({ getLifiSdkClient: () => ({}) }));
vi.mock("../lib/aggregators/rango/client", () => ({ rangoRequest: vi.fn() }));
import { getStatus } from "@lifi/sdk";
import { rangoRequest } from "../lib/aggregators/rango/client";
import { buildIntentSeed, readIntentJournal, withIntentExecution, type IntentRecord } from "../lib/intent/journal";
import { trackIntentRecord } from "../lib/intent/tracking";
import { quote, params, wallet } from "./fixtures";
import { normalizedRango, pendingRangoIntent, rangoTo } from "./rango-fixtures";
import type { PendingOneClickV1 } from "../lib/aggregators/oneclick/types";
import type { OneClickNormalizedRoute } from "../lib/types/normalized-route";

const hash = `0x${"a".repeat(64)}` as `0x${string}`;
const destinationHash = `0x${"b".repeat(64)}`;
const from = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const to = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" as const;
function pendingOneClick(): PendingOneClickV1 {
  const deadline = "2026-01-01T00:00:00.000Z";
  const originToken = { blockchain: "base", contractAddress: from, decimals: 6, symbol: "USDC", assetId: "nep141:base-usdc.omft.near" };
  const destinationToken = { blockchain: "eth", contractAddress: to, decimals: 6, symbol: "USDC", assetId: "nep141:eth-usdc.omft.near" };
  const depositAddress = "0x2222222222222222222222222222222222222222";
  return { version: 1, wallet, fromChainId: 8453, toChainId: 1, depositAddress, amount: "100000000", minimum: "98000000", status: "PENDING_DEPOSIT",
    fromTokenAddress: from, toTokenAddress: to, fromTokenDecimals: 6, toTokenDecimals: 6, submittedAt: Date.parse("2025-12-31T23:50:00.000Z"), originToken, destinationToken,
    quoteResponse: { correlationId: "test-quote", timestamp: "2025-12-31T23:50:00.000Z", signature: "provider-signature",
      quoteRequest: { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 50, originAsset: originToken.assetId,
        destinationAsset: destinationToken.assetId, amount: "100000000", depositType: "ORIGIN_CHAIN", refundTo: wallet,
        refundType: "ORIGIN_CHAIN", recipient: wallet, recipientType: "DESTINATION_CHAIN", deadline, depositMode: "SIMPLE" },
      quote: { amountIn: "100000000", amountOut: "99000000", minAmountOut: "98000000", timeEstimate: 60, depositAddress, deadline } } };
}
async function record(provider: "lifi" | "rango" | "oneclick"): Promise<IntentRecord> {
  const pending = pendingOneClick();
  const request = provider === "oneclick" ? { ...params, fromTokenAddress: from, toTokenAddress: to, fromAmount: pending.amount } : params;
  const oneclick: OneClickNormalizedRoute = { ...quote(), ...request, provider: "oneclick", id: "oneclick:quote", toAmountMin: pending.minimum,
    raw: { fromToken: { chainId: 8453, address: from, decimals: 6, symbol: "USDC", name: "USDC", priceUSD: "1" }, toToken: { chainId: 1, address: to, decimals: 6, symbol: "USDC", name: "USDC", priceUSD: "1" }, minAmountOut: pending.minimum } };
  const route = provider === "oneclick" ? oneclick : provider === "rango" ? normalizedRango() : quote();
  await withIntentExecution(buildIntentSeed(route, request), async session => {
    session.saveProviderState(provider === "oneclick" ? pending : provider === "rango" ? pendingRangoIntent() : route.raw);
    const action = await session.beforeAction({ kind: provider === "oneclick" ? "deposit" : "swap", chainId: 8453, to: wallet, data: "0x12345678", value: "0", nonce: 17 });
    session.sent(action, hash);
  });
  // Restoration uses only the multi-intent journal; both old single-record keys
  // are absent and providerState deliberately lacks a source hash.
  expect(localStorage.getItem("hermes-rango-pending-v1")).toBeNull();
  expect(localStorage.getItem("hermes:oneclick:latest")).toBeNull();
  return JSON.parse(JSON.stringify(readIntentJournal()[0]));
}
beforeEach(() => { vi.clearAllMocks(); });

describe("read-only reload tracking from the multi-intent journal", () => {
  it("rebuilds LI.FI tracking from the immutable seed and source action hash without SDK execution/resume", async () => {
    const saved = await record("lifi");
    vi.mocked(getStatus).mockResolvedValue({ status: "DONE", substatus: "COMPLETED", tool: "bridge", fromAddress: wallet, toAddress: wallet,
      sending: { chainId: 8453, txHash: hash }, receiving: { chainId: 1, txHash: destinationHash, token: saved.seed!.toToken, amount: saved.seed!.minimum } } as never);
    const result = await trackIntentRecord(saved);
    expect(result).toMatchObject({ status: "delivered", evidence: { proof: "provider", sourceHash: hash, destinationHash } });
    expect(getStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ txHash: hash, fromChain: 8453, toChain: 1, bridge: "bridge" }), expect.anything());
    expect(saved.actions).toHaveLength(1);
  });
  it.each(["PARTIAL", "REFUNDED"])("retains LI.FI %s as a blocked non-delivery after reload", async substatus => {
    const saved = await record("lifi");
    vi.mocked(getStatus).mockResolvedValue({ status: "DONE", substatus, tool: "bridge", sending: { chainId: 8453, txHash: hash } } as never);
    const result = await trackIntentRecord(saved);
    expect(result.status).toBe(substatus === "PARTIAL" ? "alternative_output" : "refund_pending");
  });
  it("tracks Rango from saved providerState and source hash with one bounded status query", async () => {
    const saved = await record("rango");
    vi.mocked(rangoRequest).mockResolvedValue({ status: "success", output: { type: "DESIRED_OUTPUT", amount: "950000000000000", receivedToken: rangoTo } });
    expect(await trackIntentRecord(saved)).toMatchObject({ status: "delivered", providerState: { txHash: hash, journalId: saved.id } });
    expect(rangoRequest).toHaveBeenCalledOnce(); expect(rangoRequest).toHaveBeenCalledWith("status", expect.objectContaining({ txId: hash }));
  });
  it("rejects altered Rango destination identity before any status request", async () => {
    const saved = await record("rango"); (saved.providerState as ReturnType<typeof pendingRangoIntent>).minimum = "1";
    expect(await trackIntentRecord(saved)).toMatchObject({ status: "intervention_required" }); expect(rangoRequest).not.toHaveBeenCalled();
  });
  it("tracks a complete expired 1Click quote from providerState without an executable quote or wallet", async () => {
    const saved = await record("oneclick"); const pending = pendingOneClick();
    const response = { status: "SUCCESS", quoteResponse: pending.quoteResponse, swapDetails: { amountIn: pending.amount, amountOut: "99000000", originChainTxHashes: [{ hash }], destinationChainTxHashes: [{ hash: destinationHash }] } };
    const fetcher = vi.fn(async (_url: string) => Response.json(response)); vi.stubGlobal("fetch", fetcher);
    expect(await trackIntentRecord(saved)).toMatchObject({ status: "delivered", providerState: { status: "SUCCESS", hash, journalId: saved.id } });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toContain("/api/oneclick/status?");
  });
  it("bounds a malformed/oversized 1Click response and retains pending without requesting another deposit", async () => {
    const saved = await record("oneclick"); const fetcher = vi.fn(async () => new Response("x".repeat(70_000))); vi.stubGlobal("fetch", fetcher);
    expect(await trackIntentRecord(saved)).toMatchObject({ status: "destination_pending", evidence: { reason: "tracking_unavailable" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not poll or sign an ambiguous record or legacy record without a full seed", async () => {
    const saved = await record("lifi"); saved.actions[0].status = "ambiguous";
    expect(await trackIntentRecord(saved)).toMatchObject({ status: "intervention_required" });
    saved.seed = null; expect(await trackIntentRecord(saved)).toMatchObject({ status: "intervention_required" });
    expect(getStatus).not.toHaveBeenCalled(); expect(rangoRequest).not.toHaveBeenCalled();
  });
});

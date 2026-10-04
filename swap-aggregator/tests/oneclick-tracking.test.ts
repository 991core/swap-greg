import { expect, it } from "vitest";
import { isActiveOneClick, readPendingOneClick, safeOneClickUrl, updatePendingOneClick } from "../lib/aggregators/oneclick/tracking";
import type { PendingOneClickV1 } from "../lib/aggregators/oneclick/types";

const wallet = "0x1111111111111111111111111111111111111111";
const depositAddress = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}` as `0x${string}`;
function pending(): PendingOneClickV1 {
  // Tracking remains valid after quote expiry; expiry never releases a deposit.
  const deadline = "2026-01-01T00:00:00.000Z";
  const originToken = { blockchain: "base", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, symbol: "USDC", assetId: "nep141:base-usdc.omft.near" };
  const destinationToken = { blockchain: "eth", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, symbol: "USDC", assetId: "nep141:eth-usdc.omft.near" };
  return { version: 1, wallet, fromChainId: 8453, toChainId: 1, depositAddress, hash, amount: "100000000", minimum: "98000000", status: "PENDING_DEPOSIT",
    fromTokenAddress: originToken.contractAddress as `0x${string}`, toTokenAddress: destinationToken.contractAddress as `0x${string}`,
    fromTokenDecimals: 6, toTokenDecimals: 6,
    submittedAt: Date.parse("2025-12-31T23:50:00.000Z"), originToken, destinationToken,
    quoteResponse: { correlationId: "test-quote", timestamp: "2025-12-31T23:50:00.000Z", signature: "provider-signature",
      quoteRequest: { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 50, originAsset: originToken.assetId,
        destinationAsset: destinationToken.assetId, amount: "100000000", depositType: "ORIGIN_CHAIN", refundTo: wallet,
        refundType: "ORIGIN_CHAIN", recipient: wallet, recipientType: "DESTINATION_CHAIN", deadline, depositMode: "SIMPLE" },
      quote: { amountIn: "100000000", amountOut: "99000000", minAmountOut: "98000000", timeEstimate: 60, depositAddress, deadline } } };
}
function delivered(record = pending()) {
  return { status: "SUCCESS", quoteResponse: structuredClone(record.quoteResponse), swapDetails: { amountIn: "100000000", amountOut: "99000000",
    originChainTxHashes: [{ hash }], destinationChainTxHashes: [{ hash: `0x${"b".repeat(64)}`, explorerUrl: "https://etherscan.io/tx/test" }] } };
}
it("restores a complete expired record without authorizing a new deposit", () => {
  const restored = readPendingOneClick(JSON.stringify(pending()));
  expect(restored).toMatchObject({ version: 1, hash, status: "PENDING_DEPOSIT", minimum: "98000000" });
  expect(isActiveOneClick(restored)).toBe(true);
});
it("accepts matching delivery and preserves terminal state despite later regressions", () => {
  const success = updatePendingOneClick(pending(), delivered());
  expect(success).toMatchObject({ status: "SUCCESS", destinationUrl: "https://etherscan.io/tx/test" });
  expect(isActiveOneClick(success)).toBe(false);
  expect(updatePendingOneClick(success, { status: "PENDING_DEPOSIT" })).toBe(success);
  expect(readPendingOneClick(JSON.stringify(success))).toEqual(success);
});
it.each(["SUCCESS", "FAILED", "REFUNDED"])("keeps a bare %s active", (status) => {
  const record = pending(); const result = updatePendingOneClick(record, { status });
  expect(isActiveOneClick(result)).toBe(true); expect(result).toBe(record);
});
it("does not regress processing when an earlier status arrives", () => {
  const processing = updatePendingOneClick(pending(), { ...delivered(), status: "PROCESSING" });
  expect(processing.status).toBe("PROCESSING");
  expect(updatePendingOneClick(processing, { ...delivered(), status: "PENDING_DEPOSIT" })).toBe(processing);
});
it.each(["recipient", "refundTo", "originAsset", "destinationAsset", "amount", "recipientType", "depositType", "refundType", "depositMode", "deadline", "slippageTolerance"])("rejects delivery for an altered %s", (field) => {
  const record = pending(); const response = delivered(record);
  Object.assign(response.quoteResponse.quoteRequest, { [field]: field === "slippageTolerance" ? 51 : "wrong" });
  expect(updatePendingOneClick(record, response)).toBe(record);
});
it.each(["signature", "correlationId", "timestamp"])("rejects substituted quote %s proof", (field) => {
  const record = pending(); const response = delivered(record);
  Object.assign(response.quoteResponse, { [field]: field === "timestamp" ? "2025-12-30T00:00:00Z" : "different" });
  expect(updatePendingOneClick(record, response)).toBe(record);
});
it.each(["minimum", "source hash", "destination hash", "input", "deposit"])("keeps nonconforming %s output pending", (kind) => {
  const record = pending(); const response = delivered(record);
  if (kind === "minimum") response.swapDetails.amountOut = "97999999";
  if (kind === "source hash") response.swapDetails.originChainTxHashes[0].hash = `0x${"c".repeat(64)}`;
  if (kind === "destination hash") response.swapDetails.destinationChainTxHashes[0].hash = "javascript:bad";
  if (kind === "input") response.swapDetails.amountIn = "1";
  if (kind === "deposit") response.quoteResponse.quote.depositAddress = wallet;
  expect(isActiveOneClick(updatePendingOneClick(record, response))).toBe(true);
});
it("preserves a before-hash intention through tracking responses", () => {
  const record = pending(); delete record.hash; record.status = "UNKNOWN";
  expect(readPendingOneClick(JSON.stringify(record))).toMatchObject({ status: "UNKNOWN" });
  expect(isActiveOneClick(updatePendingOneClick(record, delivered()))).toBe(true);
});
it("retains recognized legacy records without fabricating destination proof", () => {
  const record = { wallet, fromChainId: 8453, depositAddress, hash, status: "SUCCESS", destinationUrl: "https://evil.invalid" };
  const legacy = readPendingOneClick(JSON.stringify(record));
  expect(legacy).toEqual({ version: 0, wallet, fromChainId: 8453, depositAddress, hash, status: "UNKNOWN" });
  expect(isActiveOneClick(legacy)).toBe(true);
  expect(updatePendingOneClick(legacy!, delivered())).toBe(legacy);
});
it.each([
  { version: 2 }, { fromChainId: 999 }, { toChainId: 999 }, { wallet: "invalid" }, { hash: "invalid" },
  { amount: "100000001" }, { minimum: "1" }, { status: "invented" }, { destinationToken: { decimals: 18 } },
])("rejects malformed persisted proof %j", (alteration) => {
  expect(readPendingOneClick(JSON.stringify({ ...pending(), ...alteration }))).toBeNull();
});
it("does not trust a forged terminal status without matching delivery", () => {
  expect(readPendingOneClick(JSON.stringify({ ...pending(), status: "SUCCESS" }))).toMatchObject({ status: "PROCESSING" });
  expect(readPendingOneClick(JSON.stringify({ ...pending(), status: "FAILED" }))).toMatchObject({ status: "UNKNOWN" });
  expect(readPendingOneClick(JSON.stringify({ ...pending(), status: "FAILED", sourceOutcome: "reverted" }))).toMatchObject({ status: "FAILED" });
});
it.each(["javascript:alert(1)", "http://etherscan.io", "https://user:secret@example.org", "https://example.org\\evil", "https://example.org/\nunsafe"])("discards unsafe explorer URL %s", (url) => {
  const response = delivered(); response.swapDetails.destinationChainTxHashes[0].explorerUrl = url;
  const success = updatePendingOneClick(pending(), response);
  expect(success.status).toBe("SUCCESS"); expect(success.destinationUrl).toBeUndefined(); expect(safeOneClickUrl(url)).toBeUndefined();
});

it.each(["decimals", "contractAddress", "blockchain"])("rejects altered full destination %s metadata in persisted records", (field) => {
  const record = pending(); Object.assign(record.destinationToken, { [field]: field === "decimals" ? 18 : field === "blockchain" ? "base" : wallet });
  expect(readPendingOneClick(JSON.stringify(record))).toBeNull();
});

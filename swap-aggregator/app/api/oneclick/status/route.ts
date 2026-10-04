import { withApiGuard } from "@/lib/server/api";
import { NextResponse } from "next/server";
import { isAddress, zeroAddress } from "viem";
import { oneClickRequest, runOneClickOperation, validateOneClickOrigin, OneClickApiError, oneClickErrorResponse, ONECLICK_RESPONSE_HEADERS } from "@/lib/aggregators/oneclick/server";
import { isOneClickRecord, isOneClickAmount, validateOneClickQuoteResponse, type OneClickQuoteRequest, type OneClickSwapDetails } from "@/lib/aggregators/oneclick/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function hashes(value: unknown): Array<{ hash: string; explorerUrl?: string }> | undefined {
  if (!Array.isArray(value) || value.length > 64) return;
  const result: Array<{ hash: string; explorerUrl?: string }> = [];
  for (const item of value) {
    if (!isOneClickRecord(item) || typeof item.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item.hash)) return;
    let explorerUrl: string | undefined;
    if (typeof item.explorerUrl === "string" && item.explorerUrl.length <= 2048) {
      try { const url = new URL(item.explorerUrl); if (url.protocol === "https:" && !url.username && !url.password) explorerUrl = url.href; } catch { /* Hash remains usable without an explorer. */ }
    }
    result.push({ hash: item.hash, ...(explorerUrl ? { explorerUrl } : {}) });
  }
  return result;
}
export async function GET(request: Request) {
  return withApiGuard("oneclick.status", request, () => handle(request));
}
async function handle(request: Request) {
  try {
    validateOneClickOrigin(request);
    const url = new URL(request.url);
    const depositAddress = url.searchParams.get("depositAddress");
    if (!depositAddress || !isAddress(depositAddress) || depositAddress.toLowerCase() === zeroAddress ||
        [...url.searchParams.keys()].some(key => key !== "depositAddress") || url.searchParams.getAll("depositAddress").length !== 1) throw new OneClickApiError(400, "Invalid deposit address.");
    const result = await runOneClickOperation("status", depositAddress.toLowerCase(), async signal => {
      const data = await oneClickRequest(`/status?depositAddress=${encodeURIComponent(depositAddress)}`, { signal });
      if (!isOneClickRecord(data) || typeof data.status !== "string" || !["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"].includes(data.status)) throw new OneClickApiError(502, "Invalid 1Click status.");
      // Missing or malformed evidence can never turn a submitted deposit terminal.
      try {
        if (!isOneClickRecord(data.quoteResponse) || !isOneClickRecord(data.quoteResponse.quoteRequest)) throw new Error("Missing quote proof");
        const quoteResponse = validateOneClickQuoteResponse(data.quoteResponse, data.quoteResponse.quoteRequest as OneClickQuoteRequest, Date.now(), false);
        if (quoteResponse.quoteRequest.dry || quoteResponse.quote.depositAddress?.toLowerCase() !== depositAddress.toLowerCase()) throw new Error("Mismatched deposit");
        const details = isOneClickRecord(data.swapDetails) ? data.swapDetails : {};
        const swapDetails: OneClickSwapDetails = {
          ...(isOneClickAmount(details.amountIn) ? { amountIn: details.amountIn } : {}),
          ...(isOneClickAmount(details.amountOut) ? { amountOut: details.amountOut } : {}),
          originChainTxHashes: hashes(details.originChainTxHashes), destinationChainTxHashes: hashes(details.destinationChainTxHashes),
        };
        const completed = data.status === "SUCCESS" && swapDetails.amountIn === quoteResponse.quote.amountIn &&
          isOneClickAmount(swapDetails.amountOut) && BigInt(swapDetails.amountOut) >= BigInt(quoteResponse.quote.minAmountOut) &&
          !!swapDetails.originChainTxHashes?.length && !!swapDetails.destinationChainTxHashes?.length;
        const status = ["SUCCESS", "REFUNDED", "FAILED"].includes(data.status) && !completed ? "PROCESSING" : data.status;
        return { status, quoteResponse, swapDetails, ...(completed && swapDetails.destinationChainTxHashes?.[0]?.explorerUrl ? { destinationUrl: swapDetails.destinationChainTxHashes[0].explorerUrl } : {}) };
      } catch { return { status: "PROCESSING" }; }
    }, request.signal);
    return NextResponse.json(result, { headers: ONECLICK_RESPONSE_HEADERS });
  } catch (error) { return oneClickErrorResponse(error); }
}

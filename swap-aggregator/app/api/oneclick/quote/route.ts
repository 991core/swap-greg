import { NextResponse } from "next/server";
import { isAddress, zeroAddress } from "viem";
import { findOneClickToken, getOneClickTokens, oneClickRequest, ONECLICK_CHAINS, readOneClickJson, runOneClickOperation, OneClickApiError, oneClickErrorResponse, ONECLICK_RESPONSE_HEADERS } from "@/lib/aggregators/oneclick/server";
import { isOneClickAmount, isOneClickRecord, validateOneClickQuoteResponse, type OneClickQuoteRequest } from "@/lib/aggregators/oneclick/validation";
import { SLIPPAGE, PLATFORM_FEE } from "@/lib/routing/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await readOneClickJson(request);
    if (PLATFORM_FEE > 0) throw new OneClickApiError(503, "1Click platform fees are not configured.");
    if (!isOneClickRecord(body)) throw new OneClickApiError(400, "Invalid 1Click quote parameters.");
    const { fromChainId, toChainId, fromTokenAddress, toTokenAddress, fromTokenDecimals, toTokenDecimals, fromAmount, wallet, dry } = body;
    if (typeof fromChainId !== "number" || typeof toChainId !== "number" || !Number.isSafeInteger(fromChainId) || !Number.isSafeInteger(toChainId) ||
        !Object.hasOwn(ONECLICK_CHAINS, fromChainId) || !Object.hasOwn(ONECLICK_CHAINS, toChainId) ||
        typeof fromTokenAddress !== "string" || !isAddress(fromTokenAddress) || fromTokenAddress.toLowerCase() === zeroAddress ||
        typeof toTokenAddress !== "string" || !isAddress(toTokenAddress) ||
        (fromChainId === toChainId && fromTokenAddress.toLowerCase() === toTokenAddress.toLowerCase()) ||
        (wallet != null && (typeof wallet !== "string" || !isAddress(wallet) || wallet.toLowerCase() === zeroAddress)) ||
        (!dry && typeof wallet !== "string") || typeof dry !== "boolean" ||
        typeof fromTokenDecimals !== "number" || typeof toTokenDecimals !== "number" ||
        !Number.isInteger(fromTokenDecimals) || !Number.isInteger(toTokenDecimals) || fromTokenDecimals < 0 || toTokenDecimals < 0 || fromTokenDecimals > 255 || toTokenDecimals > 255 ||
        !isOneClickAmount(fromAmount)) throw new OneClickApiError(400, "Invalid 1Click quote parameters.");
    const recipient = typeof wallet === "string" ? wallet : zeroAddress;
    const key = JSON.stringify([fromChainId, toChainId, fromTokenAddress.toLowerCase(), toTokenAddress.toLowerCase(), fromTokenDecimals, toTokenDecimals, fromAmount, recipient.toLowerCase(), dry]);
    const result = await runOneClickOperation("quote", key, async signal => {
      const tokens = await getOneClickTokens(signal);
      const originToken = findOneClickToken(tokens, fromChainId, fromTokenAddress);
      const destinationToken = findOneClickToken(tokens, toChainId, toTokenAddress);
      if (!originToken || !destinationToken || originToken.decimals !== fromTokenDecimals || destinationToken.decimals !== toTokenDecimals || originToken.assetId === destinationToken.assetId) throw new OneClickApiError(400, "Pair not supported by 1Click.");
      const expected: OneClickQuoteRequest = {
        dry, swapType: "EXACT_INPUT", slippageTolerance: Math.round(SLIPPAGE * 10_000),
        originAsset: originToken.assetId, destinationAsset: destinationToken.assetId, amount: fromAmount,
        depositType: "ORIGIN_CHAIN", refundTo: recipient, refundType: "ORIGIN_CHAIN",
        recipient, recipientType: "DESTINATION_CHAIN", depositMode: "SIMPLE",
        deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
      };
      const quoteResponse = validateOneClickQuoteResponse(await oneClickRequest("/quote", { method: "POST", body: JSON.stringify(expected), signal }), expected);
      const quote = quoteResponse.quote;
      return { amountIn: quote.amountIn, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, timeEstimate: quote.timeEstimate,
        ...(dry ? {} : { depositAddress: quote.depositAddress, deadline: quote.deadline }),
        originToken, destinationToken, quoteResponse };
    }, request.signal);
    return NextResponse.json(result, { headers: ONECLICK_RESPONSE_HEADERS });
  } catch (error) { return oneClickErrorResponse(error); }
}

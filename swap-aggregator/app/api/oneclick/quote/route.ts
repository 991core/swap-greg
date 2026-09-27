import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { findOneClickToken, getOneClickTokens, oneClickRequest, ONECLICK_CHAINS } from "@/lib/aggregators/oneclick/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fromChainId, toChainId, fromTokenAddress, toTokenAddress, fromTokenDecimals, toTokenDecimals, fromAmount, wallet, dry } = body ?? {};
    if (!Number.isInteger(fromChainId) || !Number.isInteger(toChainId) ||
        !ONECLICK_CHAINS[fromChainId] || !ONECLICK_CHAINS[toChainId] ||
        !isAddress(fromTokenAddress) || !isAddress(toTokenAddress) || !isAddress(wallet) ||
        !Number.isInteger(fromTokenDecimals) || !Number.isInteger(toTokenDecimals) ||
        typeof fromAmount !== "string" || !/^[1-9]\d{0,77}$/.test(fromAmount) ||
        typeof dry !== "boolean") {
      return NextResponse.json({ error: "Invalid 1Click quote parameters" }, { status: 400 });
    }
    const tokens = await getOneClickTokens();
    const origin = findOneClickToken(tokens, fromChainId, fromTokenAddress);
    const destination = findOneClickToken(tokens, toChainId, toTokenAddress);
    if (!origin || !destination || origin.decimals !== fromTokenDecimals || destination.decimals !== toTokenDecimals) {
      return NextResponse.json({ error: "Pair not supported by 1Click" }, { status: 400 });
    }
    const result = await oneClickRequest("/quote", {
      method: "POST",
      body: JSON.stringify({
        dry,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: destination.assetId,
        amount: fromAmount,
        depositType: "ORIGIN_CHAIN",
        refundTo: wallet,
        refundType: "ORIGIN_CHAIN",
        recipient: wallet,
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
      }),
    }) as { quote?: { amountIn?: string; amountOut?: string; minAmountOut?: string; timeEstimate?: number; depositAddress?: string; depositMemo?: string; deadline?: string }; quoteRequest?: { originAsset?: string; destinationAsset?: string; amount?: string; depositMode?: string } };
    const quote = result.quote;
    if (!quote || quote.amountIn !== fromAmount || !/^\d+$/.test(quote.amountOut ?? "") ||
        !/^\d+$/.test(quote.minAmountOut ?? "") ||
        (result.quoteRequest?.originAsset && result.quoteRequest.originAsset !== origin.assetId) ||
        (result.quoteRequest?.destinationAsset && result.quoteRequest.destinationAsset !== destination.assetId) ||
        (result.quoteRequest?.amount && result.quoteRequest.amount !== fromAmount)) {
      throw new Error("Invalid 1Click quote response");
    }
    if (!dry && (result.quoteRequest?.depositMode === "MEMO" || quote.depositMemo ||
        !quote.depositAddress || !isAddress(quote.depositAddress) || !quote.deadline ||
        Date.parse(quote.deadline) <= Date.now() + 30_000)) {
      throw new Error("Unsupported 1Click deposit instructions or expired quote");
    }
    return NextResponse.json({
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      timeEstimate: quote.timeEstimate ?? 0,
      ...(dry ? {} : { depositAddress: quote.depositAddress, deadline: quote.deadline }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "1Click unavailable" }, { status: 502 });
  }
}

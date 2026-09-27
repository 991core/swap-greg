import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { oneClickRequest } from "@/lib/aggregators/oneclick/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const depositAddress = new URL(request.url).searchParams.get("depositAddress");
  if (!depositAddress || !isAddress(depositAddress)) {
    return NextResponse.json({ error: "Invalid deposit address" }, { status: 400 });
  }
  try {
    const result = await oneClickRequest(`/status?depositAddress=${encodeURIComponent(depositAddress)}`) as {
      status?: string;
      swapDetails?: { destinationChainTxHashes?: Array<{ explorerUrl?: string }> };
    };
    return NextResponse.json({
      status: result.status,
      destinationUrl: result.swapDetails?.destinationChainTxHashes?.[0]?.explorerUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "1Click unavailable" }, { status: 502 });
  }
}

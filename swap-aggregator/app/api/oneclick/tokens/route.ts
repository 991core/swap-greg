import { NextResponse } from "next/server";
import { getOneClickTokens, ONECLICK_CHAINS } from "@/lib/aggregators/oneclick/server";
import { isTop20Symbol } from "@/lib/topTokens";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tokens = await getOneClickTokens();
    return NextResponse.json(tokens.filter((token) =>
      Object.values(ONECLICK_CHAINS).includes(token.blockchain) &&
      (isTop20Symbol(token.symbol) || (token.blockchain === "gnosis" && token.symbol === "EURe")),
    ));
  } catch {
    return NextResponse.json({ error: "1Click token registry unavailable" }, { status: 502 });
  }
}

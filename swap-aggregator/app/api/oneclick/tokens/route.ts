import { NextResponse } from "next/server";
import { getOneClickTokens, ONECLICK_CHAINS } from "@/lib/aggregators/oneclick/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tokens = await getOneClickTokens();
    return NextResponse.json(tokens.filter((token) =>
      Object.values(ONECLICK_CHAINS).includes(token.blockchain),
    ));
  } catch {
    return NextResponse.json({ error: "1Click token registry unavailable" }, { status: 502 });
  }
}

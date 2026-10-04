import { NextResponse } from "next/server";
import { searchTokensOnServer } from "@/lib/tokens/search.server";
import { parseTokenSearch } from "@/lib/tokens/validation";
import { TokenSearchError } from "@/lib/tokens/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const input = parseTokenSearch(new URL(request.url).searchParams);
    return NextResponse.json(await searchTokensOnServer(input), { headers });
  } catch (error) {
    const known = error instanceof TokenSearchError ? error : new TokenSearchError("tokens_unavailable");
    return NextResponse.json({ error: known.code }, { status: known.status,
      headers: { ...headers, ...(known.status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}

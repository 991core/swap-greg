import { withApiGuard } from "@/lib/server/api";
import { NextResponse } from "next/server";
import { getMarketUniverse } from "@/lib/security/universe.server";
import { SecurityProviderError } from "@/lib/security/providers/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  return withApiGuard("tokens.universe", request, () => handle(request));
}
async function handle(request: Request) {
  try {
    if (new URL(request.url).search) return NextResponse.json({ error: "invalid_parameters" }, { status: 400, headers });
    return NextResponse.json(await getMarketUniverse(), { headers });
  } catch (error) {
    const status = error instanceof SecurityProviderError && error.status === 429 ? 429 : 503;
    return NextResponse.json({ error: "market_universe_unavailable" }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}

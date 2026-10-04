import { NextResponse } from "next/server";
import { getMarketUniverse } from "@/lib/security/universe.server";
import { SecurityProviderError } from "@/lib/security/providers/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
let windowStart = 0; let requestsInWindow = 0;
export async function GET(request: Request) {
  try {
    const target = new URL(request.url); const origin = request.headers.get("origin");
    if (origin) {
      let source: URL; try { source = new URL(origin); } catch { return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers }); }
      const host = request.headers.get("host") ?? target.host;
      const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? target.protocol.slice(0, -1);
      if (source.host.toLowerCase() !== host.toLowerCase() || source.protocol !== `${protocol}:` || !["http", "https"].includes(protocol) || source.username || source.password) return NextResponse.json({ error: "cross_origin_rejected" }, { status: 403, headers });
    }
    if (target.search) return NextResponse.json({ error: "invalid_parameters" }, { status: 400, headers });
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requestsInWindow = 0; }
    if (++requestsInWindow > 60) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    return NextResponse.json(await getMarketUniverse(), { headers });
  } catch (error) {
    const status = error instanceof SecurityProviderError && error.status === 429 ? 429 : 503;
    return NextResponse.json({ error: "market_universe_unavailable" }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}

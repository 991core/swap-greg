import { NextResponse } from "next/server";
import { RangoApiError, requestRangoOnServer } from "@/lib/aggregators/rango/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { operation: string } }) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const origin = request.headers.get("origin");
    if (origin) {
      const target = new URL(request.url);
      // Next may use an internal localhost URL. Compare the actual HTTP Host,
      // retaining protocol/port checks (TLS proxies provide forwarded-proto).
      const host = request.headers.get("host") ?? target.host;
      const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? target.protocol.slice(0, -1);
      let source: URL;
      try { source = new URL(origin); } catch { throw new RangoApiError(403, "Invalid origin."); }
      if (source.host.toLowerCase() !== host.toLowerCase() || source.protocol !== `${protocol}:` || !["http", "https"].includes(protocol)) throw new RangoApiError(403, "Cross-origin request rejected.");
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RangoApiError(415, "JSON required.");
    if (Number(request.headers.get("content-length")) > 4096) throw new RangoApiError(413, "Request too large.");
    const text = await request.text();
    if (text.length > 4096) throw new RangoApiError(413, "Request too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new RangoApiError(400, "Invalid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RangoApiError(400, "Invalid request.");
    return NextResponse.json(await requestRangoOnServer(params.operation, body as Record<string, unknown>, request.signal), { headers });
  } catch (error) {
    const known = error instanceof RangoApiError ? error : new RangoApiError(502, "Rango is unavailable.");
    return NextResponse.json({ error: known.message }, { status: known.status, headers: {
      ...headers, ...(known.status === 429 ? { "Retry-After": "60" } : {}),
    } });
  }
}

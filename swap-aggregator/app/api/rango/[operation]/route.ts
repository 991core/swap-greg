import { NextResponse } from "next/server";
import { ApiBoundaryError, readApiJson, serverCanPrepareExecution, withApiGuard } from "@/lib/server/api";
import { RangoApiError, requestRangoOnServer } from "@/lib/aggregators/rango/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  return withApiGuard(`rango.${operation}`, request, () => handle(request, operation));
}
async function handle(request: Request, operation: string) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    if (operation === "swap" && !serverCanPrepareExecution()) throw new RangoApiError(403, "New execution preparation is disabled.");
    const body = await readApiJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RangoApiError(400, "Invalid request.");
    return NextResponse.json(await requestRangoOnServer(operation, body as Record<string, unknown>, request.signal), { headers });
  } catch (error) {
    const known = error instanceof ApiBoundaryError ? new RangoApiError(error.status, error.code) : error instanceof RangoApiError ? error : new RangoApiError(502, "Rango is unavailable.");
    return NextResponse.json({ error: known.message }, { status: known.status, headers: {
      ...headers, ...(known.status === 429 ? { "Retry-After": "60" } : {}),
      ...(known.message === "Rango fee configuration is incomplete." ? { "X-Hermes-Error-Code": "provider_configuration" } : {}),
    } });
  }
}

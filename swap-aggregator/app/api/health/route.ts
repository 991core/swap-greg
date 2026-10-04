export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Local process health, no secrets, remote dependency or swap preparation. */
export async function GET() {
  return Response.json({ status: "ok", service: "hermes" }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

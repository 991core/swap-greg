import { serverCanPrepareExecution, API_HEADERS } from "@/lib/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Read before new wallet actions. Tracking remains available during incidents. */
export async function GET() {
  return Response.json({ executionEnabled: serverCanPrepareExecution() }, { headers: API_HEADERS });
}

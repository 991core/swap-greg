import { withApiGuard } from "@/lib/server/api";
import { NextResponse } from "next/server";
import { getOneClickTokens, runOneClickOperation, validateOneClickOrigin, oneClickErrorResponse, ONECLICK_RESPONSE_HEADERS } from "@/lib/aggregators/oneclick/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return withApiGuard("oneclick.tokens", request, () => handle(request));
}
async function handle(request: Request) {
  try {
    validateOneClickOrigin(request);
    const tokens = await runOneClickOperation("tokens", "registry", signal => getOneClickTokens(signal), request.signal);
    return NextResponse.json(tokens, { headers: ONECLICK_RESPONSE_HEADERS });
  } catch (error) { return oneClickErrorResponse(error); }
}

import { NextResponse } from "next/server";
import { readTrustedRegistry } from "@/lib/security/registry.server";
import { readSecurityConfig } from "@/lib/security/config.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const config = readSecurityConfig();
    const registry = await readTrustedRegistry();
    return NextResponse.json({ registry, executionConfigured: config.lifiAllowedContracts.length > 0 || config.allowedDepositReceivers.length > 0 }, { headers });
  } catch { return NextResponse.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503, headers }); }
}

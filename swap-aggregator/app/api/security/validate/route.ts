import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readTrustedRegistry, lookupTrustedToken } from "@/lib/security/registry.server";
import { readSecurityConfig } from "@/lib/security/config.server";
import { readSecurityEvents, writeSecurityEvents } from "@/lib/security/events.server";
import { resolveTokenSources } from "@/lib/security/resolver.server";
import { verifyTokenConsensus } from "@/lib/security/consensus";
import { validateSwapQuote, SecurityValidationError, type SecuritySwapIntent } from "@/lib/security/quote-validator";
import { validateTransaction, type TransactionCandidate, type TransactionContext } from "@/lib/security/transaction-validator";
import { isSupportedSecurityChain } from "@/lib/security/identity";
import type { SecurityEventDocument, TrustedTokenEntry, TrustedRegistryDocument } from "@/lib/security/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
let windowStart = 0; let used = 0; let active = 0;
function hasPersistentFlag(journal: SecurityEventDocument, entry: TrustedTokenEntry, registry: TrustedRegistryDocument) {
  return journal.events.some(event => event.assetId === entry.assetId && event.chainId === entry.chainId && event.registryAddress === entry.address && event.action === "blocked" && event.details?.reason === "token_flagged" &&
    !registry.history.some(revision => revision.operation === "resolve" && revision.assetId === entry.assetId && revision.chainId === entry.chainId && revision.newAddress === entry.address && Date.parse(revision.approvedAt) >= Date.parse(event.detectedAt)));
}
const intentKeys = ["provider", "protocol", "fromChainId", "toChainId", "fromTokenAddress", "toTokenAddress", "fromTokenDecimals", "toTokenDecimals", "fromAddress", "receiver", "fromAmount", "toAmount", "minimumAmountOut", "expiresAt", "maxSlippageBps", "depositAddress"];
function parseIntent(value: unknown): SecuritySwapIntent {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !intentKeys.includes(key))) throw new Error("INVALID_SECURITY_REQUEST");
  const intent = value as SecuritySwapIntent;
  if (!isSupportedSecurityChain(intent.fromChainId) || !isSupportedSecurityChain(intent.toChainId) || !["lifi", "rango", "oneclick"].includes(intent.provider) || typeof intent.protocol !== "string" || intent.protocol.length > 160) throw new Error("INVALID_SECURITY_REQUEST");
  return intent;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) throw new Error("INVALID_SECURITY_REQUEST");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 32_768) throw new Error("INVALID_SECURITY_REQUEST"); chunks.push(result.value); } }
  finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SECURITY_REQUEST");
  return value as Record<string, unknown>;
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.HERMES_ENABLE_DIAGNOSTIC_API !== "true") return NextResponse.json({ error: "diagnostic_api_disabled" }, { status: 410, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "INVALID_SECURITY_ORIGIN" }, { status: 403, headers });
  if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); used = 0; }
  if (used >= 60 || active >= 4) return NextResponse.json({ error: "SECURITY_RATE_LIMITED" }, { status: 429, headers });
  used++; active++;
  const correlationId = randomUUID(); let intent: SecuritySwapIntent | undefined;
  try {
    const input = await body(request); intent = parseIntent(input.intent);
    const config = readSecurityConfig(); const registry = await readTrustedRegistry();
    if (!config.supportedChainIds.includes(intent.fromChainId) || !config.supportedChainIds.includes(intent.toChainId)) throw new SecurityValidationError("QUOTE_CHAIN_MISMATCH", intent.fromChainId, "chain_not_allowed");
    if (intent.maxSlippageBps > config.maxSlippageBps) throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", intent.fromChainId, "slippage_exceeds_local_policy");
    if (input.mode === "quote") {
      if (Object.keys(input).some(key => !["mode", "intent", "quote"].includes(key))) throw new Error("INVALID_SECURITY_REQUEST");
      validateSwapQuote(parseIntent(input.quote), intent, registry);
    } else if (input.mode === "transaction") {
      if (Object.keys(input).some(key => !["mode", "intent", "candidate", "context"].includes(key))) throw new Error("INVALID_SECURITY_REQUEST");
      validateTransaction(input.candidate as TransactionCandidate, intent, registry, config, input.context as TransactionContext);
    } else throw new Error("INVALID_SECURITY_REQUEST");
    const entries = [lookupTrustedToken(registry, intent.fromChainId, intent.fromTokenAddress), lookupTrustedToken(registry, intent.toChainId, intent.toTokenAddress)];
    const unique = [...new Map(entries.filter(entry => entry !== null).map(entry => [`${entry!.assetId}:${entry!.chainId}`, entry!])).values()];
    for (const entry of unique) {
      const sources = await resolveTokenSources(entry, true);
      const consensus = verifyTokenConsensus({ assetId: entry.assetId, chainId: entry.chainId, registryEntry: entry, ...sources, requiredSources: config.requiredSources, correlationId });
      await writeSecurityEvents(consensus.events);
      const journal = await readSecurityEvents();
      const unresolved = journal.conflicts.some(conflict => conflict.assetId === entry.assetId && conflict.chainId === entry.chainId && conflict.status === "open" && conflict.severity !== "warning");
      if (consensus.status === "blocked" || unresolved || hasPersistentFlag(journal, entry, registry)) throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", entry.chainId, "unresolved_token_identity_conflict", entry.assetId);
    }
    // Refresh persistent authority after upstream work; administrative changes must invalidate authorization.
    let latest = await readTrustedRegistry();
    if (latest.version !== registry.version) throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", intent.fromChainId, "registry_changed_during_validation");
    const finalJournal = await readSecurityEvents();
    const currentConflict = finalJournal.conflicts.find(conflict => conflict.status === "open" && conflict.severity !== "warning" && unique.some(entry => entry.assetId === conflict.assetId && entry.chainId === conflict.chainId));
    if (currentConflict) throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", currentConflict.chainId, "unresolved_token_identity_conflict", currentConflict.assetId);
    const flagged = unique.find(entry => hasPersistentFlag(finalJournal, entry, latest));
    if (flagged) throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", flagged.chainId, "persistently_flagged_token", flagged.assetId);
    latest = await readTrustedRegistry();
    if (latest.version !== registry.version) throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", intent.fromChainId, "registry_changed_during_final_audit_read");
    if (input.mode === "transaction") validateTransaction(input.candidate as TransactionCandidate, intent, latest, readSecurityConfig(), input.context as TransactionContext);
    else validateSwapQuote(parseIntent(input.quote), intent, latest);
    return NextResponse.json({ authorized: true, registryVersion: latest.version, correlationId }, { headers });
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      try { await writeSecurityEvents([{ ...error.eventData, correlationId }]); } catch { return NextResponse.json({ error: "SECURITY_AUDIT_UNAVAILABLE" }, { status: 503, headers }); }
      return NextResponse.json({ error: error.code, correlationId }, { status: 422, headers });
    }
    if (intent && isSupportedSecurityChain(intent.fromChainId)) {
      try { await writeSecurityEvents([{ event: "QUOTE_VALIDATION_FAILED", assetId: "unknown", chainId: intent.fromChainId, severity: "critical", action: "blocked", detectedAt: new Date().toISOString(), correlationId, details: { reason: "invalid_or_unavailable_security_validation" } }]); }
      catch { return NextResponse.json({ error: "SECURITY_AUDIT_UNAVAILABLE", correlationId }, { status: 503, headers }); }
    }
    return NextResponse.json({ error: "SECURITY_VALIDATION_UNAVAILABLE", correlationId }, { status: 503, headers });
  } finally { active--; }
}

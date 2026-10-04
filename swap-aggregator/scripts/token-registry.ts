/** Offline, explicit operator workflow. Run: node scripts/token-registry.ts show | apply approval.json
 * Audit: show-events | metrics [--provider lifi|coingecko|coinmarketcap] [--since ISO_DATE]
 * Approval JSON includes operation, assetId, chainId, oldAddress, newAddress,
 * reason, externalEvidence[], approvedBy, approvedAt, expectedVersion, entry (onboard/migrate).
 * The existing TypeScript compiler loads this server-only CLI without installing a runner.
 */
const nodeFs = require("node:fs") as typeof import("node:fs");
const nodeModule = require("node:module") as { _extensions: Record<string, (module: { _compile: (source: string, filename: string) => void }, filename: string) => void>; _load: (request: string, ...args: unknown[]) => unknown };
const compiler = require("typescript") as typeof import("typescript");
const originalLoad = nodeModule._load;
nodeModule._load = function(request, ...args) {
  // This CLI runs only in Node; Next's server-only marker has no browser to guard here.
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...args);
};
nodeModule._extensions[".ts"] = (module, filename) => {
  const source = nodeFs.readFileSync(filename, "utf8");
  const compiled = compiler.transpileModule(source, { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } });
  module._compile(compiled.outputText, filename);
};
async function main() {
  const [command, requestFile, ...remaining] = process.argv.slice(2);
  if (!["show", "apply", "show-events", "metrics"].includes(command)) throw new Error("REGISTRY_ADMIN_USAGE_INVALID");
  // Use Next's existing server environment loader; diagnostics never print environment values.
  require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const registry = require("../lib/security/registry.server.ts") as typeof import("../lib/security/registry.server");
  if (command === "show-events" || command === "metrics") {
    const flags = requestFile === undefined ? remaining : [requestFile, ...remaining];
    let provider: string | undefined; let since: number | undefined;
    for (let index = 0; index < flags.length; index += 2) {
      if (flags[index] === "--provider" && ["coingecko", "coinmarketcap", "lifi"].includes(flags[index + 1])) provider = flags[index + 1];
      else if (flags[index] === "--since" && Number.isFinite(Date.parse(flags[index + 1]))) since = Date.parse(flags[index + 1]);
      else throw new Error("INVALID_AUDIT_FILTER");
    }
    const journal = require("../lib/security/events.server.ts") as typeof import("../lib/security/events.server");
    const document = await journal.listSecurityEvents();
    const conflicts = document.conflicts.filter((item) => (!provider || item.divergentProviders?.includes(provider as import("../lib/security/types").TokenProvider)) && (since === undefined || Date.parse(item.lastSeenAt) >= since));
    const events = document.events.filter((item) => (!provider || item.details?.provider === provider || item.divergentProviders?.includes(provider as import("../lib/security/types").TokenProvider)) && (since === undefined || Date.parse(item.detectedAt) >= since));
    if (command === "show-events") console.log(JSON.stringify({ schemaVersion: document.schemaVersion, version: document.version, conflicts, events }, null, 2));
    else console.log(JSON.stringify({ conflictRecords: conflicts.length, conflictOccurrences: conflicts.reduce((sum, item) => sum + item.occurrenceCount, 0), openTokenConflicts: conflicts.filter((item) => item.status === "open").length, criticalTokenConflicts: conflicts.filter((item) => item.status === "open" && item.severity === "critical").length, providerFailures: events.filter((item) => item.event === "TOKEN_PROVIDER_UNAVAILABLE").length, blockedValidationEvents: events.filter((item) => item.action === "blocked").length }, null, 2));
    return;
  }
  if (command === "show") {
    const doc = await registry.readTrustedRegistry();
    console.log(JSON.stringify({ schemaVersion: doc.schemaVersion, version: doc.version, entries: doc.entries, history: doc.history }, null, 2));
    return;
  }
  if (!requestFile) throw new Error("APPROVAL_FILE_REQUIRED");
  const stat = nodeFs.statSync(requestFile);
  if (!stat.isFile() || stat.size > 65536) throw new Error("INVALID_APPROVAL_FILE");
  const approval: unknown = JSON.parse(nodeFs.readFileSync(requestFile, "utf8"));
  const doc = await registry.applyRegistryChange(approval as import("../lib/security/types").RegistryApproval);
  console.log(JSON.stringify({ status: "approved_revision_persisted", version: doc.version, entryCount: doc.entries.length }));
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "REGISTRY_ADMIN_FAILED";
  console.error(/^[A-Z_ :a-z.-]+$/.test(message) ? message : "REGISTRY_ADMIN_FAILED");
  process.exitCode = 1;
});

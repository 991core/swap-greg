import { parseArgs } from "node:util";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { searchRoutes } from "../lib/routing/research/engine.ts";
import { rawAmount, validateAsset } from "../lib/routing/research/amounts.ts";
import { createJsonHttp, createReplayHttp } from "../lib/routing/research/http.ts";
import type { HttpEvidence } from "../lib/routing/research/http.ts";
import { createProviders } from "../lib/routing/research/providers.ts";
import { discoverPivots, fetchValuation } from "../lib/routing/research/catalog.ts";
import type { DiscoveryResult } from "../lib/routing/research/catalog.ts";
import type { QuoteRequest, SearchOptions, SearchReport } from "../lib/routing/research/types.ts";

interface CaseFile extends Omit<QuoteRequest, "wallet"> {
  name?: string;
  wallet?: string;
  providers?: string[];
  discover?: boolean;
  maxPivotsPerChain?: number;
  options?: Omit<SearchOptions, "now" | "signal">;
}

interface Run {
  schemaVersion: 1;
  mode: "live" | "offline-replay";
  request: QuoteRequest;
  options: Omit<SearchOptions, "now" | "signal">;
  providers: string[];
  assumePreapproved: boolean;
  startedAt: number;
  discovery: DiscoveryResult | null;
}

const HELP = `Hermes — route research (Node >= 22.18, quotes only)

npm run research:routes -- --case research/routing/cases/polygon-gnosis.json --wallet 0xYOUR_ADDRESS
npm run research:routes -- --from-chain 1 --from-token 0x... --from-decimals 6 --to-chain 8453 --to-token 0x... --to-decimals 6 --amount-raw 200000000 --wallet 0x...
npm run research:routes -- --replay research-runs/RUN/round-1

--out DIR                 New output directory (never overwrites a run)
--rounds N                1–5 successive independent quote windows (default 1)
--providers lifi,relay,cow Selected adapters; LI.FI is needed for a baseline
--max-requests N          Quote call budget per round (default 60)
--timeout-ms N            Search wall-time budget per round (default 45000)
--assume-preapproved      Explicit benchmark assumption; allowances NOT checked
--no-discovery            Only the exact assets and configured pivots

API credentials: LIFI_API_KEY and RELAY_API_KEY. Only environment variables;
no key is saved in run files. No private key, signature or transaction is used.
Amounts are exact integer strings in source-token base units. Gas is pre-funded
separately. Missing cost data leaves the economic comparison UNRESOLVED.
`;

function save(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
}

function render(report: SearchReport): string {
  const lines = ["# Hermes — comparaison de devis", "", `Fenêtre : ${new Date(report.startedAt).toISOString()} → ${new Date(report.finishedAt).toISOString()}`,
    `Appels : ${report.requestsMade}. Cache : ${report.cacheHits}. Recherche bornée : ${report.truncated ? report.stopReasons.join(", ") : "aucune limite atteinte"}.`, "",
    "Tous les montants ci-dessous sont des entiers dans les unités minimales du token cible.", "",
    "| Route | Fournisseurs | Sortie | Coûts externes rapportés USD | Net après ces coûts | Statut |",
    "|---|---|---:|---:|---:|---|",
    ...report.routes.map((r) => `| ${r.id} | ${r.legs.map((q) => q.provider).join(" → ")} | ${r.amountOut} | ${r.reportedExternalCostUsd ?? "inconnu"} | ${r.netAfterReportedCosts ?? "inconnu"} | ${r.economics} |`),
    "", `Comparaison : **${report.comparison.status}**. Gain estimé en unités brutes : ${report.comparison.gainRaw ?? "non établi"}.`,
    report.comparison.reason, "", "## Hypothèses", "", ...report.assumptions.map((s) => `- ${s}`), "", "## Limites par route", "",
    ...report.routes.flatMap((r) => r.warnings.map((s) => `- ${r.id}: ${s}`)), "", "Les réponses, erreurs et horodatages sont dans evidence.jsonl. Aucune exécution n'a été validée.", ""];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({ options: {
    case: { type: "string" }, wallet: { type: "string" }, out: { type: "string" }, replay: { type: "string" },
    rounds: { type: "string", default: "1" }, providers: { type: "string" }, help: { type: "boolean" },
    "from-chain": { type: "string" }, "from-token": { type: "string" }, "from-decimals": { type: "string" },
    "to-chain": { type: "string" }, "to-token": { type: "string" }, "to-decimals": { type: "string" },
    "amount-raw": { type: "string" }, "max-requests": { type: "string" }, "timeout-ms": { type: "string" },
    "assume-preapproved": { type: "boolean", default: false }, "no-discovery": { type: "boolean", default: false },
  } });
  if (args.help) { console.log(HELP); return; }
  const rounds = Number(args.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error("--rounds must be 1–5");
  let caseFile: CaseFile | undefined;
  let recorded: Run | undefined;
  let evidence: HttpEvidence[] = [];
  if (args.replay) {
    if (rounds !== 1) throw new Error("Replay one recorded round at a time");
    recorded = JSON.parse(readFileSync(join(args.replay, "run.json"), "utf8"));
    evidence = readFileSync(join(args.replay, "evidence.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s));
  } else {
    caseFile = args.case ? JSON.parse(readFileSync(args.case, "utf8")) : {
      from: { chainId: Number(args["from-chain"]), address: args["from-token"]!, decimals: Number(args["from-decimals"]) },
      to: { chainId: Number(args["to-chain"]), address: args["to-token"]!, decimals: Number(args["to-decimals"]) },
      amount: args["amount-raw"]!, slippageBps: 50,
    };
    if (!(args.wallet ?? caseFile!.wallet)) throw new Error("Supply --wallet (public address only). See --help.");
  }
  const output = resolve(args.out ?? `research-runs/${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output, { recursive: false });
  let anyQuotes = false;
  for (let round = 1; round <= rounds; round++) {
    const dir = join(output, `round-${round}`);
    mkdirSync(dir);
    const log = join(dir, "evidence.jsonl");
    writeFileSync(log, "", { flag: "wx" });
    const clock = { now: recorded?.startedAt ?? Date.now() };
    const http = recorded ? createReplayHttp(evidence, clock) : createJsonHttp((e) => appendFileSync(log, JSON.stringify(e) + "\n"));
    if (recorded) for (const item of evidence) appendFileSync(log, JSON.stringify(item) + "\n");
    const providerNames = recorded?.providers ?? args.providers?.split(",") ?? caseFile?.providers ?? ["lifi", "relay", "cow"];
    const assumePreapproved = recorded?.assumePreapproved ?? args["assume-preapproved"];
    const providers = createProviders(http, { lifiApiKey: recorded ? undefined : process.env.LIFI_API_KEY,
      relayApiKey: recorded ? undefined : process.env.RELAY_API_KEY, assumePreapproved });
    if (providerNames.some((id) => !providers.some((p) => p.id === id))) throw new Error("Unknown provider; choose lifi, relay or cow");
    const request: QuoteRequest = recorded?.request ?? {
      from: caseFile!.from, to: caseFile!.to, amount: args["amount-raw"] ?? caseFile!.amount,
      wallet: args.wallet ?? caseFile!.wallet!, slippageBps: caseFile!.slippageBps ?? 50,
    };
    validateAsset(request.from);
    validateAsset(request.to);
    rawAmount(request.amount);
    if (!/^0x[\da-f]{40}$/i.test(request.wallet)) throw new Error("Expected a public EVM wallet address");
    console.log(`Round ${round}/${rounds}: ${request.from.chainId}:${request.from.address} → ${request.to.chainId}:${request.to.address}`);
    const discovery = recorded?.discovery ?? (!recorded && !args["no-discovery"] && caseFile?.discover !== false
      ? await discoverPivots(http, [request.from.chainId, request.to.chainId], caseFile?.maxPivotsPerChain ?? 3) : null);
    const options = recorded?.options ?? { ...caseFile?.options, pivots: [...(caseFile?.options?.pivots ?? []), ...(discovery?.pivots ?? [])],
      ...(args["max-requests"] ? { maxRequests: Number(args["max-requests"]) } : {}),
      ...(args["timeout-ms"] ? { timeoutMs: Number(args["timeout-ms"]) } : {}) };
    if (!recorded && !options.valuation) {
      try { options.valuation = await fetchValuation(http, request.to); }
      catch (e) { console.log(`Valuation unavailable: ${String(e)}. Raw outputs remain comparable; net costs may be unresolved.`); }
    }
    const run: Run = { schemaVersion: 1, mode: recorded ? "offline-replay" : "live", request, options, providers: providerNames,
      assumePreapproved, startedAt: recorded?.startedAt ?? Date.now(), discovery };
    save(join(dir, "run.json"), run);
    const report = await searchRoutes(request, providerNames.map((id) => providers.find((p) => p.id === id)!),
      { ...options, ...(recorded ? { now: () => clock.now } : {}) });
    anyQuotes ||= report.routes.length > 0;
    save(join(dir, "report.json"), report);
    writeFileSync(join(dir, "report.md"), render(report), { flag: "wx" });
    console.log(`${report.routes.length} route(s), ${report.requestsMade} calls, comparison=${report.comparison.status}. ${dir}/report.md`);
  }
  if (!anyQuotes) process.exitCode = 2;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "Research failed"); process.exitCode = 1; });

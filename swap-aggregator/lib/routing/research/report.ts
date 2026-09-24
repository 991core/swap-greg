import { assetKey, formatRaw } from "./amounts.ts";
import type { Asset, SearchReport } from "./types.ts";

const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
const assetLabel = (asset: Asset) => cell(`${asset.symbol ?? "token"}@${asset.chainId} (${asset.address.slice(0, 8)})`);

export function renderReport(report: SearchReport): string {
  const token = report.request.to;
  const lines = ["# Hermes — comparaison de devis", "",
    `Fenêtre : ${new Date(report.startedAt).toISOString()} → ${new Date(report.finishedAt).toISOString()}`,
    `Appels : ${report.requestsMade}. Cache : ${report.cacheHits}. Recherche bornée : ${report.truncated ? report.stopReasons.join(", ") : "aucune limite atteinte"}.`, "",
    `Sorties exprimées en ${cell(token.symbol ?? "token cible")} (${assetKey(token)}). Les entiers bruts restent dans report.json.`,
    "Les frais inclus sont déjà déduits du devis. Le net ci-dessous déduit uniquement les coûts externes connus ; il reste partiel si le statut est INCOMPLETE_COSTS.", "",
    "| Route | Fournisseurs | Parcours | Sortie | Coûts externes USD | Net après ces coûts | Statut |",
    "|---|---|---|---:|---:|---:|---|",
    ...report.routes.map((r) => `| ${r.id} | ${cell(r.legs.map((q) => q.provider).join(" → "))} | ${[r.legs[0].from, ...r.legs.map((q) => q.to)].map(assetLabel).join(" → ")} | ${formatRaw(r.amountOut, token.decimals)} | ${r.reportedExternalCostUsd ?? "inconnu"} | ${r.netAfterReportedCosts === null ? "inconnu" : formatRaw(r.netAfterReportedCosts, token.decimals)} | ${r.economics} |`),
    "", `Comparaison : **${report.comparison.status}**. Gain estimé : ${report.comparison.gainRaw === null ? "non établi" : formatRaw(report.comparison.gainRaw, token.decimals)}.`,
    report.comparison.reason, "", "## Couverture des intermédiaires", "",
    "Une tentative peut échouer ou ne donner aucun devis. Zéro tentative vers la cible ne démontre pas l'absence d'une route. Le budget et les fournisseurs disponibles limitent la couverture.", "",
    "| Intermédiaire | Contrat | Devis pour y arriver | Appels vers la cible | Appels avec devis vers la cible |",
    "|---|---|---|---:|---:|",
    ...report.pivotCoverage.map((p) => `| ${assetLabel(p.asset)} | ${p.asset.address} | ${p.reached ? "oui" : "non"} | ${p.targetAttempts} | ${p.targetSuccesses} |`),
    "", "## Frais et gas par étape", "",
    "Les frais ci-dessous sont informatifs : ne pas les soustraire une seconde fois lorsqu'ils sont inclus. Les sous-étapes LI.FI ne sont pas additionnées aux totaux de leurs étapes parentes.", ""];
  for (const route of report.routes) {
    lines.push(`### ${route.id}`, "");
    for (const [i, leg] of route.legs.entries()) {
      lines.push(`Étape ${i + 1} — ${cell(leg.provider)} : ${formatRaw(leg.amountIn, leg.from.decimals)} ${assetLabel(leg.from)} → ${formatRaw(leg.amountOut, leg.to.decimals)} ${assetLabel(leg.to)}.`, "");
      for (const fee of leg.fees ?? []) {
        const amount = fee.amountRaw !== null && fee.token ? `${formatRaw(fee.amountRaw, fee.token.decimals)} ${cell(fee.token.symbol ?? fee.token.address)}` : fee.amountRaw === null ? "montant inconnu" : `${fee.amountRaw} unités brutes`;
        const recipients = fee.recipients.map((r) => `${cell(r.name)} : ${fee.token ? formatRaw(r.amountRaw, fee.token.decimals) : r.amountRaw}`).join(", ");
        lines.push(`- ${cell(fee.name)} : ${amount} ; ${fee.amountUsd ?? "inconnu"} USD ; ${fee.included === true ? "inclus dans la sortie" : fee.included === false ? "payé séparément" : "inclusion inconnue"}${recipients ? ` ; destinataires : ${recipients}` : ""}.`);
      }
      if (leg.gasAccounting === "transactions") lines.push("- Gas calculé à partir des transactions ci-dessous ; le récapitulatif gas de l'API n'est pas ajouté à nouveau.");
      else if (leg.gasAccounting) lines.push("- Gas : récapitulatif du fournisseur ; vérifier les limites de couverture ci-dessous.");
      for (const gas of leg.gasEstimates ?? []) lines.push(`- Gas ${cell(gas.step)} sur chaîne ${gas.chainId} : ${gas.gas} × ${gas.priceWei} wei (${gas.basis === "gas_times_max_fee" ? "maxFeePerGas" : "gasPrice"}) = ${gas.amountRaw} unités natives, soit ≈ ${gas.amountUsd} USD.`);
      lines.push("");
    }
  }
  const errors = report.diagnostics.filter((d) => d.status === "error" || d.status === "invalid_quote");
  if (errors.length) lines.push("## Erreurs des appels", "", ...errors.map((d) =>
    `- ${cell(d.provider)} : ${cell(d.from)} → ${cell(d.to)}, montant brut ${d.amount} : ${cell(d.detail)}`), "");
  lines.push("## Hypothèses", "", ...report.assumptions.map((s) => `- ${cell(s)}`), "", "## Limites par route", "",
    ...report.routes.flatMap((r) => r.warnings.map((s) => `- ${r.id}: ${cell(s)}`)), "",
    "Les réponses, erreurs et horodatages sont dans evidence.jsonl. Aucune exécution n'a été validée.", "");
  return lines.join("\n");
}

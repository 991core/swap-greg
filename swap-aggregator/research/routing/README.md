# Hermes — recherche de routes générique

Ce prototype compare des devis pour une paire EVM quelconque, au montant exact
demandé. Il explore des intermédiaires sur les chaînes de départ et d'arrivée.
Les résultats servent à décider d'une future intégration à l'orchestrateur.
Une route proposée reste une estimation : l'outil ne signe, n'approuve et ne
soumet aucune transaction.

## Installation et commandes

Node **22.18 ou plus récent** est nécessaire pour exécuter les fichiers TypeScript
directement. Node 24 a été utilisé pour la validation. Installez les dépendances
avec `npm install` (ou `npm ci` pour une installation conforme au lockfile).
Le CLI lui-même n'ajoute aucune dépendance d'exécution.

Depuis `swap-aggregator/` :

```bash
npm run research:test
npm run research:typecheck

npm run research:routes -- \
  --case research/routing/cases/polygon-gnosis.json \
  --wallet 0xVOTRE_ADRESSE

npm run research:routes -- \
  --case research/routing/cases/base-arbitrum.json \
  --wallet 0xVOTRE_ADRESSE
```

Autre paire, sans fichier spécifique :

```bash
npm run research:routes -- \
  --from-chain 1 \
  --from-token 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 \
  --from-decimals 6 \
  --to-chain 8453 \
  --to-token 0x4200000000000000000000000000000000000006 \
  --to-decimals 18 \
  --amount-raw 200000000 \
  --wallet 0xVOTRE_ADRESSE
```

`--amount-raw` désigne les unités minimales : `200000000` = 200 USDC à 6 décimales.
L'outil n'effectue aucune conversion implicite à partir d'un symbole ou d'un montant
flottant. Les adresses des tokens et leurs décimales sont validées dans les réponses.
L'adresse du portefeuille sert aux devis ; aucune clé privée n'est nécessaire.

`LIFI_API_KEY` et `RELAY_API_KEY` sont facultatives selon les quotas du fournisseur.
Ces variables doivent exister dans l'environnement du processus ; le CLI ne charge
pas `.env.local` automatiquement. Les en-têtes contenant les clés ne sont pas
sauvegardés. Les réponses peuvent contenir des adresses publiques : les dossiers
`research-runs/` restent ignorés par Git.

Options utiles : `--rounds 3`, `--max-requests 60`, `--timeout-ms 45000`,
`--providers lifi,relay,cow`, `--no-discovery`, `--out research-runs/nom-unique`.
Un dossier existant n'est jamais écrasé. Le code de sortie vaut 2 si aucune route
n'a été obtenue ; 0 indique des devis obtenus, pas un gain économique démontré.

## Méthode de recherche

1. Référence directe LI.FI via `/advanced/routes`, avec `CHEAPEST`,
   `allowSwitchChain: true`, aucun frais Hermes ajouté et le slippage demandé.
   Cette référence peut déjà contenir plusieurs étapes internes.
2. Devis directs Relay et CoW quand le réseau et le type d'actif le permettent.
3. Découverte de candidats via les catalogues LI.FI et Relay, plus les pivots
   explicitement configurés. Le classement de découverte privilégie l'actif natif
   et les familles USDC, USDT, DAI, WETH, ETH, WBTC selon les métadonnées fournisseur.
   C'est une heuristique configurable, **pas une preuve de liquidité**. Deux contrats
   portant le même symbole restent distincts. Le moteur n'utilise pas l'allowlist
   des tokens de l'interface pour limiter les actifs source et cible.
4. Recherche par profondeur, 3 étapes par défaut (maximum 4), un passage explicite
   entre les deux chaînes, sans boucle. Chaque arête reçoit un devis au montant
   exact annoncé par la précédente. Le moteur peut explorer swap → bridge,
   bridge → swap, swap → bridge → swap et des routes locales.
5. Conservation par actif des états avec la meilleure sortie et, si connu, un
   état aux coûts externes plus faibles. La largeur, le nombre d'intermédiaires,
   la durée et les appels API sont bornés. Les coupures sont consignées.
6. Classement net uniquement si les coûts externes sont couverts, la valorisation
   commune est disponible et les devis restent suffisamment proches dans le temps.
   Les autres candidats restent visibles avec leur statut.

L'algorithme n'attribue pas un taux fixe à chaque pool : les prix dépendent du
montant et du moment. Le cache est limité à une recherche et indexé par fournisseur,
contrats, chaînes, montant, portefeuille et slippage. Un budget de recherche ou
l'élagage peut masquer une meilleure combinaison. Aucune optimalité globale n'est
annoncée. Le nombre d'étapes limite les appels à des fournisseurs ; leurs routes
peuvent elles-mêmes comporter des échanges internes.

## Contrat de données et coûts

Le contrat `QuoteProvider` est dans `lib/routing/research/types.ts`. Un nouvel
adaptateur doit fournir les identités exactes des actifs, montants, horodatages,
expiration, coûts payés séparément et coûts encore inconnus. Une réponse qui ne
respecte pas le montant d'entrée ou le contrat de sortie est rejetée.

`netAfterReportedCosts = amountOut − coûts externes / prix USD du token cible`.
Tous les montants bruts et les conversions monétaires utilisent `BigInt` ; les
coûts convertis sont arrondis vers le haut. Une valorisation cible unique est
obtenue via l'endpoint de prix Relay, ou fournie dans `options.valuation` avec sa
source et ses dates. Ce prix sert à comparer le gaz, pas à annoncer le taux d'un swap.

Les frais intégrés dans la sortie ne sont pas déduits à nouveau. Pour LI.FI, seuls
les `gasCosts` des étapes principales et les `feeCosts` avec `included: false`
s'ajoutent. Les `includedSteps` ne sont pas additionnés une seconde fois. Pour Relay,
`fees.gas` n'est reconnu comme coût externe que si sa devise est le natif source.
Pour CoW, `sellAmountBeforeFee = sellAmount + feeAmount` est vérifié.

| Statut | Interprétation |
|---|---|
| `QUOTE_ESTIMATE` | Comparaison des devis possible sous les hypothèses affichées ; exécution non vérifiée |
| `INCOMPLETE_COSTS` | Gaz, approbation, traitement d'un frais ou validation fournisseur manquants |
| `NO_VALUATION` | Conversion des coûts externes vers le token cible impossible |
| `STALE` | Expiration, ancienneté maximale ou écart temporel entre étapes dépassé |

`--assume-preapproved` est une hypothèse de benchmark explicite et journalisée.
Elle ne lit pas les allowances et ne constitue pas une validation de portefeuille.
Les autres incertitudes restent bloquantes, notamment un frais protocolaire CoW
non nul dont le traitement exact n'a pas encore été validé.

Le TTL local par défaut de 60 secondes limite la fraîcheur des devis LI.FI/Relay.
Il ne signifie pas qu'un fournisseur réserve ce prix pendant 60 secondes. L'expiration
CoW est prise en compte lorsqu'elle est plus courte. Le budget global par défaut
est 45 secondes et l'écart temporel maximal entre devis comparés est 30 secondes.

## Exécution et couverture

Le prototype suppose du gaz **financé séparément sur chaque chaîne émettrice**.
Un solde natif nul après le pont empêcherait l'étape locale, même si le devis est bon.
Les frais Hermes sont fixés à zéro dans tous les adaptateurs pour ce contrôle ;
ce benchmark ne reproduit pas le tarif de l'app si elle applique ses propres frais.

Les étapes composées ne réservent pas un prix global. `globalMinimumOut` reste nul,
et `conditionalLastLegMinimum` concerne seulement la dernière étape à l'entrée cotée.
Un futur exécuteur devra obtenir de nouveaux devis sur les montants réellement reçus,
gérer les autorisations, les soldes natifs, le changement de prix et les échecs partiels.

Couverture initiale : actifs EVM, réseaux réellement couverts par les fournisseurs.
CoW est utilisé pour les échanges ERC-20 locaux sur ses déploiements configurés ;
les actifs natifs nécessitent un chemin explicite via leur version enveloppée.
Le cas Gnosis inclut WXDAI comme candidat, sans l'assimiler à xDAI.
Les contrats rebasing, à taxe de transfert ou aux comportements non standards ne
sont pas validés pour une exécution. Il n'y a pas de partage d'ordre entre routes,
de passage via une troisième chaîne ni de support non-EVM dans cette version.

## Preuves et rejouabilité

Chaque round produit `run.json` (paramètres), `evidence.jsonl` (requêtes, réponses,
erreurs, dates), `report.json` et `report.md`. Les réponses sont écrites au fur et
à mesure, même si une recherche est interrompue.

```bash
npm run research:routes -- --replay research-runs/VOTRE_RUN/round-1
```

Le replay ne peut contacter aucun fournisseur ; une réponse absente reste une
erreur. Il rejoue les réponses capturées et le traitement des montants. Il ne
reproduit pas à l'identique l'ordonnancement réseau concurrent : le nombre d'appels
ou les coupures de délai peuvent varier. Les tests unitaires isolent les invariants.

Les fixtures `tests/routing-research/fixtures/live-2026-09-23.json` sont des projections
des champs utiles de vraies réponses API. Elles ne contiennent ni calldata à
exécuter ni clé API. Les autres fixtures sont synthétiques et identifiées comme
telles : elles testent les calculs, sans prouver une économie réelle.

## Prochaine validation économique

Voir [cycle-001.md](cycle-001.md) et [claims.json](claims.json). Il faut estimer les
approbations nécessaires pour un portefeuille réel, valider les frais CoW, répéter
seulement les candidats non dominés, puis décider de l'intégration produit à partir
de résultats complets. Aucun suivi périodique ni changement automatique des règles
de production n'est activé.

# Dossier de release Hermes — 4 octobre 2026

## Décision et périmètre

**Qualification technique locale terminée ; ouverture avec fonds non encore qualifiée.**
Le profil public préparé est une instance Docker Standalone provisoire derrière
le proxy HTTPS existant, `NEXT_PUBLIC_RELEASE_MODE=quotes`,
`NEXT_PUBLIC_PLATFORM_FEE_PERCENT=0`, `HERMES_EXECUTION_DISABLED=true`.
LI.FI, Rango et 1Click restent visibles en cotation ; aucune classe de swap
avec fonds n'est proposée à l'ouverture à ce stade. Socket reste désactivé.

Il n'y a eu ni signature, ni approval, ni dépôt, ni swap réel, ni image poussée,
ni modification d'un serveur, proxy ou DNS. Une clé Rango TEST ne rend pas les
réseaux mainnet factices. Les transactions des providers restent la base du
parcours ; aucun registre, router, spender, dépôt ou examen ABI obligatoire
n'a été réintroduit.

## Identité exacte et préexistence

- Branche `feat/hermes-oneclick` ; HEAD
  `86159fb636d1b779c85818a261b07e05512cd9f0`.
- L'arbre était déjà sale avant cette mission : 20 fichiers suivis modifiés et
  `research/` non suivi. Aucun reset, clean ou checkout destructif.
- Le [manifeste](./source-manifest.json) contient 126 fichiers source,
  `treeSha256=202dd0b40bfb6da0e27b605d85f865e21efdaa9b4a9dd3ac7a13451adf6b3c2f`.
  Le HEAD seul ne décrit pas l'arbre examiné. Le manifeste exclut les secrets,
  recherches et tests : conserver aussi les rapports et logs de cette release.
- Les 27 preuves historiques de `research/2026-10-04-finalisation/` sont intactes
  selon [la vérification indépendante](./independent/historical-integrity.json).

## Corrections et régressions

Les quatre défauts historiques ont été rejoués avant correction (voir
[baseline](./BASELINE.md)), puis convertis en régressions observables : minimum
reconstruit LI.FI, faux succès destination, nouvelle garde après ambiguïté et
valeur native/gas hors budget. Les corrections lient le minimum et l'enveloppe
transactionnelle à l'intention consentie, exigent une preuve de livraison
destination, conservent un journal avant toute émission possible et vérifient
valeur native plus gas contre le solde et le budget.

Les trois providers enregistrent les actions et hashes dans un journal v2,
conservent les émissions ambiguës, exposent un export volontaire et une reprise
en lecture seule. La réconciliation du hash exige notamment le nonce attendu ;
un ancien dossier sans nonce discriminant reste à traiter manuellement. Les
verrous atomiques Web Locks coordonnent les onglets d'un même profil/origine,
sans prétendre coordonner plusieurs appareils. Les capacités d'exécution
acceptées se limitent aux transactions EVM standard d'un wallet EOA injecté,
approvals finies et livraison automatique depuis la source. Les routes
incompatibles restent découvrables mais non exécutables.

Le choix de route ne change plus silencieusement à un refresh. Fees et gas
malformés ne rendent plus les autres devis invisibles ; quota, panne, absence
de route, configuration et succès partiel ont des états distincts et nettoyés.
La vérification produit n'a pas ajouté de filtre sur la découverte des tokens.

La [revue indépendante](./INDEPENDENT_REVIEW.md) a identifié sept constats
IR-1 à IR-7, tous corrigés puis revérifiés par son auteur. Elle a exécuté
408 tests ciblés et 13 reproductions indépendantes après correction, sans
modifier les fichiers d'implémentation. Aucun P1 ouvert n'a été identifié
dans son périmètre. Cette revue ne démontre pas une exécution financière réelle.

## Résultats locaux

| Contrôle | Résultat | Preuve |
| --- | --- | --- |
| `npm run typecheck` | code 0 | [typecheck.log](./verification/typecheck.log) |
| `npm test` | 47 fichiers, 718/718 tests | [test.log](./verification/test.log) |
| `npm run lint` | code 0 | [lint.log](./verification/lint.log) |
| `npm run build` | code 0, Next 15.5.27 | [build.log](./verification/build.log) |
| `npm ls --omit=dev --depth=0` | code 0 | [dependencies.log](./verification/dependencies.log) |
| Production Next standalone | page, CSS, santé et release 200 ; `executionEnabled:false` ; diagnostic registry 410, Rango swap 403, entrée invalide token 400 | [smoke et visuel](./verification/manual.md) |
| Navigateur local | FR/EN ; 390, 768, 1280 px ; clavier, focus et Échap | [smoke et visuel](./verification/manual.md) |
| Docker | CLI absent ; image/Compose/Portainer non testés | [guide](../../deploy/DEPLOYMENT.md) |
| Avis dépendances | `npm audit --omit=dev` impossible : DNS `EAI_AGAIN` vers registry.npmjs.org ; aucun résultat de vulnérabilité déduit | [smoke et visuel](./verification/manual.md) |

Le test standalone a copié `.next/static` et `public` sous `.next/standalone`,
comme le Dockerfile. Une première tentative sans ces assets donnait 404 pour
le CSS ; la tentative complète a donné 200. Ce contrôle ne remplace pas le
build d'image, le scan OS ni les permissions conteneur en lecture seule.

Les tests sont majoritairement avec RPC, wallet et providers simulés, même
quand ils utilisent les vrais adapters et le SDK installé. Une preuve provider
de destination n'est pas une preuve cryptographique indépendante. La cote
live, la disponibilité des RPC et les quotas restent externes.

## Profil Docker/Portainer et conditions d'exploitation

Artefacts : [Dockerfile](../../Dockerfile),
[Compose provisoire](../../deploy/compose.portainer.yml),
[guide de déploiement](../../deploy/DEPLOYMENT.md),
[runbook incident](../../deploy/OPERATIONS.md), exemple de proxy et d'environnement.
Le Dockerfile épingle Node 22.23.3 par digest d'index officiel, utilise
`npm ci`, Next standalone, UID 10001 non-root et copie les seuls assets runtime.
Le Compose lie 127.0.0.1:3187, racine en lecture seule, tmpfs, bornes CPU,
mémoire, processus et logs ; son digest applicatif est un placeholder tant
que l'image n'est pas construite. Secrets uniquement au runtime ; variables
`NEXT_PUBLIC_*` figées au build. Aucun `.env.local` n'est copié dans l'image.

Avant une éventuelle publication : confirmer architecture CPU, version
Docker/Portainer Standalone, proxy et domaine HTTPS, ressources, clés/quota et
conditions des providers, identité/opérateur et obligations publiques. Construire
et inspecter l'image sur une machine locale avec Docker ; scanner OS/SBOM,
tester santé, API, permissions, arrêt/redémarrage et rollback, puis figer son
digest et la configuration. Tester faux Host/Origin/IP dans le proxy réel.
L'absence de Docker et du serveur cible laisse ces points non vérifiés.

## Matrice des capacités et recette financière ultérieure

| Provider | Capacité implémentée localement | Preuve locale | Ouverture fonds |
| --- | --- | --- | --- |
| LI.FI | EOA EVM, approvals exactes/finies, transaction source standard, destination automatique et preuve provider liée à l'intention | SDK/transport, garde, journal, destination, refresh | Fermée |
| Rango Basic API | EVM quote/swap/status, transaction reconstruite, préflight final et suivi destination | Adapter/API/journal simulés | Fermée |
| 1Click | Quotes anonymes, dépôt EVM ERC-20, minimum/compte/nonce/gas et suivi prudent | Adapter/API/journal simulés | Fermée |
| Socket, Solana, AA, batch, typed permits, 7702, action destination supplémentaire | Hors périmètre | Aucune | Fermée |

Si l'utilisateur autorise séparément une recette avec fonds, fixer **avant tout
essai** le wallet et ses réseaux, les classes de route précises, un budget par
transaction et cumulé incluant gas/approval, des montants faibles et les
conditions d'arrêt. Pour chacun des trois providers : enregistrer devis exact,
minimum, frais, identités source/destination/destinataire, compte, nonce,
wallet confirmation, hash source, statut et preuve destination liée, puis
exporter le journal. Le propriétaire du wallet confirme lui-même chaque action.
Un résultat ambigu, une approval inattendue, un minimum/budget dépassé, une
identité modifiée, une sortie alternative ou une preuve perdue arrêtent la
campagne ; conserver le dossier et réconcilier, sans renvoyer pour tester.
Des pannes simulables ne sont pas à provoquer avec des fonds.

Autorisation de recette, publication d'image et déploiement sont trois
décisions distinctes. Un swap réussi qualifie seulement la classe réellement
testée avec sa version et sa configuration ; toute modification ultérieure
exige d'évaluer la validité des preuves. Aucun budget n'est présumé ou demandé
pour terminer la présente mission locale.

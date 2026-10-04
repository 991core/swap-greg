# Revue indépendante de la release Hermes — 4 octobre 2026

Relecteur distinct des auteurs de l’implémentation. Revue du code courant, des SDK réellement installés, des reproductions historiques et des nouvelles preuves. Aucune signature, aucun wallet réel, aucun fonds, aucun accès de publication ni déploiement. Les preuves historiques restent intactes. État final de cette revue locale : les sept constats ci-dessous ont été corrigés et revérifiés. Aucun blocage P1 restant identifié dans le périmètre examiné. La qualification avec fonds réels et la qualification Docker/Portainer cible restent non réalisées.

## Périmètre et preuve

HEAD examiné : `86159fb636d1b779c85818a261b07e05512cd9f0`, arbre de travail modifié. Instructions AGENTS.md et requête utilisateur intégrale lus. Rapport historique et annexe exécution lus, annexes produit/fournisseurs examinées pour leurs constats et limites. Reproductions historiques minimum, destination, valeur native et ambiguïté lues ; elles décrivent le comportement historique du SDK et de la copie de garde, pas une preuve contre la garde corrigée.

La revue inspecte directement `EthereumPrepareTransactionTask`, `stepComparison`, `EthereumCheckAllowanceTask`, `EthereumSetAllowanceTask`, `getEthereumExecutionStrategy` et `isRelayerStep` des versions SDK installées. Les hooks officiels portent effectivement les données reconstruites utilisées ensuite par la transaction standard. Le contrôle séparé des minima est nécessaire : le refus de `acceptExchangeRateUpdateHook` seul reste insuffisant.

Vérification indépendante initiale : neuf fichiers ciblés, **101 tests réussis, 1 échec** (`tests/swap-refresh.test.tsx:46`). Les suites policy SDK, approvals SDK, tracking, garde, journal, boundaries API et release passent. L’échec exige encore l’ancien preview après rafraîchissement sans nouveau choix, alors que l’interface annule maintenant ce choix. Le comportement de sécurité est cohérent, la régression doit être ajustée pour conserver une vérification observable du choix explicite.

Reproduction indépendante `independent/boundary.before.repro.test.ts`, configuration dédiée dans le même dossier : **8 tests réussis**, dont une reproduction du défaut IR-2. Ce test observe volontairement le comportement défectueux ; son passage n’atteste pas une correction. Après correction, une régression permanente doit exiger l’absence d’émission.

## Constats historiques de la revue initiale

Les mentions « ouvert » et les numéros de lignes de cette section décrivent l’état au moment du constat initial. Leur traitement final est présenté plus bas ; elles sont conservées comme historique de la revue.

### IR-1 — P1 — suivi durable après restauration incomplet

**Ouvert à l’examen initial.** `components/SwapCard.tsx:120-124` restaure Rango depuis l’ancienne clé mono-dossier ; `:200-230` restaure et suit 1Click depuis son ancienne clé. Le journal v2 est seulement chargé et affiché (`:83-87`, `:349-364`). Aucun appel à `trackLifiDelivery` n’existe dans la restauration UI ; celui de `lib/aggregators/lifi/execute.ts:48` n’est effectué qu’à la fin de l’exécution initiale. Une livraison LI.FI initialement sans preuve ou interrompue par reload reste donc bloquée en destination_pending sans chemin produit de relecture du statut. Plusieurs intentions archivées ne disposent pas toutes d’un contrôle de suivi.

Un hash récupéré par `reconcileSourceHash` est attaché au providerState du journal, mais `SwapCard.tsx:285-289` actualise seulement la liste des dossiers. Les anciens pending UI ne reçoivent pas ce hash. Rango/1Click peuvent rester bloqués sans reprendre la lecture provider après réconciliation ou perte de leur ancienne clé, malgré un dossier v2 complet.

Correction attendue : action explicite de suivi en lecture seule pour chaque dossier v2 complet, reconstruite depuis l’identité/minimum/hash/providerState conservés, sans `resumeRoute`, accès wallet, approval ni renvoi. Tester reload, stockage d’ancienne clé manquant et hash réconcilié pour les trois providers.

### IR-2 — P1 — fonds/gas non relus à la dernière frontière Rango et 1Click

**Ouvert, reproduit indépendamment.** Rango enregistre beforeAction puis attend `assertExecutionEnabled` avant d’appeler le wallet ; seule l’identité compte/réseau est relue (`lib/aggregators/rango/execute.ts:101-109` pour approval, `:137-145` pour swap). 1Click possède le même intervalle après la dernière estimation/fonds (`lib/aggregators/oneclick/execute.ts:84-95`), puis emploie le gas précédemment estimé.

La reproduction réduit le solde natif simulé à 1 pendant l’attente de la politique d’incident : le vrai adapter Rango appelle néanmoins `sendTransaction` une fois. Ce n’est pas un débit réel, mais l’exigence de préflight après l’attente est objectivement violée. LI.FI relit déjà funds puis wallet après la politique et fournit le modèle attendu.

Correction attendue : relire fonds/estimation après persistance et politique runtime, puis quote/compte/réseau/deadline immédiatement avant chaque wallet action. Test de chute des balances natif et ERC-20 et changement de gas pendant cette attente, sur approval et dépôt/swap.

### IR-3 — P2 — route LI.FI incompatible encore présentée exécutable

**Ouvert à l’examen initial.** `lib/routing/quote.ts:36-41` permet un devis LI.FI sans appeler `assertLifiExecutionCapability`. `components/SwapCard.tsx:105` active donc la CTA pour une route à plusieurs étapes wallet ou typed relay. `lib/aggregators/lifi/policy.ts:11-19` la rejette ultérieurement, avant le SDK et avant toute émission : la borne financière est maintenue, mais la présentation ne correspond pas à la capacité effective.

Correction attendue : désactiver l’exécution et exposer l’incompatibilité de capacité dès la sélection, en conservant la découverte/quote si souhaité. Aucun gate de contrat/token ne doit être ajouté.

### IR-4 — P2 — quota/configuration aplatis par l’orchestrateur

**Ouvert à l’examen initial.** `lib/routing/useSwapQuotes.ts:17-22` distingue quota/configuration à partir de l’erreur, mais `lib/routing/orchestrator.ts:35-43` transforme tous les providers en échec en une nouvelle erreur générique ; les warnings partiels contiennent uniquement `unavailable`. Le statut HTTP 429 et la configuration incompatible sont perdus avant le hook. Les branches UI dédiées ne reçoivent donc pas les informations réelles.

Correction attendue : diagnostics publics structurés, nettoyés, conservant catégorie/provider avec distinction no_route, partiel, quota, configuration et panne. Tester API réelle simulée → orchestrateur → hook/DOM, pas seulement une erreur directement passée au hook.

### IR-5 — P2, à analyser avant recette — hash ancien de même enveloppe accepté en réconciliation

**Ouvert à l’examen initial.** `lib/intent/journal.ts:reconcileSourceHash` compare hash, compte, destination transaction, calldata, valeur et chaîne. L’action ne possède pas de nonce ni timestamp/block source permettant de distinguer une ancienne transaction identique. Un ancien `approve(spender,amount)` confirmé peut correspondre exactement à l’enveloppe d’une approval actuelle ambiguë ; l’action devient confirmed et le dossier approval_only, alors que l’émission ambiguë actuelle n’a pas été identifiée.

Correction attendue : conserver un identifiant source discriminant quand disponible (nonce avant demande wallet et transaction observée), ou une preuve temporelle de bloc et une limite de confiance explicite ; si l’identité de l’émission ne peut pas être établie, conserver intervention_required. Une égalité d’enveloppe historique seule ne prouve pas la réconciliation de l’action présente.

### IR-6 — P2 — état pending UI conservé après non-émission établie

**Ouvert à l’examen initial.** Rango publie un pending sans hash avant son contrôle runtime ; 1Click fait de même par onPending. Si la politique d’incident ou le préflight final refuse avant l’appel wallet, le journal marque correctement not_sent/not_emitted, mais les anciens dossiers/UI restent pending sans hash. `components/SwapCard.tsx:100-105` suspend les quotes et l’exécution pour ces états ; leurs boutons de suivi ne permettent pas de réconcilier une transaction qui n’a jamais été demandée.

Correction attendue : lorsqu’aucune demande wallet n’a été tentée, terminer proprement cet état UI/legacy, conserver le dossier v2 not_emitted et laisser l’utilisateur sélectionner un nouveau devis après réouverture. Ne jamais appliquer cette libération à une émission possible/ambiguë. Test DOM ou callbacks adapter suivi du reload.

### IR-7 — P2 — métadonnées gas malformées peuvent encore casser la sélection

**Ouvert, reproduit indépendamment.** `lib/routing/quote.ts:sourceGasAmount` lit `cost.token.chainId` sans validation ; `canExecuteQuote` et RouteList vérifient feeCosts mais pas gasCosts. Une route LI.FI valide hormis `gasCosts:[{amount:"1",token:null}]` reste éligible puis l’estimation de réserve appelée par SwapCard après sélection lève une TypeError. Le défaut touche la disponibilité UI, pas une émission financière observée.

Preuve : `independent/gas.before.repro.test.ts` et `gas.before.log` (1 test réussi qui observe le comportement défectueux). Correction attendue : validation du gas par identité/montant avant éligibilité, rendu défensif sans inventer une réserve et sans masquer les autres routes.

## Corrections favorables examinées

- Snapshot économique LI.FI indépendant ; minimum global et minimum reconstruit relus, hausse de frais refusée ; transaction provider préparée liée à to/data/value au transport final.
- Valeur native bornée au principal natif plus frais natifs source explicitement cotés et non inclus ; balance contre valeur effective + gas ; garde approval zéro ou montant exact ; wallet EOA/type standard, capacités atomic masquées.
- Livraison LI.FI exige preuve provider liée au source hash, destination chain/token/decimals/recipient/minimum ; PARTIAL et REFUNDED conservent une issue distincte, aucune conversion automatique de DONE en succès.
- Web Locks exclusifs par wallet, dossier durable avant émission, ambiguïtés bloquantes après crash/perte de verrou, export mémoire post-échec d’écriture. Portée navigateur/profil/origine explicitée ; pas garantie multi-appareils.
- Rango conserve FAILED/refund/alternative avec evidence ; 1Click conserve la prudence face à un SUCCESS nu. Aucun tracker/restauration examiné ne demande de signature.
- Modes quotes/incident gardés aux entrées provider et au transport ; 1Click dry=false refusé serveur fermé ; Docker public par défaut quotes et arrêt runtime activé. Aucun gate registry/router/ABI réintroduit.
- Borne streaming ingress/upstream, origines canoniques, budgets séparés de suivi, header IP dédié sous proxy validé ; API historiques retirées. Image standalone non-root, pin digest, secrets exclus, une instance et ressources/logs bornés.

## Limites externes et qualification

Le profil public fourni ferme les fonds. Aucun transfert, remboursement ou approval réel n’est qualifié. Docker est documenté absent : build et démarrage de l’image, healthcheck/permissions, digest image final, scan image et Portainer ne sont pas démontrés par un build Next. HTTPS, Web Locks/navigateurs réels, clés/quota/conditions production, preuve destination on-chain, informations opérateur et autorisations de recette/publication restent externes.

La revue locale indépendante est terminée pour ce périmètre. Les constats identifiés sont traités et les tests ciblés ci-dessous passent. Ce résultat ne qualifie aucune opération avec fonds ni un déploiement cible : les tests utilisent des wallets/RPC/providers simulés, et une preuve de destination provider ne devient pas une vérification cryptographique ou on-chain indépendante.


## Traitement final des constats — revérifié le 4 octobre 2026

| Constat | État final | Preuve de code courant et vérification |
| --- | --- | --- |
| IR-1 P1 | Traité | `lib/intent/tracking.ts:30` reconstruit un suivi en lecture seule depuis le dossier v2 pour les trois providers. `components/SwapCard.tsx:293` et `:372` exposent ce suivi par dossier. Les minima, identités, hash et providerState sauvegardés restent liés ; aucun appel wallet/resume/sign. `tests/intent-tracking.test.ts` couvre notamment la perte des anciennes clés, les issues partielles et les identités invalides. |
| IR-2 P1 | Traité | Fonds/gas relus après la politique runtime à `lib/aggregators/rango/execute.ts:113-123`, `:157-167` et `lib/aggregators/oneclick/execute.ts:97-109`. La reproduction indépendante après correction exige zéro envoi si le solde chute pendant la politique et un dossier `not_emitted`. |
| IR-3 P2 | Traité | `lib/routing/quote.ts:40` applique la capacité LI.FI à l’éligibilité ; `components/RouteList.tsx:27` désactive le choix incompatible et affiche sa raison. Les tests policy, quote et présentation passent. Aucun gate registry/router/ABI ajouté. |
| IR-4 P2 | Traité | `lib/routing/orchestrator.ts:14` conserve une catégorie publique structurée ; `app/api/rango/[operation]/route.ts:22` transmet uniquement un code statique de configuration, consommé par le client. Reproductions indépendantes client réel → orchestrateur pour 503 configuration et 429 ; message amont sensible non repris. Les tests DOM couvrent aussi le résultat partiel vide. |
| IR-5 P2 | Traité | `lib/intent/journal.ts:188-189` refuse la réutilisation d’un nonce déjà associé à un hash ; `:282-287` exige le nonce sauvegardé et observé pour réconcilier. Absence de nonce historique reste manuelle. Les trois transports enregistrent, redemandent et imposent le nonce avant émission ; LI.FI à `lib/security/lifi-wallet.ts:117-140`. Les tests de nonce divergent/absent/ancien et de refus sans envoi passent. |
| IR-6 P2 | Traité | `lib/aggregators/rango/execute.ts:172-174` libère le pending UI uniquement après sauvegarde d’une non-émission établie ; `lib/aggregators/oneclick/execute.ts:114-117` persiste `FAILED/not_sent`. Recherche de nonce avant publication pending. Reproductions indépendantes du refus runtime et de l’échec RPC nonce : zéro envoi, aucun pending actif résiduel. Les émissions possibles restent bloquées. |
| IR-7 P2 | Traité | `lib/routing/quote.ts:14-31` valide identité/montant du gas avant éligibilité et `:49` évite le crash de réserve sur une route déjà interdite. `components/RouteList.tsx:25` rend le rejet explicite. La reproduction après correction observe éligibilité fausse et absence de TypeError ; les autres routes restent disponibles. |

### Vérifications exécutées directement par le relecteur

- **408/408 tests dans 21 fichiers ciblés** : journal/restauration, frontières des trois providers, SDK policy/allowance/transport, destination tracking, capacité économique, quotes/refresh/DOM, API/release et exécution. Commande exacte conservée dans `independent/final-targeted.log` ; exécution finale à 15:18:34 Europe/Rome (13:18:34 UTC), code retour 0.
- **13/13 reproductions indépendantes après correction dans trois fichiers**, configuration isolée `independent/vitest.config.mts` ; `independent/after.log`, exécution finale à 15:20:03 Europe/Rome (13:20:03 UTC). Ces tests emploient les vrais adapters/clients locaux avec wallet/RPC/HTTP simulés.
- **TypeScript réussi**, `npm run typecheck`, code retour 0 ; `independent/final-typecheck.log`.
- **27 fichiers historiques vérifiés sans différence** contre leur manifeste initial : `independent/historical-integrity.json`. Les fixtures et logs `*.before.*` sont conservés comme observations de défauts initiaux, pas comme tests devant passer sur le code corrigé.
- Empreintes des sources de cette clôture : `independent/review.sha256.json`, incluant le HEAD et l’heure. Le HEAD seul ne désigne pas les changements non commités examinés.

Le relecteur n’a pas exécuté lui-même de build Docker, de déploiement, de recette wallet réelle ni de transfert. Les résultats de build/lint et de qualification visuelle produits par les autres agents doivent être lus dans leurs propres preuves, avec leurs limites. Aucune correction d’implémentation n’a été écrite par ce relecteur.

# Analyse et plan de finalisation de Hermes

Audit du 4 octobre 2026. Périmètre : prototype EVM, LI.FI, Rango et 1Click, publication Docker sous Portainer. Ce document livre les décisions techniques, travaux et critères de fin ; il n'applique aucune modification applicative.

**Hermes est un prototype avancé de comparaison de cotations, fonctionnel localement, mais pas encore un MVP public qualifié pour des fonds.** Sa mise en ligne en mode cotations demande surtout un mode démo effectivement sans exécution, un emballage Docker reproductible, une protection des API et une vérification HTTPS. Son ouverture aux swaps demande d'abord de corriger quatre défauts LI.FI établis — minimum abaissable, remboursement/partiel assimilable à un succès, perte du verrou d'envoi ambigu et contrôle incomplet de la valeur native — puis de qualifier le périmètre de routes et la reprise des trois providers. Ajouter un agrégateur ne résout aucun de ces blocages.

La suppression des registres obligatoires et revues locales de contrats/ABI est bien effective. Le plan respecte cette décision : il n'impose aucune admission manuelle des routes. Les restrictions proposées concernent les capacités d'exécution réellement prises en charge et la conservation du consentement.

## A Diagnostic avec preuves et limites

### Version examinée et conservation du travail

- Répertoire : `/home/pierre/Downloads/swap-aggregator/swap-aggregator`.
- Branche : `feat/hermes-oneclick` ; HEAD : `86159fb636d1b779c85818a261b07e05512cd9f0`.
- Arbre non propre au début : 20 fichiers suivis modifiés, plus `research/` non suivi. La liste exacte et les SHA-256 de 449 fichiers suivis sont dans [baseline.json](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/baseline.json). **L'audit porte sur cet arbre de travail, pas sur le seul commit.**
- Aucun code applicatif, fichier de configuration, lockfile, test existant ou historique Git modifié. Les builds ont renouvelé les sorties ignorées `.next` et TypeScript ; les nouveaux livrables sont limités à ce dossier de recherche.
- Aucun package installé, aucun déploiement/publication, aucun wallet connecté, aucune signature, transaction, dépense ou démarche commerciale. `.env.local` n'a pas été lu ni affiché par les agents ; Next l'a chargé normalement pour son build/démarrage. Ses valeurs ne font pas partie des preuves livrées.
- Trois sous-agents explicitement `gpt-6.1-sol`, raisonnement `high`, ont traité produit, exécution et offres providers. Le coordinateur a relu les conclusions et les sources déterminantes, exécuté les vérifications générales et arbitré les priorités.

### Résultats refaits pendant cet audit

| Contrôle | Résultat | Portée exacte |
| --- | --- | --- |
| `npm run typecheck` | Réussi | Cohérence TypeScript de l'arbre actuel |
| `npm test` | **592 tests, 35 fichiers, tous réussis** | Tests unitaires/DOM et wallets/API simulés ; pas un transfert réel |
| `npm run lint` | Réussi | Script limité à `app components lib` |
| `npm run build` | Réussi, Next 15.5.27 | Build production ; première charge JS annoncée 397 kB pour `/` |
| `npm run start -- --hostname 127.0.0.1 --port 3187` | Démarré, page HTTP 200 | Serveur local de production, arrêté après contrôle ; aucun Docker/HTTPS distant validé |
| Entrées invalides | Token API 400 ; mauvaises origines Rango et 1Click 403 | Rejets locaux sans construction de swap |
| Navigateur intégré | Desktop environ 1265 px ; mobile 390 × 844 ; FR ; résolution adresse catalogue ; natif en premier ; EUR devenu disponible | Contrôle visuel ciblé, pas une campagne multi-navigateurs ni un wallet mobile réel |
| Cotation anonyme réelle | 0,01 ETH Base → ETH Ethereum : 9 routes à un instant, Rango et LI.FI | Présence de routes, aucun test de prix optimal ou de transaction ; 1Click natif exclu |
| `npm audit --omit=dev --json` | 16 entrées modérées, 0 haute, 0 critique | Un avis racine `decode-uri-component` se propage dans la chaîne WalletConnect ; analyse de joignabilité ci-dessous |
| Reproductions LI.FI locales | Baisse du minimum acceptée ; DONE/PARTIAL et DONE/REFUNDED donnent succès UI ; garde recréée permet un nouvel appel d'envoi après ambiguïté ; valeur native excessive franchit le préflight | Fonctions du SDK/garde réelles avec données simulées, sans réseau ni fonds |

Versions installées : Node 22.23.3, npm 12.2.0, Next 15.5.27, React 19.2.8, LI.FI SDK 4.7.0/provider Ethereum 4.1.0, viem 2.56.8, wagmi 2.19.5, RainbowKit 2.2.11. Les quatre reproductions ont aussi été relancées indépendamment par le coordinateur : [scripts et limites](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/repro/README.md), [résultats](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/repro/verification-coordinateur.json). Les journaux et l'inventaire npm sont dans [les preuves](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/verification.json). Les premières tentatives réseau/démarrage étaient bloquées par le sandbox ; les contrôles ont ensuite abouti avec l'autorisation technique d'exécution locale. Ce n'était pas un défaut applicatif.

### Carte des fonctionnalités

| Domaine | État réel | Preuve et limite |
| --- | --- | --- |
| Réseaux et catalogue | Implémenté, testé ; 9 réseaux EVM et 39 identités épinglées | [Catalogue][C1], [chaînes][C2]. Sélection immédiate ; aucune garantie de route/liquidité |
| Nom, symbole, adresse, pagination | Implémenté, testé ; exact catalogue local, autres recherches LI.FI | [Modale][C3], [service][C4]. Identité réseau/adresse ; `minPriceUSD: 0`, pas top-20 |
| Classement de marché | Implémenté ; CoinGecko/CMC par identité exacte ; natif prioritaire après correspondance exacte | [Classement][C5], [univers][C6]. Couverture/date/complétude par réseau insuffisamment visibles ; disponibilité des comptes fournisseur non qualifiée |
| Montants | Implémenté, testé avec BigInt | [Parser][C7]. Virgule/point ; rejette exposants, signes et excès de décimales |
| Prix USD et EUR | Implémenté mais vieillissement USD trompeur possible | [Prix][C8], [état UI][C9]. EUR BCE/Frankfurter daté, limite 7 jours ; ancien prix USD conservé après panne |
| Cotations anonymes et connexion | Implémenté, tests ; anonymes LI.FI/Rango observés dans le navigateur | [Routes LI.FI][C10], [1Click][C11]. Connexion change quoteKey ; aucun aperçu anonyme ne peut directement signer |
| Parallélisme et refresh | Implémenté et couvert par tests | [Orchestrateur][C12], [hook][C13]. Progressif, exécution bloquée pendant recherche, 30 s/15 s, annulation et reprise hidden/offline |
| Choix de route | Manuel possible mais préselection/remplacement implicites | [SwapCard:91][C14]. Fallback vers la première route lors de nouveaux IDs ; à corriger pour préserver le choix |
| Erreurs de cotation | Isolées techniquement ; information produit incomplète | [Hook:49][C13], [diagnostics][C15]. Une panne et une vraie absence de liquidité peuvent donner la même liste vide ; choix intentionnel documenté |
| LI.FI exécution | Branchée réellement, partiellement compatible ; défauts bloquants fonds | [Exécuteur][C16], [wallet][C17]. Les tests actuels n'établissent pas les garanties supposées sur minimum/succès/reprise |
| Rango exécution | Branchée, Basic EVM volontairement borné | [Exécuteur][C18]. Clé TEST publique ≠ testnet ; clé production et QA signée requises pour lancement Rango |
| 1Click exécution | Branchée, dépôt ERC-20 sur 8 réseaux ; pas Metis/natif source | [Exécuteur][C19], [validation][C20]. Frais Hermes non nuls désactivent le provider ; pas de remboursement automatisé |
| Reprise et réconciliation | Rango/1Click : un dossier localStorage par provider, état mémoire propre à chaque onglet sans synchronisation ; LI.FI absent après reload | [Rango tracking][C21], [1Click tracking][C22], [SwapCard][C14]. Pas de journal commun ni coordination onglets |
| Wallets | Connecteur injecté EVM seulement | [wagmi][C23]. Pas WalletConnect/QR ; mobile standard sans injection ne suffit pas |
| Desktop/mobile, FR/EN, a11y | Implémentés ; visuel ciblé observé | [Page][C24], [CSS][C25], [modale][C3]. Lecteurs d'écran, zoom et vrais wallets restent à qualifier |
| Socket | Absent fonctionnellement | [Stub][C26]. Non proposé par l'orchestrateur/UI ; ce n'est pas un provider réactivable par simple clé |
| Docker et Portainer | Absents | Aucun Dockerfile, Compose, `.dockerignore`, healthcheck, chaîne release/rollback dédiée dans le périmètre applicatif |
| Exploitation et support | Partiels ou absents | Quotas locaux et erreurs nettoyées présents ; collecte opérationnelle, alertes, procédures incidents et cadre public manquent |

### Les problèmes qui bloquent les fonds

**1. Minimum LI.FI non maintenu à la préparation.** Hermes donne au SDK un hook refusant les changements de taux. Pourtant, le SDK vérifie d'abord si la baisse du minimum de l'étape reste dans sa tolérance. Une unique étape passe de `1000000` à `995001` sans appel du hook ; le minimum global de la route reste `1000000`. L'interface peut donc continuer à afficher l'ancien minimum tandis que le SDK utilise la transaction de la nouvelle étape. Reproduction locale enregistrée ; [appel Hermes][C16], [comparaison SDK][S1], [tolérance SDK][S2], [mise à jour des étapes][S3].

Action : conserver une intention économique immuable ; vérifier les paramètres reconstruits de l'étape finale contre le minimum consenti avant chaque envoi, avec une nouvelle confirmation seulement pour un nouveau devis explicitement choisi. Une simple option `slippage: 0` n'est pas une correction démontrée : le SDK emploie `oldStep.action.slippage || standardThreshold`. Aucune revue de chaque ABI n'est nécessaire pour contrôler cette donnée fournie par le SDK, mais ce contrôle ne transforme pas le calldata tiers en preuve cryptographique de minimum.

**2. Succès LI.FI confondu avec terminaison du traitement.** Les sous-statuts `PARTIAL` et `REFUNDED` font partie des réponses `DONE`. Le SDK les reporte dans les actions et met l'étape à DONE. Hermes ne teste que `steps.every(...DONE)` et peut afficher la bannière de réception verte. Les reproductions retournent même une chaîne/un token alternatifs et un montant `1` sans empêcher cette condition UI. [Condition Hermes:238][C14], [task SDK][S4], [types de statut][S5].

Action : succès seulement si le statut et la sortie correspondent à l'intention conservée ; conserver et rendre les sous-statuts, destinataire, chaîne, token, montant et liens. Partiel/remboursé/intervention ne doivent jamais devenir « tokens attendus reçus ». La receipt source ne suffit pas. Une preuve API liée à la transaction reste une preuve fournisseur ; documenter quand une vérification receipt/logs destination est disponible, surtout ERC-20. Pour le natif/interne, ne pas inventer une preuve avec une simple variation de solde.

**3. Envoi LI.FI ambigu insuffisamment conservé.** `requiresReconciliation` vit dans l'objet wallet gardé. Une erreur après émission potentielle bloque une seconde demande sur cet objet, mais une nouvelle exécution le recrée. L'UI libère toujours son verrou dans `finally` et n'a aucun dossier persistant LI.FI. Reproduction : trois essais sur garde A, garde A puis nouvelle garde B donnent deux appels upstream d'envoi. Cela prouve une possibilité de resoumission après ambiguïté, pas un double débit observé. [Wallet:39-116][C17], [client:30-35][C27], [UI:239-243][C14].

Action : intention durable avant émission, enregistrement des actions/hashes, état ambigu bloquant et exportable. Reprise depuis stockage uniquement en lecture/suivi ; ne pas appeler aveuglément `resumeRoute`, susceptible de demander de nouvelles signatures. Le SDK possède déjà suivi/reprise et `updateRouteHook` : utiliser ses primitives sans lui déléguer la politique de consentement.

**4. Valeur native LI.FI insuffisamment contrôlée.** Pour une source native, la garde compare le solde au principal de la quote plus réserve gas, au lieu de la valeur effective de la transaction plus gas. Elle ne borne pas non plus cette valeur au débit consenti. Une fixture sélectionne `100` unités, prépare `100000000`, fournit un solde `50000` et un gas majoré `25200` : le mock reçoit quand même un appel d'envoi. Le wallet réel peut refuser une insuffisance de fonds ; cela ne corrige ni le préflight Hermes ni le consentement si le wallet possède davantage. Aucune transaction réelle ni réponse fautive d'un fournisseur n'a été observée. [Contrôle de solde](/home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/security/lifi-wallet.ts:89).

Action : vérifier systématiquement `candidate.value + gas` contre le solde natif, et borner la valeur au principal **plus les frais natifs explicitement cotés et consentis**. Ne pas imposer naïvement `value == principal` aux bridges qui exigent des frais natifs supplémentaires. Ce contrôle de l'enveloppe économique ne rétablit aucune liste de contrats ni revue ABI.

**5. Cotations LI.FI plus larges que l'exécuteur.** Les devis peuvent comporter une étape wallet sur destination, des signatures relayées ou une stratégie atomique. La garde n'accepte que les transactions EOA standard sur le réseau source, refuse typed data et `wallet_sendCalls`, mais expose `wallet_getCapabilities` : le SDK peut choisir une stratégie batch qu'Hermes refuse ensuite. Les balances restent en outre liées au token/montant source initiaux. Une route exigeant une action destination pourrait échouer après le bridge. [Routes][C10], [client:40-45][C27], [garde][C17], preuves détaillées dans l'annexe exécution.

Action : annoncer et filtrer les capacités supportées dès les cotations, configurer le SDK de façon cohérente avec la garde. Initialement : EOA injectée, opérations standard, approvals éventuelles puis une transaction de swap/bridge source avec livraison automatique ; aucune seconde étape wallet sur destination, typed permit, batch/AA/7702. C'est un périmètre de fonctionnalités, pas une liste locale de routeurs autorisés.

**6. Rango efface trop tôt le dossier en difficulté.** Un `failed` API, un remboursement ou un actif intermédiaire renvoyé devient `failed`, puis `finishRango` retire le dossier. L'application avertit de vérifier la transaction mais n'en conserve plus un historique durable. Il n'y a pas de renvoi automatique identifié ; le défaut est la perte de preuve et la possibilité de repartir sans réconciliation appropriée. [Tracking:30-42][C21], [UI:131-136][C14]. Le proxy supprime `bridgeData`/liens diagnostic que l'API officielle peut fournir.

Action : archiver l'issue et les preuves, distinguer échec source établi, livraison alternative, remboursement attendu/vérifié et issue inconnue. Bloquer la resoumission d'une même intention ambiguë ; permettre un nouveau swap indépendant seulement avec un état et un consentement clairs. Le succès Rango compare déjà token/chaîne/décimales/minimum ; il repose sur la sortie de son API liée à requestId/hash source, sans hash destination exploité par Hermes.

**7. Reprise navigateur incomplète sur les trois providers.** Une seule clé Rango et une seule clé 1Click ne coordonnent pas deux onglets ; un autre onglet ouvert avant l'envoi peut utiliser un état ancien et écraser un dossier. 1Click conserve correctement les statuts insuffisamment prouvés en attente, mais peut alors rester bloqué sans parcours de réconciliation lisible. [Stockage UI][C14], [1Click:94-104][C22].

Action : journal local versionné de plusieurs intentions, verrou par wallet/opération entre onglets, validation des migrations et export en lecture seule. Les données restaurées ne doivent jamais commander une signature. Ce stockage protège l'usage normal ; il n'est pas une autorité contre l'utilisateur qui efface lui-même ses données. Un serveur de suivi n'est pas requis pour la première version.

### Approvals et répartition des responsabilités

LI.FI est configuré avec `disableMessageSigning: true`. Dans le chemin standard installé, le SDK désactive Permit2 et construit une approval du montant de l'étape ; aucun MaxUint256 introduit n'a été trouvé dans ce chemin. La garde Hermes ne plafonne toutefois pas elle-même l'approval après retrait de l'authorizer : cette propriété dépend du SDK configuré. Une allowance préexistante supérieure n'est pas révoquée. Rango vérifie directement montant exact, token et spender égal au routeur de la transaction, avec reset si nécessaire. 1Click fait un `transfer` exact et ne crée aucune allowance. Les permis et signatures typées ne sont donc pas une fonctionnalité publique disponible aujourd'hui.

Le contrôle des soldes/gas existe pour natif **et ERC-20**, avec relecture après estimation ; sa branche native présente toutefois le défaut de valeur décrit plus haut. Une confirmation d'approval peut dépasser les 30 secondes de la quote : le swap est alors rejeté, tandis que l'approval déjà confirmée reste effective et payée. Il faut expliquer cette issue et reconstituer une nouvelle quote sans répéter l'approval inutilement. Vérifier la quote avant d'ouvrir le wallet ne contrôle pas le temps passé ensuite dans la fenêtre ; les deadlines effectives du provider/contrat restent déterminantes.

| Acteur | Responsabilité | Ce qu'il ne faut pas lui attribuer |
| --- | --- | --- |
| Hermes | Choix explicite, identité/consentement, minimum et frais affichés, contrôles de compte/réseau/fonds, compatibilité de route, conservation et interprétation des issues | Audit automatique de tous les contrats ou garantie de liquidité/rendement |
| SDK LI.FI | Préparation des étapes, appels wallet, approvals selon configuration, suivi et remontée de statuts | Garantie que les conditions `DONE` ou de slippage correspondent exactement au produit Hermes |
| API/agrégateurs | Devis, instructions, restrictions, information d'exécution et de remboursement | Disponibilité permanente, sortie inchangée entre devis et signature, authenticité absolue d'un token |
| Wallet | Clés, compte choisi, demande de confirmation et émission ; simulation si proposée | Réconciliation automatique du bridge ou validation du sens économique de tout calldata |
| Protocoles/bridges/solvers | Règles on-chain, règlement, finalité, éventuelles sorties alternatives/remboursements | Minimum et délai universels indépendants de la route, de sa version ou d'une défaillance |
| Opérateur Hermes | Intégrité du site distribué, clés serveur, mise à jour, information/support et qualification du cadre d'exploitation | Maîtrise des clés privées des utilisateurs ou contrôle des fournisseurs |

Ces frontières suivent les [statuts LI.FI](https://docs.li.fi/api-reference/check-the-status-of-a-cross-chain-transfer), les [routes à étapes](https://help.li.fi/hc/en-us/articles/16509431041307-How-do-I-use-the-API-endpoints-and-interprete-the-responses), la [préparation Rango](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/create-transaction-swap) et son [suivi](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/check-transaction-status). Les comportements SDK précis ont été vérifiés sur les versions installées.

### Outils de registre et documentation

Le registre et ses callbacks d'autorisation ne sont plus appelés par `executeSwapQuote`. Leur indisponibilité ne bloque pas le swap. Il reste néanmoins trois usages différents sous `lib/security/` : la garde wallet active ; l'univers de marché actif pour l'affichage ; les anciennes API/CLI de validation autonomes. Il ne faut donc pas supprimer tout ce dossier.

Conserver la CLI pour un diagnostic ponctuel ou archiver son mécanisme ; désactiver les routes `/api/security/registry` et `/api/security/validate` sur l'instance publique tant qu'aucun usage opérateur n'est retenu. Elles peuvent encore initialiser/écrire des fichiers ; `executionConfigured` est désormais un libellé trompeur de l'API diagnostic. Un contrôle Origin n'authentifie pas un client non navigateur. Aucun volume de registre n'est requis pour exécuter des swaps si ces routes sont hors service.

Documents à corriger : README décrit encore les cartes sous les champs, 189 puis 350 tests et un parcours commençant par connexion ; l'architecture annonce à un endroit un tri LI.FI market cap alors que la requête utilise `volumeUSD24H` et le classement final indépendant vient du marché ; TOKEN_SECURITY distingue bien le mécanisme ancien en tête, mais son corps affirme encore un registre obligatoire ; RANGO_INTEGRATION dit qu'un stockage indisponible ne limite que la reprise alors que l'intention pré-envoi fait désormais échouer l'envoi. Les remarques « navigateur inaccessible/non installé » ne décrivent pas l'environnement de cet audit. Les anciennes campagnes de recherche restent des archives, pas une preuve de production.

## B Travaux priorisés et critères d'acceptation

Priorités liées à une étape : **D0** nécessaire avant démo publique ; **F0** nécessaire avant fonds pour le provider concerné ; **P1** amélioration importante après périmètre initial ; **P2** option. Complexité S = 0,5–2 jours-personne, M = 2–5, L = 5–10 ; plages non additives lorsque les travaux partagent du code. Les critères ci-dessous sont des objectifs proposés, pas des résultats acquis.

| Priorité et ticket | Problème et impact | Fichiers concernés | Solution proposée | Dépendances | Complexité | Critère d'acceptation | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D0-01 | Aucun vrai mode cotations seules ; publier l'UI actuelle laisse des exécuteurs branchés | `lib/routing/execute.ts`, `SwapCard.tsx`, config ; proxy `/rango/swap` | Mode de release démo explicite, aucune méthode de signature appelée ; statut visible | Décision démo/périmètre | S–M | Connexion éventuelle et timers ne peuvent demander ni signature ni dépôt ; aucune route présentée exécutable | Tests aux entrées d'exécution + navigateur sans fonds |
| D0-02 | Pas de distribution Docker/Portainer reproductible | Dockerfile, `.dockerignore`, `next.config.js`, Compose et healthcheck à préparer | Image multi-stage non-root, digest versionné, stack une instance derrière proxy | Serveur, proxy, registry d'images | M | Image construite proprement, saine, redémarrage/rollback testés, aucun secret dans couches | Build isolé, scan image, smoke HTTP/HTTPS |
| D0-03 | Quotas globaux consommables par un seul client ; Rango bufferise corps/réponse ; API diagnostic exposées | `app/api/*`, `rango/server.ts`, `security/*`, proxy | Limites ingress, quotas par client + budgets upstream, borne stream/concurrence Rango ; désactiver diagnostic public | Proxy et trafic cible | M | Deux clients : abusive charge isolée, suivi reste disponible ; corps oversize rejeté avant chargement complet | Charge locale simulée, slow-body, 429/Retry-After |
| D0-04 | Frais LI.FI malformés peuvent casser React ; pannes présentées comme absence de route | `normalize.ts`, `details.ts`, `RouteList.tsx`, `useSwapQuotes.ts`, i18n | Validation présentation et récupération UI ; état neutre de comparaison partielle/retry | Aucun | S–M | Une route corrompue n'empêche pas les autres ; aucune erreur brute/secrète visible | Fixtures fee/token invalide ; 429/timeout partiel/total |
| D0-05 | Accès provider/conditions, information utilisateur et docs historiques non qualifiés | README, ARCHITECTURE, `.env.example`, aide publique | Configuration de production vérifiée ou provider désactivé ; infos opérateur/risques/données exactes | Clés/conditions, pays opérateur | S + attente externe | Pas de clé TEST annoncée production ; capabilities affichées ; docs cohérentes et versions datées | Revue de configuration sans divulgation, checklist publiée |
| F0-01 | Minimum LI.FI abaissé pendant reconstruction | `lifi/execute.ts`, `routing/quote.ts`, callbacks SDK/garde | Intention immuable ; borne minimum finale avant signature | Contrat SDK installé | M | Cas `1000000 → 995001` refuse envoi ; hausse admise ; UI et transaction préparée concordent | Reproduction SDK + test intégration transport |
| F0-02 | DONE/PARTIAL/REFUNDED affichable en succès | `SwapCard.tsx`, suivi LI.FI à créer, i18n | Mapping issues et validation destination liés à l'intention | F0-03 | M | Aucun vert pour mauvais actif, chaîne, montant insuffisant, partiel, refund ou preuve absente | Fixtures SDK réelles + replay statuts |
| F0-03 | LI.FI perd ambiguïtés ; dossiers Rango effacés ; 1Click difficile à réconcilier | `SwapCard.tsx`, trois trackers, journal partagé à créer | Journal durable versionné avant envoi, suivi sans signature, dossier exportable, conservation des échecs | Modèle d'intention commun | L | Reload à chaque frontière conserve hash/minimum/issue ; aucune resoumission ambiguë ; erreurs Rango archivées | Fault injection stockage/RPC, UI de reprise, anciens formats |
| F0-04 | Routes/méthodes incompatibles proposées | `lifi/routes.ts`, `lifi/client.ts`, `lifi-wallet.ts`, normalisation/UI | Capabilities EOA standard cohérentes ; route non compatible marquée et non exécutable | Choix initial sans étapes wallet destination | M | Aucun échec de méthode/network après première émission pour une route déclarée supportée | Wallet atomic-ready simulé, typed-data, multi-step, changement réseau |
| F0-05 | Choix explicite perdu au refresh ; double onglet possible | `SwapCard.tsx`, `RouteList.tsx`, journal | Reconfirmation lorsque l'identité de route change ; coordination navigateur | F0-03 | M | Nouveau requestId/autre provider ne remplace pas silencieusement le choix ; un seul envoi pour deux onglets concurrents | Tests DOM + deux onglets sans wallet réel |
| F0-07 | Valeur native réelle hors budget et préflight inexact | `lib/security/lifi-wallet.ts`, liaison des frais cotés | Comparer value réelle + gas au solde et au débit consenti | Intention et frais natifs de quote | S–M | Fixture 100 → 100000000 bloquée avant wallet ; frais natifs légitimes explicitement consentis admis | Reproduction native-value + gas/budget natif et ERC-20 |
| F0-06 | Aucun périmètre signé qualifié | Matrice QA, preuves de release, adapters | Simulations d'abord ; recette manuelle séparément autorisée et bornée | F0 précédents, wallet/budget utilisateur | M–L + délais bridge | Chaque classe ouverte dispose de preuves source/destination/amount ; zéro issue inexpliquée ; classes non testées fermées | Matrice F et revue des dossiers |
| P1-01 | Prix et marché anciens présentés comme actuels | `pricing.ts`, `SwapCard.tsx`, `market-universe.ts`, modale | Dates/TTL d'affichage, état périmé/partiel sans bloquer tokens | Aucun | S | Après pannes, prix retiré ou daté ; pas de top-100 inventé | Temps simulé + panne fournisseur |
| P1-02 | Diagnostics seulement console ; support faible | `routing/diagnostics.ts`, handlers API, runbooks | Logs structurés minimisés, métriques et alertes ; export choisi par utilisateur | Rétention/données décidées | M | Incident reproductible sans adresse/payload/clé dans logs automatiques | Injection erreurs + revue logs |
| P1-03 | Wallets/mobile/a11y insuffisamment qualifiés | `wallet.ts`, modales, i18n, CSS | Tester MetaMask/Rabby, focus, lecteurs d'écran ; documenter sans injection | Navigateurs ciblés | M | Pas de débordement ni blocage clavier sur tailles/zoom choisis ; wallet annoncé effectivement testé | Recette visuelle réelle |
| P1-04 | Dette dépendances/CI et maintenance SDK | package/lock, CI à préparer | Audit compatible, release figée, tests contrats SDK ; pas `audit fix --force` | Compatibilité ESM/CJS et Node | S–M | Avis critiques/hauts applicables traités, modérés justifiés ; mêmes checks sur image promue | SBOM/lock/audit, tests/build |
| P2-01 | Apport d'un 4e provider non établi | Comparateur existant et futur adapter Relay | Benchmark puis décision ; pas d'intégration par principe | MVP stable + seuil gain convenu | 2–4 j benchmark ; adapter 5–10 j hors QA | Gain/couverture reproductible supérieur au coût ; aucun recul minimum/reprise | Méthode D, puis QA complète provider |

Pour F0-03/F0-05, une base SQL n'est pas imposée : journal local + coordination d'onglets suffisent à traiter le défaut observé. Une reprise multi-appareils sera un besoin séparé, avec implications de confidentialité.

## C Feuille de route et conditions de fin

### Étape 1 Démo publique de cotations

Objectif : permettre de comparer sans déclencher de transactions. Garder les trois providers seulement s'ils disposent d'un accès compatible avec l'usage public ; afficher les limites de 1Click et des paires indisponibles. Les appels de quotes sont des requêtes en lecture, mais un mode connecté 1Click doit rester `dry: true` dans cette release si l'on promet une simple prévisualisation.

Ordre : figer les changements existants dans une version de travail approuvée ; D0-01 et D0-04 ; D0-03 ; emballage D0-02 ; D0-05 et smoke navigateur ; déploiement futur uniquement après décision de publication. Réutiliser le reverse proxy existant s'il est adapté.

**Fin mesurable proposée :** image identifiée par digest, 592 tests existants et nouvelles régressions pertinents verts, zéro appel aux méthodes wallet sensibles dans les tests du mode démo, page HTTPS/ressources/APIs testées, erreurs propres en cas de panne de chaque fournisseur, exercice restart/rollback réussi. Recette FR/EN à 390/768/1280 px et clavier. Essai de charge à trafic attendu (hypothèse initiale 5–10 utilisateurs actifs), sans épuisement imprévu des quotas ; 24 h de disponibilité observée sans boucle d'erreurs. Le seuil dépend de la capacité réellement retenue, pas d'un chiffre marketing.

**Estimation : 4–8 jours-personne**, un développeur connaissant Next/Docker, hors acquisition de clés/domaine, validation contractuelle et accès serveur. Le build et les tests actuels réduisent le travail de base ; l'absence de mode démo et de packaging empêche de réduire cela à « lancer docker compose ».

### Étape 2 MVP de swaps sur un périmètre validé

Priorité : F0-01 à F0-05 et F0-07, puis QA sans fonds, puis recette signée **ultérieure et explicitement autorisée**. Aucun test avec fonds n'a été exécuté pour ce rapport.

Périmètre proposé : wallet injecté desktop EOA ; Ethereum/Base/Arbitrum d'abord pour la recette, avec pairs natif/ERC-20 exactes disponibles chez le provider ; les autres réseaux restent visibles pour la découverte/cotation mais l'exécution n'est ouverte qu'après qualification de la classe correspondante. Cela ne constitue pas un registre de tokens : la recherche reste ouverte et les tokens hors catalogue conservent leurs contrôles habituels. On qualifie des capacités/réseaux, pas chaque route à la main.

LI.FI standard : approvals finies puis une transaction source, pas de typed permit/AA/batch ni de seconde action wallet destination. Rango : Basic EVM aux restrictions déjà présentes ; clé production. 1Click : dépôt ERC-20, preuves destination exigées, frais Hermes à zéro. On peut ouvrir un provider avant les autres si sa matrice est entièrement qualifiée ; les autres restent clairement en cotation seule. Aucune nécessité de bloquer tout le produit pour ajouter une fonctionnalité hors périmètre.

**Fin mesurable proposée :** tous les F0 de chaque provider ouvert clos et reproductions impossibles, zéro signature depuis timer/reprise/stockage, aucun double envoi après résultat ambigu, destination correcte et montant au moins égal au minimum enregistré, preuve persistante récupérable après reload. Pour chaque classe ouverte : un parcours réussi documenté par wallet ciblé et au moins une répétition sur un autre jour/route disponible, plus tous les scénarios négatifs simulés ; aucun pending inexpliqué laissé à la fin de la campagne. Cela valide un périmètre, jamais la totalité des contrats/bridges du marché.

**Estimation : 10–20 jours-personne supplémentaires**, hors dépenses et attentes de validation signée/fournisseur. La borne basse suppose que les hooks SDK permettent d'appliquer les contraintes sans refonte ; la borne haute inclut journal partagé, compatibilité et reprises. La disponibilité des liquidités et délais de bridge peut allonger le calendrier sans augmenter autant le temps de développement.

### Étape 3 Version durablement exploitable

Objectif : améliorer exploitation/support, ouvrir des classes supplémentaires seulement sur preuve, automatiser les releases et comparer un nouveau provider si utile. P1-01 à P1-04, puis au plus un ajout justifié. Préserver zéro secret navigateur, politique de confirmation et possibilité de fermer l'exécution tout en laissant le suivi accessible.

**Fin mesurable proposée :** 7–14 jours d'observation à trafic réel cible, indicateurs de succès/pending/429/latence interprétables, exercice de rollback et restauration de configuration documenté, procédure de changement de clé testée, aucune vulnérabilité haute/critique applicable non traitée, dossier de support exportable et politique de rétention décidée. Une cible de disponibilité doit être choisie après mesure ; ne pas annoncer un SLA sans engagement opérationnel.

**Estimation : 5–12 jours-personne supplémentaires** pour exploitation/qualité ; Relay ou tout autre provider est un lot indépendant. Total indicatif du socle : **19–40 jours-personne**, souvent **4–8 semaines calendaires** pour une personne, plus délais externes. Ce ne sont ni un devis contractuel ni une garantie de date.

## D Agrégateurs et méthode de sélection

La comparaison sourcée et les recommandations détaillées figurent ci-après et dans l'annexe fournisseurs. La liste des réseaux d'un fournisseur ne garantit jamais une paire/token/montant exécutable ; ses endpoints de chaînes/tokens et les devis restent la référence au moment de qualification.

**Décision recommandée : aucun quatrième provider exécutable pour la première release.** Après correction et qualification du socle, benchmark puis **un seul prototype Relay** si son bénéfice est mesurable. **CoW** passe devant un second cross-chain si Gnosis/same-chain constitue un usage prioritaire ; sinon **deBridge DLN** vient ensuite. Across reste un candidat spécialisé stablecoins/L2. Cette sélection est un jugement d'intégration, pas une preuve de meilleur prix.

Recherche documentaire au **4 octobre 2026** ; les détails réseau/token, authentification, signatures, fees, refunds et limites sont dans [ANNEXE_FOURNISSEURS.md](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/ANNEXE_FOURNISSEURS.md). Les disponibilités de comptes, tarifs non publiés et SLA n'ont pas été présumés. Aperçu « anonyme » signifie sans wallet connecté : plusieurs APIs exigent néanmoins une clé serveur et une adresse de simulation, toujours invalidée avant exécution.

| Candidat | Catégorie et périmètre utile | Accès et limites déterminantes | Exécution/reprise et apport distinct | Décision |
| --- | --- | --- | --- | --- |
| **Relay** | Cross-chain par intents/solvers, aussi same-chain ; intersection EVM des réseaux/tokens exposés | Quote v2, adaptateur viem ; clé requise avec referrer ; quote 50/min/clé | Étapes transaction/signature, recipient/refund explicites, suivi v3 ; app fees possibles ; accès direct à un moteur déjà présent via LI.FI | **Premier benchmark cross-chain**, puis prototype conditionnel. [API/quotas](https://docs.relay.link/references/api/api-keys), [réseaux/tokens](https://docs.relay.link/references/api/api_resources/supported-routes) |
| **CoW** | Enchères d'intents **same-chain**, dont Gnosis et plusieurs réseaux Hermes ; pas bridge autonome | API de base sans clé ; quote 10/s, orders 5/s, général 100/min documentés | Approval puis ordre EIP-712 ; UID, expiration/fill/annulation à conserver ; famille de liquidité/solvers différente | **Premier complément same-chain** si usage réel. [API](https://docs.cow.fi/cow-protocol/integrate/api), [déploiements](https://docs.cow.fi/cow-protocol/reference/contracts/core) |
| **deBridge DLN** | Ordres cross-chain par solvers, aussi same-chain ; Gnosis non établi dans la table consultée | Public 50/min ; authentifié 300/min ; clé dédiée pour usage commercial | create-tx, orderId, native fees/débit additionnel possibles ; annulation destination avec gas/autorité, refund parfois en réserve | Deuxième candidat cross-chain ; récupération plus coûteuse à intégrer. [Accès](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/authentication), [annulation](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/cancelling-order) |
| **Across** | Protocole de règlement par intents + Swap API ; surtout corridors natifs/stablecoins Ethereum/L2 | Production : Bearer + integrator ID ; quota/prix contractuel non établi ici | Approvals + swapTx ; expiry, deposit/fill/refund ; appFee fractionnaire ; remboursement pouvant prendre des heures | Ciblé, déjà observé via LI.FI et Rango. [Swap API](https://docs.across.to/introduction/swap-api), [clés](https://docs.across.to/introduction/api-keys) |
| **Socket/Bungee** | Méta-agrégateur cross-chain/same-chain, API V3 actuelle | Test public partagé ; production clé/affiliate, 20 RPS standard documentés | Quotes, approvals, transaction/deposit/signature selon flux ; migration complète depuis le stub Hermes | Différer ; aucune réactivation par simple toggle. [Guide V3](https://docs.socket.tech/integrate/integration-guides/socket-api), [accès](https://docs.socket.tech/integrate/get-api-access) |
| **Squid** | Cross-chain intents et routes Axelar/autres ; limiter à EVM | Integrator ID sur revue ; quotas publics non établis | Status avec quoteId peut participer au déroulement de l'exécution ; partial/needs-gas ; suivi durable plus complexe | Différer sans corridor absent précis. [API](https://docs.squidrouter.com/api-and-sdk-integration/api), [statuts](https://docs.squidrouter.com/api-and-sdk-integration/key-concepts/track-status) |
| **1inch** | Classic same-chain, Fusion intents same-chain, Fusion+ cross-chain | Clé/API serveur ; Free documenté 100 000 appels/mois et 60/min ; frais selon famille/plan | Classic simple ; Fusion+ exige secrets/hashlocks/escrows, reveal et reprise sûre ; gasless n'exclut pas approvals/funding | Classic seulement si gain mesuré ; **Fusion+ différé**. [Plans](https://business.1inch.com/portal/documentation/payment-methods/subscriptions), [secrets](https://business.1inch.com/portal/documentation/apis/swap/cross-chain-swap/sdk/when-and-how-to-submit-secrets) |
| **Velora** | Market same-chain ; Delta intents et offres cross-chain actuelles | SDK v10/Delta v2 ; pricing/quotas actuels non vérifiés, ne pas réutiliser ceux de ParaSwap | Market calldata ; Delta typed order construit serveur puis signé/posté ; maintenance d'un nouveau cycle d'ordre | Benchmark Market ; Delta plus tard. [SDK officiel](https://github.com/VeloraDEX/sdk), [documentation](https://www.velora.xyz/docs/llms.txt) |
| **0x** | Swap/Gasless same-chain **et offre Cross-Chain actuelle** | Clé chaque appel, Free 5 RPS ; frais fournisseur selon plan/paire | AllowanceHolder/Permit2 ; cross-chain agrège notamment Across/Relay/Squid/NEAR ; quoteId/origin hash et recovery | Chevauchement élevé ; choisir direct ou méta-agrégation après mesures. [Couverture](https://docs.0x.org/docs/introduction/supported-chains), [cross-chain](https://docs.0x.org/cross-chain/cross-chain-api/introduction), [prix](https://0x.org/pricing) |
| **OpenOcean** | Swap API V4 same-chain ; offre widget cross-chain distincte | Public 2 RPS ; frais dynamiques/referrer | Quantités integer, approvals/calldata ; minimum explicite variable selon réseau ; liquidité déjà parfois indirecte | Témoin de prix, faible priorité produit. [V4](https://docs.openocean.finance/docs/swap-api/v4), [accès](https://docs.openocean.finance/docs/swap-api/api-pricing-and-access) |
| **KyberSwap** | Agrégateur same-chain atomique, splitting | API officielle ; ne pas transposer quotas ZaaS ou frais Limit Order | Calldata/approvals, frais intégrateur ; autre algorithme, aucun meilleur prix démontré | Témoin supplémentaire, pas nouveau bridge par défaut. [Documentation officielle](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator) |

### Les trois options qui méritent une décision après benchmark

**Relay** convient à viem, mais ses étapes doivent traverser un adaptateur propre au provider : ne pas les envoyer dans `executeLifiRoute`. Premier périmètre transactionnel EVM avec approvals finies ; n'ouvrir permits/batching que dans un lot ultérieur. Fixer explicitement `refundTo` : les documents consultés divergent sur le défaut si ce champ manque. Un refund peut restituer un actif intermédiaire, diminué du gas, et certains petits montants peuvent être non remboursables. Les `appFees` s'accumulent pour réclamation en USDC et certains types les ignorent : valider le fee effectivement appliqué, pas seulement le champ envoyé. [Étapes](https://docs.relay.link/references/api/api_core_concepts/step-execution), [refunds](https://docs.relay.link/references/api/api_core_concepts/refunds), [app fees](https://docs.relay.link/features/app-fees).

**CoW** ajoute une famille d'ordres EIP-712 que la garde LI.FI refuse actuellement, mais l'intégrer séparément ne requiert pas de détendre cette garde. Conserver receiver, sell/buy amounts, validTo, appData et UID ; suivre les trades réellement exécutés. Son partage de partner fee est distinct du frais affiché au client. CoW ne réalise pas à lui seul Polygon USDC → Gnosis EURe : une composition bridge + CoW suppose un second devis sur le montant effectivement reçu et ne crée pas un minimum global garanti. [SDK](https://docs.cow.fi/cow-protocol/integrate/sdk), [partner fees](https://docs.cow.fi/governance/fees/partner-fee).

**DLN** peut fournir une alternative de solvers, au prix d'une récupération plus exigeante. L'option d'ajout des dépenses opérationnelles peut augmenter le débit source ; ne pas comparer ce résultat à un devis qui respecte un budget inférieur. Annulation/refund, autorités et gas destination sont un parcours à part entière. L'auto-annulation demande des conditions spécifiques et ne doit pas être présumée. [Réponse create-tx](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/creating-order/api-parameters/response), [auto-annulation](https://docs.debridge.com/dln-details/affiliates/auto-cancellations).

Estimation additionnelle **après socle prêt**, un développeur connaissant les adapters, hors approbation commerciale et délais de recette : Relay **5–9 j d'intégration + 4–7 j de QA** ; CoW **4–7 + 3–6 j** ; DLN **6–10 + 5–8 j** ; Across **4–7 + 4–6 j**. Ce sont des estimations d'ingénierie, pas des promesses fournisseur. Un benchmark en lecture seule des 2–3 candidats retenus : **2–4 j** avec clés disponibles. Socket/Squid/0x cross-chain sont de complexité au moins comparable ; Fusion+ reste un projet distinct. Les dates de dernière release, cadences de commits, SLA et incidents de chaque SDK n'ont pas été qualifiés : une documentation officielle active ne suffit pas à leur attribuer une maturité garantie.

### Comparaison reproductible avant toute intégration

1. Figer version du code/API, heure, réseau/adresse/décimales exacts, sender/recipient/refund, montant entier source, frais Hermes et slippage total. Comparer exact-input à exact-input ; natif/WETH, USDC/USDC.e et EURe V1/V2 sont différents. Une preview simulée ne qualifie pas le chemin wallet.
2. Lancer des requêtes parallèles bornées, journaliser départ/réponse/expiry et répéter sur plusieurs plages, tailles et familles de paires. Respecter les quotas ; distinguer absence de route, timeout et tarif/config incompatibles.
3. Normaliser **budget source total**, **output net**, **minimum**, gas source/approvals séparé ; identifier ce qui est déjà inclus avant toute déduction. Conversion fiat datée uniquement en métrique secondaire. Incomparable reste incomparable.
4. En composition, coter le second leg sur la sortie attendue puis sur le minimum du premier ; à l'exécution, sur la livraison réelle. Ne pas transformer deux minima indépendants en une garantie exécutable de bout en bout.
5. Mesurer couverture nouvelle, taux de devis utilisables, écart net/minimum, latence médiane/p95, changements au rebuild, 429, nombre d'actions wallet, recovery et qualité des preuves. Identifier bridge/DEX sous-jacents pour compter les chevauchements.
6. Ajouter au maximum un provider si un corridor utile ou un gain net répété compense sa maintenance **et** si les critères d'exécution/reprise sont satisfaits. Le seuil économique doit suivre les montants/usages visés ; aucun avantage chiffré n'a été établi ici.

Observation actuelle : Relay et Across figuraient déjà parmi les neuf routes anonymes ETH Base → Ethereum ; cela prouve un chevauchement précis, pas toute leur couverture. L'ancien comparateur local du 4 octobre n'a pas été relancé : son avantage attendu à deux étapes sur Polygon→Gnosis ne subsistait pas nécessairement avec le montant minimal livré, et ses métriques `economic_net`/`global_minimum` étaient nulles. Réutiliser sa méthode et ses limites, pas un prétendu gain garanti. [Dossier historique](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-shadow-comparator/README.md).

## E Architecture Portainer proposée

### Topologie de départ

```text
Navigateur EVM
  ├─ HTTPS domaine → reverse proxy existant → Hermes Next.js, une instance Docker
  │                                      ├─ API tokens/marché
  │                                      ├─ proxy Rango
  │                                      └─ proxy 1Click
  ├─ SDK LI.FI → API LI.FI directement (pas de clé privée navigateur)
  ├─ wagmi/wallet → RPC des réseaux
  └─ prix EUR → Frankfurter
Portainer → pilote la stack et l'image versionnée
```

Hypothèse recommandée : **Docker Standalone + stack Compose**, un seul service Hermes, réutilisation du proxy existant sur un réseau Docker dédié. Pas Redis/SQL/Swarm par défaut. Si le proxy tourne sur l'hôte, publier uniquement un port loopback ; s'il est conteneurisé, utiliser un réseau partagé et aucun port Hermes public. Portainer ne doit pas rendre l'administration Docker publique pour faire fonctionner Hermes. Les caractéristiques et le proxy du serveur n'ont pas été inspectés.

Next recommande un reverse proxy en auto-hébergement pour prendre en charge connexions malformées, tailles et limites d'accès ; cette partie complète les quotas applicatifs. [Guide officiel](https://nextjs.org/docs/app/guides/self-hosting).

### Liste exacte des fichiers à préparer lors de l'implémentation

| Fichier proposé | Contenu et rôle | Vérification attendue |
| --- | --- | --- |
| `Dockerfile` | Trois étapes deps/build/runtime ; base Node 22 compatible épinglée par version et digest ; `npm ci` au build ; utilisateur UID/GID fixe non-root ; copies minimales | Build depuis checkout propre sans `.env.local`, dépendances et architecture cohérentes, arrêt SIGTERM |
| `.dockerignore` | Exclure `.git`, `.env*` sauf éventuellement exemple, `node_modules`, `.next`, `.hermes-security`, `.tools`, recherche/preuves, logs, coverage, fichiers privés/caches | Aucune clé/rapport privé dans contexte ni couches ; `.gitignore` ne suffit pas |
| `next.config.js` | Ajouter `output: 'standalone'` sans retirer l'optimisation `viem/chains` | Présence et démarrage de `server.js` standalone ; aucune régression build |
| `deploy/compose.portainer.yml` | Image par tag de release **et digest**, réseau proxy externe, restart, healthcheck, limites CPU/mémoire, logging ; environnement serveur explicite | `docker compose config`, déploiement local de recette, rotation et restart |
| `deploy/env.example` | Liste runtime annotée sans valeur sensible ; mode démo/exécution, fournisseurs ouverts, clés et budget | Toutes les variables nécessaires documentées, aucune confusion build/runtime |
| `app/api/health/route.ts` | Santé locale légère et version publique non sensible, sans appel fournisseur | 200 si processus sain ; une panne LI.FI ne redémarre pas Hermes en boucle |
| `deploy/proxy.example.conf` | Exemple adapté au proxy réellement retenu : domaine/TLS, Host, forwarded proto, limites, routes diagnostics interdites | HTTPS et origine acceptés via proxy ; faux Host/Origin rejetés ; pas d'accès direct public |
| `.github/workflows/verify.yml` | Si GitHub est retenu : checks, build propre, audit/SBOM, image testée et digest ; secrets d'image séparés | Aucun push/publication automatique sans workflow autorisé ; promotion de la même image |
| `DEPLOYMENT.md` | Préparation, stack Portainer, variables, mises à jour, rollback, restauration et test de santé | Un second opérateur reproduit avec secrets fournis séparément |
| `OPERATIONS.md` | Incidents fournisseurs/RPC, quotas, logs, rotation clés, arrêt exécution sans couper tracking | Exercices de panne et de réconciliation réussis |
| `RELEASE_QA.md` | Version/hash, matrice F, résultats des preuves et limites de chaque release | Pas de réutilisation d'une preuve après modification invalidante |
| `.env.example`, README, ARCHITECTURE, TOKEN_SECURITY, RANGO_INTEGRATION | Mettre les instructions actuelles en tête ; séparer options diagnostiques et archivage historique | Plus de contradictions sur registre, stockage, tests et couverture |

Ce sont des fichiers **à préparer**, pas des modifications déjà effectuées. Les fichiers de journal/capacités et régressions applicatives des tickets F0 seront conçus pendant leur implémentation ; le présent rapport n'en impose pas une API prématurée.

### Construction et lancement

Le runtime standalone doit embarquer `.next/standalone`, `.next/static` et `public` : les deux derniers ne sont pas copiés automatiquement par ce mode. Lancer `node server.js` avec `HOSTNAME=0.0.0.0`, `PORT=3000`, `NODE_ENV=production`; ne pas employer `next dev`. `npm start` actuel reste une alternative valide avec toutes les dépendances nécessaires, mais produit une image plus large. [Next 15 output](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output), [exemple Docker officiel](https://docs.docker.com/guides/nextjs/).

Éviter les installations au démarrage et les tags `latest`. Conserver lockfile, version Node, empreinte de source et paramètres publics de build dans les métadonnées de release. Le build réalisé pendant cet audit utilisait les dépendances déjà installées ; il ne remplace pas un `npm ci` propre dans une image, non effectué car l'installation était hors autorisation.

### Variables et secrets

| Type | Variables actuelles | Conséquence |
| --- | --- | --- |
| Build public | `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` | Intégrée dans le JavaScript au build ; changer seulement Portainer après build ne suffit pas. Une valeur nouvelle exige une image reconstruite et testée |
| Runtime serveur providers | `LIFI_API_KEY`, `RANGO_API_KEY`, `RANGO_REFERRER_ADDRESS`, `NEAR_1CLICK_API_KEY`, `NEAR_1CLICK_JWT` | Injecter au démarrage ; jamais dans Docker ARG, repository, URLs/logs publics ou bundle |
| Runtime marché/quota | `TOKEN_SEARCH_REQUESTS_PER_MINUTE`, `CG_API_KEY`, `CG_API_TIER`, `CMC_API_KEY`, `TOP_ASSET_PRIMARY_PROVIDER`, `TOP_ASSET_FETCH_LIMIT`, `TARGET_UNIVERSE_SIZE` | Capacité à tester avec les plans réellement détenus ; les defaults ne valent pas abonnement/SLA |
| Diagnostic optionnel | `TOKEN_REGISTRY_PATH`, `TOKEN_CONFLICT_LOG_PATH`, quorum, listes historiques et politique security | Hors exécution actuelle ; omettre du profil public si les routes diagnostic sont désactivées |
| À concevoir | Mode cotations/exécution et providers effectivement ouverts | Une source de configuration cohérente ; ne pas croire qu'un toggle UI constitue seul une frontière de sécurité |

Le comportement `NEXT_PUBLIC_*` est documenté par [Next 15](https://nextjs.org/docs/15/app/guides/self-hosting). Le taux de frais doit être cohérent entre UI et serveur Rango ; zéro est le seul réglage initial compatible avec les trois providers tant que 1Click n'a pas sa monétisation intégrée. Pour LI.FI, vérifier séparément l'accès intégrateur et la réception effective des commissions avant toute promesse de revenu.

Les variables d'une stack Portainer restent accessibles aux administrateurs de cette stack et du daemon : c'est une restriction d'accès, pas un coffre-fort. Sur Standalone, la documentation prévoit variables explicites et `stack.env`. Swarm emploie un autre mécanisme ; ne pas y transposer aveuglément `env_file`. Les clés ne se partagent pas dans le rapport. [Portainer stacks](https://docs.portainer.io/user/docker/stacks/add).

### Droits, santé, limites et journaux

Proposition initiale à mesurer : conteneur runtime non-root, `cap_drop: ALL`, `no-new-privileges`, racine en lecture seule si tests compatibles, `/tmp` en tmpfs, seul cache Next nécessaire accessible en écriture. Aucun Docker socket monté. Une instance ; ordre de grandeur **0,5–1 CPU et 512 MiB–1 GiB de RAM runtime**, avec marge à mesurer. Ce ne sont pas les ressources constatées du serveur. Construire ailleurs si celui-ci est contraint ; le build peut demander nettement plus de mémoire que le runtime.

`restart: unless-stopped`, healthcheck par `node`/fetch local (ne pas ajouter curl seulement pour cela), exemple de cadence 30 s, timeout 3 s, trois échecs ; une alerte distincte traite un conteneur unhealthy. Un healthcheck Docker ne garantit pas à lui seul un redémarrage d'un processus toujours vivant. Rotation `json-file` avec `max-size: 10m`, `max-file: 3`, ou driver local borné ; ajuster au trafic. Limites `mem_limit`/`cpus` adaptées à Standalone, pas une confiance aveugle dans une section Swarm non appliquée. [Référence Compose](https://docs.docker.com/reference/compose-file/services/).

Le proxy doit écrire lui-même Host/protocole transmis et éliminer les valeurs clients non fiables, n'accepter que le domaine configuré, limiter tailles/temps de lecture et accès API. Les APIs Rango/1Click comparent Origin au Host et à forwarded-proto ; `/api/security/validate` utilise un autre contrôle d'origine susceptible d'échouer derrière TLS : son maintien éventuel doit être testé séparément. Les requêtes sans Origin restent possibles : ce n'est pas une protection contre les robots.

### Sauvegarde, mise à jour et retour arrière

Aucun volume métier n'est indispensable au profil public sans diagnostics : les quotes/caches sont régénérables et les dossiers de swap actuels vivent **dans le navigateur**. Sauvegarder le conteneur ne restaure donc pas un transfert perdu par effacement de localStorage. Le panneau d'export du journal est un travail F0, et la confidentialité du fichier doit être expliquée.

Sauvegarder stack, configuration proxy/DNS, paramètres non secrets, références d'images/digests, secrets dans le moyen protégé de l'opérateur, et éventuels dossiers diagnostics si conservés. Tester la restauration de ceux-ci avec UID et permissions. Ne pas sauvegarder `.next` comme source de vérité.

Mise à jour : CI/checks → image immuable → recette privée → promotion du même digest → vérification page/API/provider read-only. Retour arrière : remettre le digest précédent et son jeu de configuration, vérifier la compatibilité des versions de journal navigateur, préserver les intentions en cours. Fermer temporairement les nouvelles exécutions si une migration de suivi ne sait pas relire les dossiers ; le suivi reste accessible. Faire un exercice de rollback avant ouverture aux fonds.

## F Matrice QA et recette sans confusion de preuves

### Matrice minimale

« Automatisé » indique une preuve disponible ou à compléter en environnement simulé. « Manuel futur » ne constitue pas une permission de signer maintenant.

| Parcours critique | LI.FI | Rango | 1Click | Réussite attendue |
| --- | --- | --- | --- | --- |
| Aperçu anonyme puis connexion | Live anonyme observé + tests | Live anonyme observé + tests | Tests dry ; live ERC-20 à qualifier | Ancien aperçu inexécutable après connexion ; recipient lié au wallet |
| Identité/amount/minimum | Tests existants + régression baisse SDK à ajouter | Tests quote→swap | Tests quoteResponse→dépôt | Aucun écart chaîne/adresse/décimales/amount/recipient/minimum accepté |
| Natif/ERC-20 et gas | Natifs et ERC-20 ; vérifier valeur préparée/frais | Valeur native exacte ; ERC-20 value 0 | ERC-20 seulement ; natif rejeté explicitement | Solde suffisant pour principal **et** gas/approval ; aucune promesse pour natif 1Click |
| Approval zéro/existante/insuffisante | Exacte standard SDK ; grande allowance préexistante signalée si utile | Reset puis exacte ; rebuild et receipt | Sans approval | Aucune nouvelle approval illimitée ; rejet wallet ne continue pas |
| Confirmation lente >30 s | Ajouter cas SDK avant/après approval | Test existant à compléter UI | Devis frais + deadline marge 30 s | Devis expiré refusé ; aucune re-signature automatique ; dossier explique l'approval seule |
| Wallet/réseau modifié en async | Gas, metadata, préparation, signature | Idem | Idem | Dernière frontière vérifie compte/réseau ; aucun mauvais compte envoyé |
| Capacité wallet/multi-step | EOA standard ; atomic-ready/typed/AA/destination à simuler | Basic EVM compatible, rejets anticipés | Transfer EOA compatible | Pas de quote déclarée exécutable qui échoue après financement pour méthode non supportée |
| Panne/refus au wallet | Ambiguïté durable à corriger | Intention avant send ; rejet explicite distinct | Intention avant transfer ; rejet explicite distinct | Rejet 4001 permet sortie propre ; timeout/erreur inconnue conserve l'intention |
| Hash reçu, receipt absente/revert/remplacement | Journal à créer, remplacement à qualifier | Conservation puis statut à préciser | Revert source reconnu ; remplacement à qualifier | Hash/nonce conservés ; pas de renvoi à cause d'un timeout ; hash remplacé réconcilié |
| Receipt source OK | Suivi destination SDK, affichage à corriger | Suivi API output | Suivi API lié à quote/source | Jamais succès destination sur seule receipt source |
| Partial/refund/bare success | Régressions DONE/PARTIAL/REFUNDED obligatoires | Ne plus supprimer le dossier | Reste actif faute de preuve, à rendre compréhensible | Sortie alternative/remboursement/intervention nommés ; faux succès impossible |
| Reload à chaque frontière | Manquant actuellement | Reprise présente | Reprise présente | Suivi seulement, minimum/identités/hash restaurés, aucun timer signant |
| Deux onglets/stockage cassé | À ajouter | À ajouter | À ajouter | Un seul intent émetteur ; pré-envoi impossible si persistance échoue ; post-envoi reste récupérable |
| Pannes providers/RPC, 429 | Pas de retry d'émission ; quotes isolées | Budgets suivi protégés | Coalescing et quotas vérifiés | Erreurs distinctes de zéro route, backoff borné, aucun secret dans diagnostic |
| UI FR/EN mobile/desktop/a11y | Commun | Commun | Commun + statuts localisés | Min/gas/choix lisibles, focus restauré, statut annoncé sans spam de countdown |
| Livraison réellement signée | **Non vérifiée** | **Non vérifiée** | **Non vérifiée** | Recette séparée avec preuves source et destination exactes |

Ajouter des tests qui reproduisent les défauts réels, pas un objectif artificiel de nombre de tests. Vérifier aussi décimales extrêmes, uint256, frais malformés, valeurs trop grandes pour affichage fiat, source/destination identiques, tokens homonymes, non-catalogue indisponible, flagged persistant dans la session, signalement après affichage d'un ancien devis. Conserver la distinction catalogue local et découverte distante.

### Protocole de validation manuelle future avec fonds

1. L'utilisateur désigne le wallet de recette, les chaînes/classes ouvertes et un budget maximal par transaction et cumulé, gas compris. Utiliser un compte dédié ne contenant que le montant de recette ; ne jamais demander la seed ou la clé privée. Le montant doit respecter le minimum réel du provider ; pas de valeur universelle inventée.
2. Figer commit, image/digest, paramètres publics et versions SDK. Archiver devis, quoteKey, timestamp/deadline, destinataire et min ; vérifier les adresses officielles des actifs choisis pour la recette.
3. Faire un aperçu puis connexion et nouveau devis, comparer les champs affichés et la demande wallet. Refuser tout changement inattendu de réseau/token/montant/destinataire/value/approval/minimum. L'utilisateur effectue lui-même les confirmations financières.
4. Conserver intention avant envoi, hashes/receipt source, requestId/depositAddress/routeId, statuts et preuve destination. Comparer identité, decimals et montant entier livré au minimum enregistré. Dans un scénario refund, prouver l'actif et le montant effectivement revenus ou conserver une intervention ouverte.
5. Tester une interruption/reprise sûre et un rejet wallet explicite. Les scénarios dangereux — API compromise, panne après émission, double onglet — restent d'abord simulés, pas provoqués avec fonds. Aucune suppression de dossier pour « débloquer » un essai.
6. Revue du dossier par un second passage, sans confondre 200/API DONE et livraison. Ouvrir seulement les classes avec preuve complète. Tout test supplémentaire avec fonds suit le budget et les décisions prévus, jamais une relance après résultat ambigu.

**Arrêt immédiat :** min réduit, identité/destinataire modifiés, approval inattendue/illimitée, signature issue d'un timer, doute sur l'émission, suivi perdu, sortie différente, slippage/frais dépassant le consentement, quota/panne empêchant la preuve. Conserver le dossier et réconcilier ; aucune nouvelle transaction pour vérifier si la précédente « est partie ».

## G Exploitation publique et décisions nécessaires

### Capacité, appels et coûts

Le code sait limiter une partie de la charge, mais il ne sait pas aujourd'hui répartir équitablement un quota global entre visiteurs. Rango : 60 quotes/min, 60 préparations/min, 120 suivis/min, timeout 14 s ; pas de coalescing/concurrence maximale explicite équivalente à 1Click, et `request.text()`/`response.json()` chargent avant vérification complète. 1Click : quotas 60/240/60, concurrence 8/8/2, corps 4 KiB, réponses 2 MiB, coalescing, cache tokens 5 min. Recherche tokens : 60 upstream/min par défaut, concurrence 8, cache 256 × 60 s ; son compteur est distinct des 120/min LI.FI du transport marché. Une même clé/provider peut donc être consommée par plusieurs budgets locaux.

Le marché `/api/tokens/universe` compte 60 requêtes entrantes/min même si la donnée est déjà en cache. Le formulaire poll toutes les 10 s pendant l'enrichissement, sinon environ 60 s. Dix navigateurs en enrichissement approchent donc déjà ce plafond ; aucune base Redis ne résout à elle seule ce mauvais dimensionnement.

Ordres de grandeur arithmétiques, **pas benchmark de capacité** : une quote toutes les 30 s consomme 2 appels/min/provider/utilisateur ; 60/min représente au mieux 30 utilisateurs actifs, moins avec saisies/refresh et retry à 15 s. Un polling à 8 s produit 7,5 requêtes/min/dossier : plafonds théoriques Rango 16 suivis simultanés et 1Click 32, sans marge. Le status 1Click continue selon son timer sans politique globale de trafic multi-onglets. Réserver les budgets de suivi, introduire jitter/backoff et métriques, réduire les appels inutiles avant d'augmenter aveuglément les limites.

Pour une instance initiale, cache mémoire + limites du proxy + budgets applicatifs suffisent si le trafic cible est faible et testé. Redis ne se justifie que pour plusieurs replicas/hosts, un quota global strict, ou une capacité mesurée l'exigeant. Les cotations SDK LI.FI et RPC navigateur échappent aux quotas serveur Hermes ; protéger le proxy ne les couvre pas.

Les RPC wagmi sont les endpoints par défaut des chaînes via `http()`, sans plan RPC explicitement configuré dans Hermes. Vérifier chaque réseau retenu, timeout/pannes et contraintes d'accès ; aucun secret RPC privé dans le JavaScript. Un proxy RPC éventuel doit être à méthodes/chaînes bornées, jamais un relais arbitraire. Ne pas ajouter de rotation de fournisseurs en douce.

Coûts non chiffrables sans trafic/serveur/plans : hébergement et egress, appels market/token/quote, surveillance, domaine/certificats selon infrastructure, maintenance et support. Le gas/approval est payé par les utilisateurs, même quand le swap n'aboutit pas ; le budget de recette est séparé. Les frais intégrateur ne sont pas une recette garantie. Commencer à frais Hermes zéro évite un conflit avec 1Click et simplifie la comparaison.

### Dépendances et intégrité des assets

L'audit npm refait trouve 16 entrées modérées liées à un avis de déni de service dans `decode-uri-component <=0.4.2`; correctif indiqué en 0.5.0. L'avis porte sur une consommation CPU excessive, sans divulgation/RCE annoncée. Le connecteur WalletConnect n'est pas activé dans Hermes ; le package n'apparaît pas dans les traces serveur `.nft.json` examinées et les marqueurs cherchés n'ont pas été retrouvés dans les bundles JS. Cette recherche de marqueurs n'est pas une preuve complète d'absence de code minifié ni de non-exploitabilité. Ne pas appliquer la migration majeure/downgrade suggérée automatiquement par npm sans analyse de compatibilité. [Avis officiel mainteneur via GitHub](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).

Next 15.5.27 installé correspond à la version Maintenance LTS corrigée annoncée le 30 septembre 2026. Cela traite cette vague d'avis, pas toutes les futures vulnérabilités ni l'image Docker encore inexistante. Aucun motif établi ici d'imposer une migration Next 16 avant la démo. [Publication Next](https://nextjs.org/blog/september-2026-security-release).

L'intégrité du JavaScript distribué est particulièrement importante pour un DEX : un site altéré peut changer l'intention avant le wallet. Release/digest figés, source relue, droits CI/registry limités, absence de dépendances téléchargées au runtime, TLS, pas de cache CDN mélangeant releases, headers anti-framing/nosniff/referrer et CSP testée font partie du plan. Déployer d'abord CSP en observation si sa compatibilité avec Next/wallet/RPC/images n'est pas établie, puis l'appliquer ; ne pas inventer une CSP qui casse les swaps. Les SVG locaux sont déjà liés aux identités exactes et testés sans scripts ; les logos externes restent des images HTTPS, pas une preuve de sécurité. Documenter marques/licences selon TOKEN_LOGOS.

### Observabilité et support

`lib/routing/diagnostics.ts` filtre les événements et ne copie ni wallet, amount, raw error, URL ni clé. Bonne base, mais sortie actuellement dans la console navigateur, sans collecte opérateur. Prévoir côté serveur : endpoint/provider, latence, status HTTP, catégorie, quota/concurrence/cache et identifiant aléatoire de requête ; aucun body, paramètre d'URL contenant dépôt, credential ou adresse par défaut. Un export de dossier par l'utilisateur peut contenir adresses/hashes : action explicite, destinataire identifié et conservation limitée.

Alertes utiles : hausse durable 429/5xx ou timeouts, frais/config provider incompatibles, croissance mémoire/disque, conteneur unhealthy, échecs de build, échéance TLS, taux anormal de dossiers en attente lorsque cette information est effectivement collectée avec consentement. Pas d'alarme pour chaque absence économique de route. Distinguer incident RPC, API, wallet rejeté, bridge en attente et défaut UI. Prévoir arrêt des nouveaux swaps en incident en conservant le suivi et les preuves ; aucun mécanisme d'alerte ne signe.

Support minimal : consulter une transaction, reconnaître un actif intermédiaire, retrouver la demande avec hash/provider/requestId, exporter la preuve, procédure refund du fournisseur, limites des données du navigateur. Ne jamais demander clé privée/seed ; ne jamais conseiller une seconde émission tant que la première est ambiguë. Les anciens journaux du registre ne remplacent pas les dossiers de swaps.

### Questions juridiques et commerciales contextualisées

Déterminer le pays de l'opérateur, les pays ciblés, la forme d'exploitation et les fonctions exercées : simple affichage, facilitation/exécution d'ordres, commissions, publicité ou promotion d'actifs. Dans l'UE, il ne faut pas déduire une exemption MiCA du seul fait que les utilisateurs gardent leurs clés : la qualification des services et la décentralisation se jugent selon les faits. L'ESMA rappelle une appréciation au cas par cas par les autorités pour la décentralisation complète ; l'article 59 traite l'autorisation des prestataires concernés. Cela nécessite une qualification adaptée au projet, pas une conclusion juridique universelle de cet audit. [ESMA réponse publiée](https://www.esma.europa.eu/print/pdf/node/222469), [article 59](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-59-authorisation).

Décider quelles données sont traitées : logs IP du proxy, adresses transmises aux agrégateurs/RPC, localStorage et exports de support, analytique éventuelle, durées et transferts internationaux. Une adresse publique ne rend pas automatiquement tout traitement anonyme ; la CNIL décrit les enjeux de données personnelles sur blockchain. Préparer les informations utilisateur pertinentes pour l'exploitation retenue, sans ajouter un bandeau cookie universel si aucun traceur ne le justifie. [CNIL](https://www.cnil.fr/fr/technologies/blockchain-et-rgpd-quelles-solutions-pour-un-usage-responsable-en-presence-de-donnees-personnelles).

Pour chaque API retenue : vérifier droit d'usage public/commercial, attribution, politiques territoriales, frais/référencement, quotas et droit de mise en cache. Les clés de test et endpoints sans clé ne prouvent pas une autorisation de production ni une gratuité contractuelle. Aucun fournisseur n'a été contacté en votre nom.

### Décisions utilisateur regroupées

1. **Lancement et commission** : démo cotations d'abord puis fonds graduels — recommandé — et frais Hermes zéro au départ, ou exigence de commissions dès l'ouverture qui impose d'ajuster le périmètre 1Click et les contrats intégrateurs.
2. **Infrastructure réelle** : Docker Standalone ou Swarm ; version Portainer, architecture CPU, RAM/disque libres, proxy existant et réseau Docker, domaine/DNS, accès au registry d'images. Le plan réutilise le proxy ; il n'en invente pas un serveur.
3. **Périmètre de support et recette** : wallets/navigateurs et premiers réseaux ; qui confirme les tests avec fonds et budget maximal. Proposé : desktop injecté, Ethereum/Base/Arbitrum pour commencer, autres capacités selon QA.
4. **Exploitation** : pays/opérateur/public cible, niveau de support, informations collectées et rétention. Les clés/plans API et éventuels avis professionnels se déterminent sur ce périmètre.

Aucune décision sur Redis, SQL, registre bloquant ou ajout massif de providers n'est nécessaire pour commencer. Ces quatre groupes suffisent à organiser l'implémentation ; les détails techniques réversibles restent des choix de réalisation.

## H Backlog différé et fin du projet

Différer jusqu'à besoin établi : WalletConnect/QR, wallets non-EVM/Solana, AA/EIP-7702/permit/batching, exécution avec étapes wallet destination, historique multi-appareils, SQL/Redis/multi-instance, scoring des bridges, GoPlus présenté comme preuve de sûreté, remboursements automatiques et composition maison bridge + DEX. Ne pas réactiver Socket comme un simple toggle. Une application PWA, des animations supplémentaires ou un comparateur de nombreux providers ne bloquent pas le MVP.

L'ajout d'une source marché payante n'est justifié que si son bénéfice de couverture/quotas est mesuré. Ne pas transformer les anciens outils de consensus en nouveau processus d'autorisation de chaque token/route. Leur archivage/documentation peut être un petit lot, sans chantier de refonte du moteur d'exécution.

**Le MVP est fini lorsque le périmètre annoncé est exactement celui testé et ouvert, que les dossiers ambigus ne peuvent pas être renvoyés, que le succès signifie la livraison attendue et que l'opérateur peut redémarrer, diagnostiquer et revenir à une image connue.** L'expansion à toutes les chaînes et toutes les stratégies du marché appartient aux versions suivantes.

### Ce qui n'a pas été vérifié

Signatures et transferts réels ; destination on-chain/refunds ; intégrité de tous les contrats/protocoles ; wallets MetaMask/Rabby/mobile réels ; tous navigateurs/lecteurs d'écran ; toutes paires/tokens ; quotas et accords de vos comptes de production ; serveur Portainer, DNS/TLS et proxy existants ; image Docker propre et scan OS ; charge réelle/sécurité complète du serveur ; confidentialité des valeurs de `.env.local` par scan exhaustif du bundle (aucune lecture de secrets n'a été faite) ; conditions juridiques propres à votre exploitation. La démo live est une observation ponctuelle, pas un benchmark ni une garantie de disponibilité future.

## Dossier de preuves et annexes

- [Annexe produit](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/ANNEXE_PRODUIT.md) : parcours, interface, accessibilité et fichiers/lignes.
- [Annexe exécution](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/ANNEXE_EXECUTION.md) : restrictions, défauts et mécanismes SDK.
- [Annexe fournisseurs](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/ANNEXE_FOURNISSEURS.md) : onze candidats et sources officielles.
- [Vérifications](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/verification.json), [observations navigateur](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/OBSERVATIONS_NAVIGATEUR.md), [reproductions locales](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/repro/README.md).
- [Contrôle final des fichiers suivis](/home/pierre/Downloads/swap-aggregator/swap-aggregator/research/2026-10-04-finalisation/evidence/integrity-final.json).

Les annexes sont des analyses spécialisées ; les priorités, estimations et arbitrages du présent rapport font référence.

## Références de code

Les liens visent l'arbre de travail analysé. Le snapshot de hashes fixe l'état ; une modification ultérieure peut déplacer les lignes. Les annexes donnent les références détaillées et les reproductions fournissent les résultats bornés.

[C1]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/TOKEN_CATALOG.md:19
[C2]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/chains.ts:1
[C3]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/components/TokenSelectModal.tsx:38
[C4]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/tokens/search.server.ts:36
[C5]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/tokens/ranking.ts:15
[C6]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/security/universe.server.ts:118
[C7]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/amounts.ts:1
[C8]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/pricing.ts:9
[C9]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/components/SwapCard.tsx:146
[C10]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/lifi/routes.ts:27
[C11]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/oneclick/client.ts:68
[C12]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/routing/orchestrator.ts:16
[C13]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/routing/useSwapQuotes.ts:38
[C14]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/components/SwapCard.tsx:91
[C15]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/routing/diagnostics.ts:1
[C16]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/lifi/execute.ts:5
[C17]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/security/lifi-wallet.ts:19
[C18]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/rango/execute.ts:84
[C19]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/oneclick/execute.ts:25
[C20]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/oneclick/validation.ts:3
[C21]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/rango/tracking.ts:25
[C22]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/oneclick/tracking.ts:94
[C23]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/wallet.ts:11
[C24]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/app/page.tsx:7
[C25]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/app/globals.css:286
[C26]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/socket/execute.ts:1
[C27]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/lib/aggregators/lifi/client.ts:25
[S1]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/src/core/tasks/helpers/stepComparison.ts:27
[S2]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/src/core/utils.ts:15
[S3]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/src/core/StatusManager.ts:218
[S4]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/src/core/tasks/WaitForTransactionStatusTask.ts:65
[S5]: /home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/types/src/api.ts:734

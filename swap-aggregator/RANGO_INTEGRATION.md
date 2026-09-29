# Rango — intégration EVM bêta

## Démarrage sans configuration

Rango et LI.FI sont activés par défaut et peuvent être désactivés individuellement.
Socket reste désactivé. Les recherches des providers sélectionnés sont parallèles ;
une erreur Rango ne supprime pas les routes LI.FI, et inversement.
Le tri compare les montants reçus en entiers, sans fusionner des routes de
providers différents. « Meilleur montant » désigne uniquement le plus grand
montant de sortie, pas un conseil ni le coût total après gas.

Sans `RANGO_API_KEY`, le serveur utilise la clé publique de test publiée par
[Rango](https://docs.rango.exchange/api-integration/api-key-and-rate-limits)
sur `https://public-api.rango.exchange`. Une clé privée configurée utilise
`https://api.rango.exchange`. Aucun paramètre client ne peut modifier l'hôte ou
la clé. La clé publique a de faibles quotas et n'est pas destinée à la production.
Une clé d'intégration privée devra être obtenue auprès de Rango avant production.

**Test API ne veut pas dire testnet : les réseaux et fonds sont réels.**
Les tests automatisés simulent les wallets et n'envoient aucune transaction.

## Contrat serveur

| Endpoint local (POST JSON) | Entrée | API Rango |
| --- | --- | --- |
| `/api/rango/quote` | `params` : chaînes, contrats, montant entier, compte | `/basic/quote` |
| `/api/rango/swap` | Même `params` + `swapper` sélectionné | `/basic/swap` |
| `/api/rango/status` | `requestId`, `txId` | `/basic/status` |

Entrées bornées à 4 K caractères, réseaux autorisés, adresses EVM et montants
uint256 stricts, type JSON et origine contrôlés. Réponses `no-store`, timeout
serveur 14 s/client 15 s, erreurs sans détails privés. Budgets indépendants par
processus : 60 cotations, 60 préparations et 120 statuts par minute. Il ne s'agit
pas d'une protection distribuée ; prévoir des quotas partagés en production.

Paramètres imposés côté serveur : destinataire égal au wallet source, slippage
0,5 %, `infiniteApprove=false`, `enableCentralizedSwappers=false`,
`avoidNativeFee=true`. Les transactions avec frais natifs supplémentaires à
joindre au principal sont exclues pour cette première version. Les frais Hermes
passent explicitement dans `referrerFee`, y compris zéro. Au-delà de zéro,
`RANGO_REFERRER_ADDRESS` doit être une adresse EVM ; le plafond Rango est 3 %.
Une configuration incompatible désactive de fait Rango avec une erreur, sans
supprimer les cotations LI.FI ni modifier silencieusement les frais.

## Identité et exécution

Les identifiants des neuf réseaux proviennent de `/basic/meta/blockchains`,
vérifié le 20 septembre 2026. Aucun appel de métadonnées Rango n'est nécessaire à
l'ouverture du formulaire ni pour reconnaître les tokens locaux. Un ERC-20 est
identifié par réseau/adresse, pas par symbole. Le natif est `null` chez Rango,
sauf l'alias Metis `0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000`, traduit en adresse
nulle Hermes uniquement sur Metis.

`NormalizedRoute` est une union discriminée : chaque provider conserve son propre
payload. Une route Rango ne passe jamais dans le SDK d'exécution LI.FI.
Le préflight commun vérifie métadonnées, compte, montant, expiration, réseau,
solde natif et ERC-20. Les exemptions exactes du catalogue et les blocages LI.FI
restent inchangés. Le résultat Rango doit être `OK`, avec un vrai minimum positif ;
les réponses `HIGH_IMPACT` et les paiements source non natifs/destination-wallet
ne sont pas exécutables. LI.FI garde son seuil d'impact de 5 % ; Rango applique
son propre verdict d'impact.

Avant signature, `/swap` est demandé pour le même protocole. Le minimum ne peut
pas baisser, les frais ne peuvent pas augmenter, et les métadonnées/chaînes ne
peuvent pas changer. Seules les transactions EVM à calldata sont acceptées, avec
une valeur exactement égale au principal natif (ou zéro pour ERC-20).
Une approval doit viser le token source, autoriser le routeur de la transaction
et correspondre exactement au montant demandé. Les allowances non nulles mais
insuffisantes sont d'abord remises à zéro. La receipt d'approval est attendue.

La transaction est reconstruite après approval puis contrôlée à nouveau. Gas
et frais max sont estimés via RPC, avec vérification des soldes et une marge de
20 % sur cette estimation avant signature. Le wallet reste responsable de
l'estimation finale et de la confirmation. Une cotation expirée pendant une
approval impose une nouvelle cotation ; aucun swap n'est signé automatiquement.
Le même compte/réseau est revérifié après les attentes. La sécurité suppose aussi
la confiance dans les contrats et le calldata fournis par Rango : ce code n'est
pas un audit des protocoles sous-jacents.

## Suivi et reprise

Après envoi, le `requestId` de la préparation et le hash sont suivis par l'API
Rango toutes les 8 secondes, jusqu'à 75 vérifications par session. Une receipt
sur le réseau source n'est pas suffisante pour confirmer un bridge.
Le succès exige le token, le réseau, les décimales et le montant minimal attendus.
Les remboursements/tokens intermédiaires sont signalés, pas affichés comme succès.

Un timeout ou une réponse sans sortie vérifiable reste **en attente**. Le suivi
ne renvoie jamais une transaction. L'UI conserve le lien, désactive le nouveau
swap et propose « Reprendre le suivi ». Le dernier transfert en attente est
stocké dans le navigateur pour reprendre après rechargement, sans signature ni
secret ; un stockage désactivé limite cette reprise à l'onglet courant.
Cette version ne fournit pas un historique multi-transferts ni la récupération
automatique des remboursements.

## Vérifications

Après `npm run build`, `node scripts/smoke-rango.mjs` démarre temporairement le
serveur sur le port 3149, contrôle la page et les SVG locaux, rejette des entrées
invalides et demande une cotation publique réelle. Ce test ne contacte jamais
`/swap` et n'utilise aucun wallet ; un quota Rango épuisé peut le faire échouer.

Tests unitaires/DOM : formats, sérialisation, frais, min reçu, isolation des
providers, annulation, changements de compte/réseau, approvals bornées et reset,
expiration après approval, gas réel, reprise et résultat ambigu.
Un appel public réel de cotation ETH/Base → ETH/Ethereum a répondu `OK` ; aucun
wallet n'a signé et aucun fonds n'a bougé. Le parcours signé complet reste à
valider manuellement avec un wallet et un montant adapté avant mise en production.
Le build et les tests DOM ne remplacent pas une revue visuelle mobile/desktop
(Chromium non installé dans l'environnement de travail).

Références officielles : [cotations](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/get-quote),
[préparation](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/create-transaction-swap),
[transactions EVM](https://docs.rango.exchange/api-integration/basic-api-single-step/sample-transactions),
[suivi](https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/check-transaction-status),
[frais](https://docs.rango.exchange/api-integration/basic-api-single-step/monetization).

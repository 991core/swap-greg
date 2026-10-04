# Corrections exploitation — 4 octobre 2026

État historique : HEAD `86159fb636d1b779c85818a261b07e05512cd9f0`, branche
`feat/hermes-oneclick`, modifications préexistantes conservées. Les preuves de
`research/2026-10-04-finalisation` sont intactes. Aucune publication, installation
système, transaction, approval, dépôt ni fonds. Seule consultation réseau propre
à cette sous-mission : documentation officielle et manifeste public Docker Hub.

| Ticket / défaut confirmé courant | Modification | Preuve locale | Limite |
| --- | --- | --- | --- |
| D0-03 Rango request.text / response.json non bornés avant accumulation | Lecteurs UTF-8 par octets, corps 4096, réponses 2 MiB, 5 s ingress, délais upstream | Chunked, Content-Length, Unicode et stalled streams ; cancellation observable | Limites ingress du serveur/proxy réel encore à valider |
| D0-03 origines fondées sur headers transférés non fiables | Origine canonique HERMES_PUBLIC_ORIGIN ; XFF/proto ignorés ; IP via header dédié uniquement en mode proxy explicite | Faux XFF n'évite pas quota ; autre client et suivi restent servis | Accès direct impossible et écrasement proxy exigés pour isoler les clients |
| D0-03 quotas/concurrence et coût marché | Budgets par client/processus/opération, suivi séparé ; LI.FI upstream partagé recherche/market ; enrichment 3 essais et 180 s | Deux clients, slots concurrentiels, cache, 429/Retry-After, quota partagé, deadline enrichment | Une instance ; tests simulés, pas charge/plan fournisseur réel |
| D0-03 diagnostics historiques publics | 410 par défaut et toujours en production ; diagnostics locaux nécessitent opt-in explicite | Tests mode production et régressions historiques conservées avec opt-in test local | Les outils historiques ne deviennent pas autorité de signature |
| D0-01 préparations de dépôt malgré mode cotations | Gates dans handlers et transport Rango/1Click, dry=true pour preview ; endpoint no-store release pour switch incident | quotes/incident/invalide refusent avant fetch ; transport direct aussi ; status reste accessible | Frontières wallet/UI intégrées par coordinateur ; signature réelle non qualifiée |
| P1-02 informations de support perdues | Diagnostics Rango selon schéma documenté, URL https bornées sans clés, bridgeData explicite | Source/destination conservées, JS/URLs avec clés et champs privés retirés | Preuve fournisseur, pas receipt destination indépendante |
| P1-02 observabilité privée | Counters nommés fixes + JSON optionnel : statut, latence, counters, cache | Aucun IP, adresse, body, key ou identifiant financier dans log automatique | Collecte/rétention/alertes à adapter au système opérateur |
| D0-02 distribution absente | Standalone ; Docker trois étapes Node version+digest ; nonroot UID10001 ; Compose local loopback readonly/tmpfs ; runbooks | Typecheck et lint ; parsing YAML ; source manifest | Docker absent : image, OS scan, démarrage conteneur, Compose config et rollback non vérifiés |

La recherche serveur LI.FI utilise désormais les mêmes URLs fixes/paramètres
que les actions installées SDK 4.7, avec un lecteur de réponses borné ; aucun
fallback de token/price, restriction de découverte ou modification des pins.
Les tests de contrat emploient **le SDK installé réel** et un fetch simulé,
comparent les URLs SDK/transport et couvrent liste/exact-address ainsi que
minPriceUSD=0. Le classement reste CoinGecko/CoinMarketCap exact chain/address.

Résultats : **217 tests / 13 fichiers**, tous réussis, suite dédiée conservée
dans `api-tests.log` ; typecheck exit 0.
Lint exit 0, avertissement sur un useEffect SwapCard en cours d'intégration par
le coordinateur, pas dans les modules API. Parsing `compose.portainer.yml` avec
js-yaml existant réussi : un service, read_only=true, loopback 3187, healthcheck
Node. Ce parsing ne remplace pas `docker compose config`.

Base image : `node:22.23.3-bookworm-slim` index officiel
`sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c`,
lu sur registry-1.docker.io le 4 octobre 2026, plateformes amd64/armv7/arm64/ppc64le.
Le digest de l'image Hermes n'existe pas encore ; ne pas confondre ce digest
Node avec celui d'une image applicative construite/qualifiée.

Fichiers exploitation prêts : Dockerfile, .dockerignore, next.config.js,
app/api/health et release, deploy/compose.portainer.yml, env.example,
proxy.example.conf, DEPLOYMENT.md, OPERATIONS.md, source-manifest.mjs.
Le profil public initial reste cotations seules/frais zéro et arrêt runtime
activé. Aucun service ni proxy existant n'a été modifié.

Reste à vérifier hors environnement actuel : Docker build clean, OS SBOM/scan,
permissions readonly/cache, SIGTERM, restart, rollback, réseau/proxy/HTTPS réels,
quotas/conditions provider production, recette financière distinctement autorisée.
La vérification applicative globale et la revue indépendante sont conduites
par le coordinateur ; ce rapport n'annonce aucun parcours réel qualifié.

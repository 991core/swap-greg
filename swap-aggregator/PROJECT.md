# Hermes (HMS Protocol) — contexte projet

## Objectif
Agrégateur web de swap/bridge cross-chain, concurrent de Jumper Exchange. Prend des frais
(contrairement à Jumper qui est gratuit), en échange d'une transparence totale sur les frais
et d'un affichage honnête des routes disponibles plutôt qu'une recommandation algorithmique
opaque.

**Marque** : Hermes (produit) / HMS Protocol (raison sociale).

## Positionnement et principes produit
- **Frais fixes et transparents** : un pourcentage identique appliqué à toutes les routes,
  quel que soit le bridge/DEX utilisé. Objectif : éliminer tout biais économique dans le
  classement des routes (pas de commission variable qui favoriserait un partenaire).
- **Pas de "meilleure route" imposée par un algo.** Toutes les routes disponibles sont
  affichées côte à côte avec leurs métriques brutes (montant net reçu, temps estimé, score
  de fiabilité). L'utilisateur choisit lui-même. Tri par défaut neutre : montant net
  décroissant, sans étiquette "recommandé".
- **Montant net reçu** est la métrique de référence affichée, frais déjà déduits — jamais un
  taux de frais isolé qui nécessiterait un calcul mental à l'utilisateur.
- **Univers de tokens** : recherche LI.FI par nom, symbole ou adresse sur les réseaux
  EVM configurés ; populaires à l'ouverture, catalogue élargi à la demande. Un résultat
  ne garantit ni sa sécurité ni une route pour chaque paire/montant.

## Architecture backend (cible, pas le MVP)
```
Frontend → Orchestrateur (appels parallèles) → [LI.FI, Socket, Rango] en parallèle
  → Normalisation + déduplication des routes (clé : bridge + dex_source + dex_destination)
  → Enrichissement avec score de fiabilité (par bridge sous-jacent, pas par agrégateur)
  → Réponse triée renvoyée au frontend
```
- Appels aux agrégateurs en parallèle avec timeout court ; si un agrégateur ne répond pas,
  afficher quand même les autres plutôt que bloquer.
- Dédup : en cas de route identique proposée par plusieurs agrégateurs, garder celle au
  meilleur montant net.
- Streaming des routes (affichage progressif) envisagé en amélioration post-MVP, pas au
  lancement.

## Sources d'agrégation retenues
- **LI.FI** — socle principal, meilleure couverture EVM, SDK officiel `@lifi/sdk`.
- **Socket** — bon pour logique de routing personnalisée par-dessus leur API.
- **Rango** — à ajouter pour couvrir Bitcoin/Solana/Cosmos/TON au-delà de l'EVM.
- Ordre d'intégration : LI.FI seul d'abord (MVP), puis Socket, puis Rango.

## Score de fiabilité (par bridge sous-jacent)
Table `bridge_reliability` (Postgres) avec : TVL, volume 30j, date de lancement, historique
d'incidents, modèle de sécurité (lock-mint / natif / CCTP / optimistic), nombre d'audits.

Score composite sur 100 :
- Ancienneté sans incident majeur : 0–25 pts
- Volume/TVL (échelle logarithmique) : 0–25 pts
- Historique d'incidents (le plus lourd, part de 35 et déduit selon sévérité/récence) : 0–35 pts
- Modèle de sécurité (natif/CCTP favorisé vs lock-and-mint) : 0–15 pts

Méthodologie à documenter publiquement pour éviter les accusations de favoritisme.

Sources de données d'incidents identifiées : DefiLlama Hacks Database (référence principale,
scraper Apify disponible), PeckShield et ChainSec en croisement pour les gros incidents,
Rekt.news pour le contexte qualitatif. Ingestion automatisée (cron + Apify) prévue en
amélioration post-MVP ; au lancement, liste d'incidents majeurs saisie manuellement suffit.

## Stack technique
- **Frontend** : Next.js (App Router) + TypeScript
- **Wallet** : wagmi + viem + RainbowKit
- **Agrégation** : `@lifi/sdk` (officiel), puis API Socket et Rango ensuite
- **Backend** : API Next.js pour la recherche/métadonnées/prix des tokens avec cache,
  validation et clé privée. Les cotations et l'exécution LI.FI restent côté navigateur.
  L'orchestration multi-agrégateurs et le scoring serveur restent à développer.
- **DB fiabilité** : Postgres

## Roadmap
1. **MVP (fait)** : LI.FI seul, UI type Jumper (réseau + token), recherche élargie
   LI.FI via l'option B, multi-routes avec choix utilisateur, frais via `fee` SDK.
   Mainnet EVM.
2. **Semaine 3-4** : ajout Socket + Rango, orchestrateur parallèle, normalisation/dédup.
3. **Mois 2** : score de fiabilité (version simplifiée TVL + ancienneté d'abord).
4. **Post-MVP / différé** : ingestion automatisée des incidents (Apify/cron), streaming des
   routes, revue légale/réglementaire approfondie.

## État actuel du code
MVP Hermes : Next.js + wallet EVM injecté, LI.FI (`lib/aggregators/lifi/routes.ts`)
et orchestrateur de cotations sécurisé (`lib/routing/`),
API de recherche de tokens LI.FI avec cache serveur et validation,
`SwapCard` / `TokenSelectModal` / `RouteList`, design branding Hermes / HMS Protocol.
i18n 100 % fonctionnel (EN/FR, détection automatique, sélecteur, persistance).
Affichage du taux toujours actif même avec solde insuffisant (avertissement indicatif).
Paire par défaut : ETH sur Base vers ETH sur Ethereum, si ces deux réseaux sont
retournés par LI.FI.

## Mise à jour — stabilisation du parcours LI.FI

La priorité a été donnée à un seul parcours exécutable de bout en bout : LI.FI sur
les chaînes EVM configurées. Le client LI.FI utilise désormais le fournisseur EVM
officiel et récupère le `WalletClient` depuis wagmi au moment de l’exécution. Le
changement de réseau est réalisé par wagmi puis contrôlé de nouveau avant la demande
de signature.

Les cotations possèdent une clé de requête et une durée de vie. Une réponse tardive
ne peut plus réactiver une ancienne route après la modification du formulaire. Le
montant utilisateur est parsé sans `Number`, ce qui évite les pertes de précision et
les erreurs de virgule française. Une route est refusée si elle ne correspond plus
au wallet, au montant, aux tokens ou au réseau source.

Avant l’exécution, le code vérifie :

- le compte connecté et son adresse ;
- le réseau source ;
- le solde du token source ;
- le gas natif disponible, y compris pour un swap de token ERC-20 ;
- l’expiration et le montant minimum reçu de la route.

## Mise à jour — option B : recherche LI.FI élargie

La restriction top 20 et les anciens fallbacks de recherche ont été retirés.
La modale recherche par nom, symbole ou adresse sur le réseau sélectionné, après
300 ms de pause. Les résultats progressent de 25 à 50, 100 puis 200 ; une recherche
exacte par adresse reste accessible indépendamment de ce plafond. Deux contrats
portant le même symbole sont conservés séparément. Les petits prix unitaires ne
sont plus exclus par le filtre par défaut de LI.FI.

`app/api/tokens/search/route.ts` et `lib/tokens/` fournissent validation, cache
d'une minute (256 entrées), regroupement des demandes et quotas par instance.
La clé facultative passe de `NEXT_PUBLIC_LIFI_API_KEY` à `LIFI_API_KEY` et reste
sur le serveur ; elle concerne le service tokens, pas les cotations du navigateur.
Aucune base de données ou intégration GoPlus n'est nécessaire pour cette version.

Un token signalé par LI.FI est bloqué. Un token non vérifié demande un contrôle
explicite de l'adresse et du réseau, avec confirmation du risque. Avant le swap,
les deux tokens sont relus sans le cache local et leurs décimales/identités sont
comparées à la sélection et à la cotation. Une vérification indisponible bloque
l'exécution. Les verdicts LI.FI peuvent être incomplets ou mis en cache en amont.

Les tests ajoutés couvrent le service API, les homonymes, le cache, les quotas,
l'annulation de recherche, le consentement et les changements de métadonnées ou
de statut avant exécution. README, architecture et guide de reprise reflètent ce
nouveau périmètre.

## Affichage et intégrations

Le prix EUR indicatif est récupéré dynamiquement avec sa date de référence. Les prix
des tokens sont demandés à LI.FI sur la paire chaîne/adresse, sans déduire le prix
d’un symbole ou d’une chaîne différente.

Rango et Socket sont explicitement désactivés dans l’UI jusqu’à l’implémentation de
leur cycle complet. L’ancien code qui retournait une route Rango fictive ou tentait
d’exécuter toutes les routes via LI.FI a été retiré.

## Fichiers ajoutés ou réorganisés

- `lib/amounts.ts` : parsing et formatage sûrs des montants entiers.
- `lib/wallet.ts` : configuration wagmi partagée avec le client LI.FI.
- `lib/routing/config.ts` : frais, slippage, impact maximal et durée de cotation.
- `lib/routing/quote.ts` : clé et validation d’une cotation.
- `lib/routing/execute.ts` : pré-vérifications et exécution LI.FI.
- `lib/routing/useSwapQuotes.ts` : debounce, annulation, expiration et refresh.
- `tests/` : tests du montant, des cotations, de l’exécution et de la modale.

La feuille de style a été réalignée avec les classes réellement utilisées par les
composants, et la modale porte désormais le focus, le verrouillage de scroll et la
sélection effective de la chaîne.

## Points de vigilance non résolus
- Cadre légal/réglementaire selon juridictions d'opération (MiCA UE, licences money
  transmitter US) — à valider avec un avocat spécialisé, pas encore tranché.
- Seuil et logique d'exclusion d'un bridge des routes proposées après incident majeur — pas
  encore défini.
- Choix définitif entre affichage synchrone vs streaming des routes — pas encore tranché.
- Couverture LI.FI inégale selon la chaîne (ex. ADA souvent absent ; XRP/DOGE surtout BSC).
- Swaps mainnet = fonds réels — prudence en usage.

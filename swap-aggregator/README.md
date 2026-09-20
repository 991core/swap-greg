# Hermes (HMS Protocol) — MVP

Agrégateur de swap/bridge cross-chain : sélection réseau + token, comparaison
des routes LI.FI et choix utilisateur, avec frais transparents.

La recherche couvre les tokens reconnus par LI.FI sur les réseaux EVM configurés,
par **nom, symbole ou adresse de contrat**. La présence d'un token dans les
résultats ne garantit ni sa sécurité, ni une route pour la paire et le montant
demandés.

## Installation

Node.js 22.12 ou supérieur est requis.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Ouvre [Hermes en local](http://localhost:3000). Le wallet utilise le connecteur
injecté du navigateur (MetaMask, Rabby, etc.), via wagmi/RainbowKit ; aucun projet
WalletConnect n'est requis. La paire initiale est ETH/Base → ETH/Ethereum.
Le formulaire et les réseaux configurés sont disponibles sans attendre LI.FI.

## Configuration

| Variable | Usage |
| --- | --- |
| `LIFI_API_KEY` | Facultative, utilisée uniquement sur le serveur pour la recherche, les métadonnées et les prix des tokens. |
| `TOKEN_SEARCH_REQUESTS_PER_MINUTE` | Budget d'appels LI.FI de ce service, par instance serveur ; défaut 60, valeur entière de 1 à 1000. |
| `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` | Frais Hermes en pourcentage, de 0 à 100 ; défaut 0. |

**Migration :** remplacer `NEXT_PUBLIC_LIFI_API_KEY` par
`LIFI_API_KEY` dans l'environnement du serveur. L'ancienne variable
n'est plus utilisée. Les cotations et l'exécution restent dans le SDK navigateur,
sans cette clé privée ; celle-ci augmente uniquement les quotas du service tokens.
Le slippage reste à 0,5 % et l'impact maximal à 5 %.

## Recherche de tokens — option B

- Choisir le réseau dans la modale : Ethereum, Base, Arbitrum, Optimism, Polygon,
  BNB Chain, Avalanche, Gnosis ou Metis.
- À l'ouverture, afficher immédiatement les principaux tokens du catalogue local
  `lib/tokens/catalog.ts`, sans appel API. Il comprend les actifs natifs et une
  sélection d'ERC-20 dont les adresses et décimales sont épinglées par réseau.
  La liste et ses sources sont décrites dans [TOKEN_CATALOG.md](./TOKEN_CATALOG.md).
- Les résultats locaux apparaissent immédiatement pendant la saisie. Une adresse
  exacte du catalogue est résolue localement, sans requête d'authenticité.
- « Parcourir plus de tokens sur LI.FI » charge le catalogue distant à la demande.
- Rechercher un nom ou symbole après 300 ms de pause, ou coller une adresse EVM
  complète. Les anciennes requêtes sont annulées et leurs réponses ignorées.
- Afficher 25 résultats, puis 50, 100 et 200 avec « Afficher plus ». Au-delà,
  préciser la recherche ou utiliser l'adresse exacte, indépendante de cette limite.
- Identifier les tokens par réseau + adresse. Deux contrats ayant le même symbole
  restent distincts. Aucun filtre « top 20 » ou prix unitaire minimum n'est appliqué.

La route Next.js `GET /api/tokens/search` relaie les demandes vers
LI.FI. Elle valide les entrées et les métadonnées, regroupe les appels identiques,
limite les appels simultanés à 8 et garde au plus 256 entrées de cache pendant
60 secondes (10 secondes pour un résultat vide). Ces limites sont **par processus** ;
un déploiement sur plusieurs instances devra partager les quotas/cache s'il veut
une limite globale. Aucune base de données ni service de scan externe n'est requis.

## Contrôles des tokens

- **Signalé par LI.FI :** sélection désactivée et exécution bloquée, même si un
  autre verdict du même token est positif.
- **Non vérifié ou statut absent :** adresse complète, réseau, lien vers
  l'explorateur et confirmation explicite avant sélection, sauf entrée exacte du
  catalogue local. Cette exemption ne dépend jamais du seul nom ou symbole.
- **Catalogue Hermes :** métadonnées locales, sans vérification d'authenticité API
  à la sélection ni avant exécution. Ce libellé ne prétend pas être un verdict LI.FI.
- **Statut vérifié :** indication provenant de LI.FI, sans promesse de sécurité.
- Vérification du réseau, de l'adresse et des décimales ; aucune résolution RPC
  seule n'est acceptée comme preuve de reconnaissance par LI.FI.
- Avant de démarrer l'exécution, comparer les métadonnées épinglées des tokens
  locaux avec la sélection et la cotation. Pour les autres tokens seulement,
  relire LI.FI en contournant le cache : une indisponibilité, un signalement, un
  changement d'identité/décimales ou l'absence de consentement bloque le swap.
- Un signalement déjà présent dans la sélection ou la cotation bloque aussi un
  token local. Le catalogue doit être maintenu dans le code ; aucun résultat de
  recherche ne peut y ajouter automatiquement un contrat.

Les appels de prix, de cotation et les contrôles de soldes continuent normalement.
Une panne de métadonnées ne bloque pas les tokens locaux, mais une cotation valide
reste indispensable : la liste locale ne garantit aucune liquidité ni route.

LI.FI peut lui-même renvoyer des verdicts mis en cache ou incomplets. L'option B
n'intègre pas GoPlus et ne détecte pas tous les risques d'un contrat.
Voir la [documentation de recherche LI.FI](https://docs.li.fi/sdk/token-management)
et les [limites du screening LI.FI](https://docs.li.fi/introduction/learn-more/hypernative-token-screening).

## Parcours de swap

1. Connecter le wallet et choisir les tokens.
2. Saisir un montant : conversion décimale en entier avec `BigInt`,
   virgule française acceptée sans perte de précision.
3. Comparer et choisir une route LI.FI. Les cotations sont annulées si les
   paramètres changent et se renouvellent automatiquement après une minute.
   Un anneau animé affiche les secondes restantes, puis l'actualisation en cours.
4. Contrôler les tokens, le compte, le réseau source, le solde ERC-20/natif et la
   réserve de gas avant exécution.
5. Confirmer les transactions dans le wallet. Les modifications automatiques du
   taux sont refusées ; la progression et les liens de transactions sont affichés.

Les frais Hermes, le gas estimé et le minimum reçu restent visibles.
Pendant le renouvellement, l'ancienne cotation n'est plus exécutable. Une erreur
ou une absence de route entraîne une nouvelle tentative après 15 secondes.
Les demandes attendent si l'onglet est masqué ou hors ligne et reprennent au retour.
L'actualisation est suspendue pendant l'exécution ; elle ne signe ni ne lance de swap.
Le bouton d'actualisation manuelle reste disponible et l'animation respecte
la préférence système de réduction des mouvements.
Le taux EUR indicatif vient de la BCE via Frankfurter avec sa date ; l'interface
revient au USD si la référence manque. L'interface est disponible en français et
en anglais.

## Structure

| Emplacement | Responsabilité |
| --- | --- |
| `app/api/tokens/search/route.ts` | API de recherche et erreurs HTTP publiques. |
| `lib/tokens/` | Catalogue local, validation, client HTTP, cache serveur et quota. |
| `components/TokenSelectModal.tsx` | Recherche, résultats, consentement et accessibilité. |
| `components/SwapCard.tsx` | Formulaire, soldes, sélection et progression. |
| `components/QuoteCountdown.tsx` | Compte à rebours, animation et état de renouvellement. |
| `lib/aggregators/lifi/` | Cotations et exécution SDK avec fournisseur EVM. |
| `lib/routing/` | Expiration, annulation, normalisation et pré-vérifications. |
| `lib/chains.ts` | Réseaux EVM configurés. |

## Vérifications

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Les tests couvrent notamment les montants, les cotations périmées, le compte et les
soldes, les homonymes, la validation des métadonnées, le cache, les quotas, les
réponses tardives et les confirmations d'import. Les tests automatisés utilisent
des réponses contrôlées et ne réalisent pas de transaction mainnet.

`next.config.js` optimise les imports de `viem/chains` pour éviter d'embarquer
les chaînes inutilisées. Cela corrige l'avertissement Webpack
`ox/_esm/tempo/internal/virtualMasterPool.js — Critical dependency` lors de la
compilation de `/api/tokens/search`, sans masquer les avertissements.

## Hors périmètre

Rango et Socket restent désactivés. Les wallets non-EVM, le scan GoPlus, le score
de fiabilité des bridges et l'orchestration serveur des cotations restent à traiter.

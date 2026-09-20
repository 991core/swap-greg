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
WalletConnect n'est requis. La paire initiale est ETH/Base → ETH/Ethereum lorsque
ces réseaux sont disponibles.

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
  BNB Chain, Avalanche, Gnosis ou Metis, selon la disponibilité LI.FI.
- À l'ouverture, charger les tokens populaires de ce réseau. Les actifs natifs
  configurés restent immédiatement disponibles ; le catalogue complet n'est pas
  téléchargé au démarrage.
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
  l'explorateur et confirmation explicite avant sélection. L'actif natif connu
  dans la configuration du réseau est dispensé de cette confirmation d'import.
- **Statut vérifié :** indication provenant de LI.FI, sans promesse de sécurité.
- Vérification du réseau, de l'adresse et des décimales ; aucune résolution RPC
  seule n'est acceptée comme preuve de reconnaissance par LI.FI.
- Avant de démarrer l'exécution, relire les deux tokens auprès de LI.FI en
  contournant le cache local. Une indisponibilité, un signalement, un changement
  d'identité/décimales ou l'absence de confirmation requise bloque le swap.

LI.FI peut lui-même renvoyer des verdicts mis en cache ou incomplets. L'option B
n'intègre pas GoPlus et ne détecte pas tous les risques d'un contrat.
Voir la [documentation de recherche LI.FI](https://docs.li.fi/sdk/token-management)
et les [limites du screening LI.FI](https://docs.li.fi/introduction/learn-more/hypernative-token-screening).

## Parcours de swap

1. Connecter le wallet et choisir les tokens.
2. Saisir un montant : conversion décimale en entier avec `BigInt`,
   virgule française acceptée sans perte de précision.
3. Comparer et choisir une route LI.FI. Les cotations sont annulées si les
   paramètres changent et expirent après une minute.
4. Contrôler les tokens, le compte, le réseau source, le solde ERC-20/natif et la
   réserve de gas avant exécution.
5. Confirmer les transactions dans le wallet. Les modifications automatiques du
   taux sont refusées ; la progression et les liens de transactions sont affichés.

Les frais Hermes, le gas estimé et le minimum reçu restent visibles.
Le taux EUR indicatif vient de la BCE via Frankfurter avec sa date ; l'interface
revient au USD si la référence manque. L'interface est disponible en français et
en anglais.

## Structure

| Emplacement | Responsabilité |
| --- | --- |
| `app/api/tokens/search/route.ts` | API de recherche et erreurs HTTP publiques. |
| `lib/tokens/` | Validation, client HTTP, cache serveur et quota. |
| `components/TokenSelectModal.tsx` | Recherche, résultats, consentement et accessibilité. |
| `components/SwapCard.tsx` | Formulaire, soldes, sélection et progression. |
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

## Hors périmètre

Rango et Socket restent désactivés. Les wallets non-EVM, le scan GoPlus, le score
de fiabilité des bridges et l'orchestration serveur des cotations restent à traiter.

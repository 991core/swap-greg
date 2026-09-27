# Hermes (HMS Protocol) — MVP

Agrégateur de swap/bridge cross-chain inspiré du principe Jumper : sélection chaîne + token,
affichage des routes LI.FI et 1Click (tri par montant reçu estimé), choix utilisateur.
Tokens généralement limités au **top 20 market cap** (liste statique), exposés par LI.FI
ou 1Click sur chaque chaîne, avec EURe Gnosis comme destination ajoutée.

> Les testnets LI.FI ne listent pratiquement que ETH/USDC — le MVP tourne donc en **mainnet**
> pour pouvoir proposer le top 20.

## Installation

```bash
npm ci
cp .env.example .env.local
```

Remplis `.env.local` :
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` : https://cloud.walletconnect.com
- `NEXT_PUBLIC_LIFI_API_KEY` : optionnel (tier gratuit sans clé)
- `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` : frais plateforme LI.FI (défaut `0` ; aucun frais Hermes ajouté à 1Click)
- `NEAR_1CLICK_API_KEY` : clé partenaire 1Click facultative, utilisée uniquement par les routes serveur (ne jamais l'exposer avec `NEXT_PUBLIC_`)

## Lancer en dev

```bash
npm run dev
```

Ouvre http://localhost:3000 — connecte un wallet, choisis une paire du top 20 disponible
sur la chaîne, saisis un montant, sélectionne une route, lance le swap.

## Exécution 1Click

Active **1Click**, sélectionne un ERC20 EVM reconnu par le registre 1Click et une destination
reconnue, par exemple USDC Polygon → USDC ou EURe Gnosis. Le sélecteur indique l'adresse du
contrat pour distinguer les variantes d'un même symbole. EURe sur Gnosis est ajouté comme
destination demandée, en complément de la sélection de tokens habituelle.

Les devis affichés sont simulés. Au clic, Hermes redemande un devis exécutable et affiche son
minimum reçu avant la signature. Le portefeuille signe ensuite un transfert ERC20 du **montant
exact** vers l'adresse de dépôt 1Click sur la chaîne source ; le gaz du réseau source est en
supplément. Le statut du dépôt reste visible et reprend après rechargement de la page dans le
même navigateur avec le même portefeuille. `SUCCESS`, `REFUNDED` et `FAILED` sont les états
finaux remontés par 1Click. Aucun swap n'est déclenché par un simple devis.

La route 1Click → CoW en deux étapes et les dépôts de tokens natifs ne sont pas inclus dans
cette intégration. Le classement compare le montant reçu annoncé ; le coût du gaz source
n'est pas soustrait du montant affiché.

## Univers tokens

Allowlist dans `lib/topTokens.ts` (BTC, ETH, USDT, BNB, XRP, SOL, USDC, …).  
Intersection avec LI.FI et le registre 1Click par chaîne (Ethereum, Base, Arbitrum, Optimism,
Polygon, Gnosis, BNB, Avalanche).
Ex. ADA n’apparaît pas s’il n’y a pas d’équivalent listé ; BTC apparaît via WBTC sur EVM.

## Structure

```
app/
  layout.tsx          # metadata Hermes + Providers
  page.tsx            # brand + Connect + SwapCard
  providers.tsx       # wagmi mainnet chains + RainbowKit
  globals.css         # design system
components/
  SwapCard.tsx        # widget From/To + invert + exécution
  TokenSelectModal.tsx
  RouteList.tsx       # multi-routes, radio, montant net
lib/
  lifi.ts             # getRoutes / getTokens / format
  topTokens.ts        # allowlist top 20
  chains.ts           # chaînes EVM supportées
```

## Nouveautés récentes

- **i18n 100 %** : l'interface complète est traduite EN/FR. La langue est détectée automatiquement (`navigator.language`), le choix est persigné dans `localStorage`, et le fallback strict est `en`. Le sélecteur de langue est dans le header.
- **Affichage du taux avec solde insuffisant** : la validation de solde est découplée du calcul/affichage du taux. Le taux est toujours affiché même si le wallet n'a pas assez de fonds ; un avertissement discret signale que l'exécution est impossible.
- **Paires par défaut** : au montage, la sélection initiale pointe vers ETH/ETH (mainnet) et ETH/Optimism.

## Hors scope MVP

Socket/Rango, score de fiabilité, ranking market cap live, Solana wallet natif.

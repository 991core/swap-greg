# Hermes (HMS Protocol) — MVP

Agrégateur de swap/bridge cross-chain inspiré du principe Jumper : sélection chaîne + token,
affichage de **toutes** les routes LI.FI (tri par montant net), choix utilisateur.
Tokens limités au **top 20 market cap** (liste statique), filtrés à ce que LI.FI expose
sur chaque chaîne.

> Les testnets LI.FI ne listent pratiquement que ETH/USDC — le MVP tourne donc en **mainnet**
> pour pouvoir proposer le top 20.

## Installation

```bash
npm install
cp .env.example .env.local
```

Remplis `.env.local` :
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` : https://cloud.walletconnect.com
- `NEXT_PUBLIC_LIFI_API_KEY` : optionnel (tier gratuit sans clé)
- `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` : frais plateforme (défaut `0.29`)

## Lancer en dev

```bash
npm run dev
```

Ouvre http://localhost:3000 — connecte un wallet, choisis une paire du top 20 disponible
sur la chaîne, saisis un montant, sélectionne une route, lance le swap.

## Univers tokens

Allowlist dans `lib/topTokens.ts` (BTC, ETH, USDT, BNB, XRP, SOL, USDC, …).  
Intersection avec LI.FI par chaîne (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche).
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

# Hermes (HMS Protocol) — MVP

Agrégateur de swap/bridge cross-chain inspiré du principe Jumper : sélection chaîne + token,
affichage de **toutes** les routes LI.FI (tri par montant net), choix utilisateur.
Tokens limités au **top 20 market cap** (liste statique), filtrés à ce que LI.FI expose
sur chaque chaîne.

## État du parcours LI.FI

Le parcours LI.FI EVM est maintenant le seul fournisseur activable dans l’interface
et il suit ce flux :

1. Le wallet est connecté avec wagmi/RainbowKit.
2. Les chaînes EVM supportées et les tokens sont chargés depuis LI.FI.
3. Le montant est converti en entier avec `BigInt`, en acceptant `1.25` et `1,25`
   sans interpréter les séparateurs de milliers.
4. Les cotations sont annulées lorsqu’un paramètre change, expirent après une minute
   et sont refusées si le wallet, le réseau, le token ou le montant ne correspondent
   plus.
5. Le fournisseur EVM officiel de `@lifi/sdk-provider-ethereum` exécute les étapes
   et demande une confirmation explicite pour chaque transaction.

Rango et Socket apparaissent comme intégrations à venir. Ils ne sont pas interrogés
et ne peuvent pas être sélectionnés tant que leur cycle quote → transaction → suivi
n’est pas implémenté.

> Les testnets LI.FI ne listent pratiquement que ETH/USDC — le MVP tourne donc en **mainnet**
> pour pouvoir proposer le top 20.

## Installation

```bash
npm install
cp .env.example .env.local
```

Remplis `.env.local` si nécessaire :
- `NEXT_PUBLIC_LIFI_API_KEY` : optionnel (tier gratuit sans clé)
- `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` : frais plateforme (défaut `0`)

La connexion utilise le connecteur de wallet injecté par le navigateur (MetaMask,
Rabby, etc.) via wagmi/RainbowKit ; aucun projet WalletConnect n'est requis dans
ce MVP.

Le montant doit être compris entre `0` et `100`. Le slippage LI.FI est fixé à `0,5 %`
et le prix impact maximal accepté à `5 %`.

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
- **Paire par défaut** : au montage, la sélection initiale pointe vers ETH/Base vers ETH/Ethereum lorsque ces deux réseaux et tokens sont disponibles.

## Hors scope MVP

Socket/Rango, score de fiabilité, ranking market cap live, Solana wallet natif.

## Sécurité et validation

- La route sélectionnée est liée à l’adresse du wallet, à la chaîne source, aux
  adresses des tokens et au montant exact de la demande.
- Les devis expirés, les changements de compte et les changements de réseau sont
  bloqués avant toute transaction.
- Le solde du token source et le solde natif réservé au gas sont vérifiés avant
  l’exécution.
- Le taux EUR est chargé depuis une source de référence avec sa date ; aucune valeur
  fixe n’est utilisée comme taux de change.
- Une adresse de contrat personnalisée est lue sur le réseau sélectionné et ses
  décimales sont vérifiées avant d’être proposée.

## Vérifications locales

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

Les tests couvrent la conversion décimale, l’expiration et l’invalidation des devis,
le changement de compte pendant un changement de réseau, les soldes ERC-20, les
adresses de contrats et le changement de chaîne dans la modale.

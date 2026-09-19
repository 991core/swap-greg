# Architecture Hermes

Hermes est un MVP de swap/bridge cross-chain sur chaînes EVM. Le parcours
exécutable utilise LI.FI ; les adaptateurs Rango et Socket restent désactivés
jusqu'à ce qu'ils disposent d'un cycle complet cotation → transaction → suivi.

## Stack et périmètre

- Next.js 14 App Router, React 18 et TypeScript strict.
- wagmi/viem pour les wallets et les appels RPC, RainbowKit pour l'interface de
  connexion, React Query pour le cache UI.
- `@lifi/sdk` 4.7 et `@lifi/sdk-provider-ethereum` pour la cotation et
  l'exécution EVM.
- Mainnet EVM : Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain,
  Avalanche, Gnosis et Metis selon la disponibilité LI.FI.
- Wallet navigateur injecté (MetaMask, Rabby, etc.). Aucun project ID
  WalletConnect n'est nécessaire dans cette version.

## Flux d'une cotation

```text
Wallet + sélection utilisateur
        ↓
lib/aggregators/lifi/routes.ts  →  LI.FI getRoutes/getTokens
        ↓
lib/routing/normalize.ts        →  vérification du destinataire et des montants
        ↓
deduplicate.ts + sort.ts        →  routes distinctes, montant net décroissant
        ↓
useSwapQuotes.ts                →  debounce, annulation, TTL d'une minute
        ↓
RouteList.tsx                   →  choix explicite de l'utilisateur
```

Chaque cotation garde une `quoteKey` calculée sur le wallet, les chaînes, les
tokens et le montant. Une réponse tardive ou une route expirée est retirée de
l'interface et ne peut pas être exécutée.

## Flux d'exécution

`lib/routing/execute.ts` effectue les contrôles suivants avant tout appel LI.FI :

1. compte connecté et adresse identique à celle de la cotation ;
2. réseau source actif, avec changement via wagmi si nécessaire ;
3. montant et paramètres toujours identiques à la cotation ;
4. solde ERC-20 ou natif suffisant ;
5. réserve de gas natif suffisante, y compris pour un token ERC-20 ;
6. montant minimum reçu et validité temporelle de la route.

Le client LI.FI crée `EthereumProvider` avec un `WalletClient` récupéré au
moment de l'action. Il refuse l'exécution si aucun wallet EVM actif n'est
disponible. Les changements de taux proposés par le SDK sont également refusés
pour éviter de signer une transaction différente de celle affichée.

## Modules principaux

| Module | Responsabilité |
| --- | --- |
| `app/providers.tsx` | Wagmi, React Query et RainbowKit autour de l'application. |
| `lib/wallet.ts` | Configuration wagmi partagée et transports RPC. |
| `lib/chains.ts` | Allowlist des chaînes EVM et leurs libellés. |
| `lib/aggregators/lifi/client.ts` | Client LI.FI et wallet client live. |
| `lib/aggregators/lifi/routes.ts` | Chaînes, tokens, routes et balances LI.FI. |
| `lib/routing/orchestrator.ts` | Sélection du fournisseur actif (LI.FI uniquement), normalisation et tri. |
| `lib/routing/useSwapQuotes.ts` | Cycle de vie des cotations côté client. |
| `lib/routing/execute.ts` | Pré-vérifications de sécurité et appel d'exécution. |
| `lib/amounts.ts` | Parsing décimal strict et formatage `BigInt`. |
| `lib/contractTokenResolver.ts` | Métadonnées vérifiées par chaîne pour une adresse EVM. |
| `lib/pricing.ts` | Prix USD par chaîne/adresse et taux USD/EUR daté. |
| `components/SwapCard.tsx` | Formulaire, soldes, sélection de route et progression. |
| `components/TokenSelectModal.tsx` | Recherche, changement de chaîne, focus trap et tokens personnalisés. |
| `components/RouteList.tsx` | Montant minimum, gas, frais et outil LI.FI par route. |

## Montants et frais

`parseTokenAmount` accepte une seule virgule ou un seul point décimal et rejette
les signes, exposants, séparateurs de milliers, `Infinity` et les valeurs qui
dépassent les décimales du token. Les valeurs sont transmises à LI.FI en chaînes
entières, sans passage par `Number`.

Les paramètres partagés sont dans `lib/routing/config.ts` : frais plateforme
configurables, slippage `0,5 %`, impact maximal `5 %`, durée de cotation
`60 s` et timeout de requête `15 s`. Le montant net et le montant minimum reçu
sont affichés séparément.

## Tokens et prix

La liste de tokens est filtrée sur les chaînes réellement exposées par LI.FI.
Le token natif est construit avec l'adresse zéro de la chaîne courante ; aucun
prix Ethereum n'est réutilisé sur une autre chaîne. Une adresse personnalisée
doit être une adresse EVM valide et ses décimales/symbole sont lus sur le réseau
sélectionné avant affichage.

Le prix USD vient de LI.FI pour le couple `(chainId, tokenAddress)`. Le taux EUR
vient d'une source ECB via Frankfurter et est rejeté s'il est absent ou trop
ancien ; l'interface retombe alors sur l'affichage USD.

## Configuration

| Variable | Usage |
| --- | --- |
| `NEXT_PUBLIC_LIFI_API_KEY` | Clé LI.FI optionnelle pour les quotas. |
| `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` | Frais Hermes, bornés entre 0 et 100. |

Les valeurs locales vont dans `.env.local`. Le fichier `.env.example` ne contient
aucun secret.

## Vérifications

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Les tests couvrent le parsing et la précision des montants, l'invalidation des
cotations, l'expiration, les destinataires incohérents, les soldes ERC-20/gas,
les métadonnées de contrats, le taux EUR et le changement de chaîne de la modale.

## Limites connues

- Rango, Socket, Solana et les wallets non-EVM sont hors périmètre de ce MVP.
- La disponibilité des tokens et des routes dépend de LI.FI et des RPC publics.
- Les transactions mainnet utilisent des fonds réels ; l'application ne promet
  pas de rendement ni de protection contre la volatilité.
- Le scoring de fiabilité, l'orchestration backend et le streaming des routes
  sont réservés à une itération ultérieure.

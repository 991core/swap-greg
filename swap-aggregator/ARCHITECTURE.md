# Architecture du projet Swap Aggregator

**Stack** : Next.js App Router · React · TypeScript · wagmi v4 · RainbowKit · @lifi/sdk v3 · viem · franc / english i18n
**Dossier** : `swap-aggregator/` (projet racine)

---

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│                     Next.js App Router                       │
│  ┌──────────────────┐  ┌───────────────────┐                │
│  │    layout.tsx    │  │    app/page.tsx   │                │
│  │  (providers wrap)│  │   SwapPage Client  │                │
│  └────────┬─────────┘  └────────┬──────────┘                │
│           │                     │                            │
│  ┌────────▼─────────────────────▼──────────┐                │
│  │              SwapCard.tsx               │  ← UI centrale  │
│  │  ┌──────────┐  ┌───────────────────┐   │                │
│  │  │ From     │  │    RouteList      │   │                │
│  │  │ Selector │  │    (routes)       │   │                │
│  │  └────┬─────┘  └────────┬──────────┘   │                │
│  │       │                 │              │                │
│  │  ┌────▼─────────────────▼─────┐        │                │
│  │  │    TokenSelectModal        │        │                │
│  │  │  (chains · tokens · search)│        │                │
│  │  └────────────────────────────┘        │                │
│  └─────────────────────────────────────────┘                │
│                                                             │
│  ┌──────────────────────────────────────────┐               │
│  │           lib/aggregators/               │  ← Providers  │
│  │  ┌──────────┐ ┌──────┐ ┌────────┐       │               │
│  │  │ lifi/    │ │ rango│ │ socket │       │               │
│  │  │ routes   │ │ routes││ routes │       │               │
│  │  │ execute  │ │ execute││ execute│       │               │
│  │  │ client   │ │ client ││ client │       │               │
│  │  └──────────┘ └──────┘ └────────┘       │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
│  ┌──────────────────────────────────────────┐               │
│  │  lib/lifi.ts · routes.ts · execute.ts    │               │
│  │  lib/routing/orchestrator.ts             │               │
│  │  lib/types/normalized-route.ts           │               │
│  └──────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Fichiers essentiels

| Fichier | Rôle |
|---------|------|
| `app/layout.tsx` | Providers (I18nProvider, WagmiConfig, RainbowKit) |
| `app/page.tsx` | Page client → SwapPage → SwapCard |
| `components/SwapCard.tsx` | UI principale : from/to selectors, amount, providers toggle, CTA, route list |
| `components/RouteList.tsx` | Liste des routes (provider, toAmount, duration, fee) |
| `components/TokenSelectModal.tsx` | Modal : sélection chaîne + tokens, search, owned tokens |
| `lib/chains.ts` | 7 EVM chains (APP_CHAINS, APP_CHAIN_IDS, CHAIN_LABELS) |
| `lib/topTokens.ts` | Top 20 market-cap + SYMBOL_ALIASES (WBTC→BTC, WETH→ETH, …) |
| `lib/lifi.ts` | `buildKnownFallbackTokens()`, `SwapParams`, `AppToken`, `TokenBalanceEntry` |
| `lib/aggregators/lifi/routes.ts` | `fetchSupportedChains()`, `fetchTopTokensByChain()`, `fetchRoutes()`, `fetchWalletTokenBalances()` |
| `lib/aggregators/lifi/execute.ts` | `executeSwap()` → `getSwapRoute(client, payload)` → `route.execute()` |
| `lib/aggregators/lifi/client.ts` | `getLifiSdkClient()` → `createClient({ apiKey, baseUrl })` |
| `lib/aggregators/rango/routes.ts` | `fetchRangoRoutes()` → `https://api.rango.exchange/basic/quote` (stub) |
| `lib/aggregators/rango/execute.ts` | Stub : `throw Error("not implemented")` |
| `lib/aggregators/socket/routes.ts` | Stub : `throw Error("not implemented")` |
| `lib/aggregators/socket/execute.ts` | Stub : `throw Error("not implemented")` |
| `lib/aggregators/socket/client.ts` | Stub : `throw Error("not implemented")` |
| `lib/routing/orchestrator.ts` | `getRoutesForSelection()` → appels Rango + LI.FI + Socket → `normalizeAllRoutes()` → tri par `toAmount` |
| `lib/types/normalized-route.ts` | `ProviderName = "lifi" \| "socket" \| "rango"`, `NormalizedRoute` |
| `lib/pricing.ts` | Coingecko price cache (60s TTL), `SYMBOL_ID_MAP`, `ADDRESS_ID_MAP`, `formatCurrencyValue()` |
| `lib/tokenUtils.ts` | `getNativeAssetMeta()`, `createTokenEntry()`, `buildFallbackEntries()`, `sortTokenEntries()` |
| `lib/i18n.tsx` | Contexte i18n (`en`/`fr`), détection `navigator.language`, persistance `localStorage`, 62 clés de traduction |
| `components/i18n.tsx` | Hook `useI18n()` avec `translate()` + `t()` |

---

## 3. Dépendances npm

```json
{
  "dependencies": {
    "@lifi/sdk": "^3.0.0",
    "@rainbow-me/rainbowkit": "^2.0.0",
    "@tanstack/react-query": "^5.0.0",
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "viem": "^2.0.0",
    "wagmi": "^2.0.0"
  }
}
```

---

## 4. Chaînes supportées par LI.FI (7 EVM)

| Chain ID | Name | viem import | Native token |
|----------|------|-------------|--------------|
| 1 | Ethereum | `mainnet` | ETH |
| 137 | Polygon | `polygon` | POL |
| 56 | BNB Chain | `bsc` | BNB |
| 42161 | Arbitrum | `arbitrum` | ETH |
| 10 | Optimism | `optimism` | ETH |
| 8453 | Base | `base` | ETH |
| 43114 | Avalanche | `avalanche` | AVAX |

**Code de référence** — `lib/chains.ts` :

```typescript
import {
  arbitrum, avalanche, base, bsc,
  mainnet, optimism, polygon,
} from "viem/chains";

export const APP_CHAINS = [
  base, mainnet, arbitrum,
  optimism, polygon, bsc, avalanche,
] as const;

export const APP_CHAIN_IDS = APP_CHAINS.map((c) => c.id);

export const CHAIN_LABELS: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum",
  [optimism.id]: "Optimism",
  [polygon.id]: "Polygon",
  [bsc.id]: "BNB Chain",
  [avalanche.id]: "Avalanche",
};
```

**Code de référence** — `lib/aggregators/lifi/routes.ts` (lignes 231-247) :

```typescript
export async function fetchSupportedChains(): Promise<ExtendedChain[]> {
  const client = getLifiSdkClient();
  const chains = await getChains(client);
  const allowed = new Set<number>(APP_CHAIN_IDS);
  const filtered = chains.filter((chain) => allowed.has(chain.id));
  if (filtered.length === 0) {
    return chains.filter((chain) => allowed.has(chain.id));
  }
  return filtered.sort(
    (a, b) =>
      APP_CHAIN_IDS.indexOf(a.id as (typeof APP_CHAIN_IDS)[number]) -
      APP_CHAIN_IDS.indexOf(b.id as (typeof APP_CHAIN_IDS)[number]),
  );
}
```

---

## 5. Tokens supportés (Top 20 + alias)

| Top Symbol | Aliases LI.FI | Appartenant à |
|------------|---------------|---------------|
| BTC | WBTC | Bitcoin |
| ETH | WETH | Ethereum |
| USDT | — | Tether |
| BNB | WBNB | BNB Chain |
| XRP | — | XRP |
| SOL | — | Solana (bridged) |
| USDC | USDC.E | USD Coin |
| DOGE | — | Dogecoin |
| ADA | — | Cardano (bridged) |
| TRX | — | Tron |
| AVAX | WAVAX | Avalanche |
| LINK | — | Chainlink |
| SHIB | — | Shiba Inu |
| TON | — | Toncoin |
| DOT | — | Polkadot |
| POL | MATIC, WMATIC | Polygon |
| BCH | — | Bitcoin Cash |
| LTC | — | Litecoin |
| UNI | — | Uniswap |

**Code de référence** — `lib/topTokens.ts` :

```typescript
export const TOP_20_SYMBOLS = [
  "BTC", "ETH", "USDT", "BNB", "XRP", "SOL",
  "USDC", "DOGE", "ADA", "TRX", "AVAX",
  "LINK", "SHIB", "TON", "DOT", "WBTC",
  "POL", "BCH", "LTC", "UNI",
] as const;

const SYMBOL_ALIASES: Record<string, TopSymbol> = {
  BTC: "BTC", WBTC: "BTC",
  ETH: "ETH", WETH: "ETH",
  USDT: "USDT",
  BNB: "BNB", WBNB: "BNB",
  USDC: "USDC", "USDC.E": "USDC",
  AVAX: "AVAX", WAVAX: "AVAX",
  POL: "POL", MATIC: "POL", WMATIC: "POL",
  // … (compléter selon le fichier complet)
};

export function normalizeToTopSymbol(symbol: string): TopSymbol | null {
  const upper = symbol.trim().toUpperCase();
  if (upper === "WBTC" || upper === "BTC") return "BTC";
  const aliased = SYMBOL_ALIASES[upper];
  if (aliased && aliased !== "WBTC" && TOP_SET.has(aliased)) return aliased;
  if (TOP_SET.has(upper)) return upper as TopSymbol;
  return null;
}
```

---

## 6. Paires possibles

Avec **7 chaînes** × **20 top symbols** :

- **Pairs intra-chaîne** : 7 (un token vers lui-même, surtout ETH/ETH)
- **Pairs inter-chaîne** : 7 × 6 = 42 paires de chaînes
- **Paires de tokens par paire de chaînes** : 20 × 20 = 400 (théoriquement)
- **Total théorique** : ~ 16 800 combinaisons chaîne1/chaîne2/token1/token2

**En pratique**, LI.FI détermine dynamiquement les paires supportées via `getRoutes()`. Le filtre `TOP_20_SYMBOLS` dans `fetchTopTokensByChain()` (lignes 260-261) réduit le pool UI aux tokens top-20 :

```typescript
// lib/aggregators/lifi/routes.ts :260-261
for (const token of list) {
  if (!isTop20Symbol(token.symbol)) continue;
  // …
}
```

---

## 7. Fournisseurs (Providers) — État d'intégration

### 7.1 LI.FI — ✅ Implémenté

| Composant | Fichier | Fonction |
|-----------|---------|----------|
| Client | `lib/aggregators/lifi/client.ts` | `createClient({ apiKey, baseUrl })` |
| Routes | `lib/aggregators/lifi/routes.ts` | `getRoutes(client, { fromChainId, toChainId, fromTokenAddress, toTokenAddress, fromAmount, fromAddress, options })` |
| Execution | `lib/aggregators/lifi/execute.ts` | `getSwapRoute(client, payload)` → `route.execute()` |
| Chains | `lib/aggregators/lifi/routes.ts` | `getChains(client)` |
| Tokens | `lib/aggregators/lifi/routes.ts` | `getTokens(client, { chains })` |
| Balances | `lib/aggregators/lifi/routes.ts` | `getTokenBalances(client, walletAddress)` |

**Code de référence** — `lib/aggregators/lifi/routes.ts` (lignes 440-470) :

```typescript
export async function fetchRoutes(params: SwapParams): Promise<Route[]> {
  if (!params) {
    throw new Error("Les paramètres de recherche LI.FI sont absents.");
  }

  const client = getLifiSdkClient();
  const result = await getRoutes(client, {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    options: {
      ...(PLATFORM_FEE > 0 ? { fee: PLATFORM_FEE } : {}),
      maxPriceImpact: 0.4,
    },
  });

  const routes = [...(result.routes ?? [])];
  routes.sort((a, b) => {
    const aNet = BigInt(a.toAmount);
    const bNet = BigInt(b.toAmount);
    if (aNet === bNet) return 0;
    return aNet > bNet ? -1 : 1;
  });

  return routes;
}
```

**Code de référence** — `lib/aggregators/lifi/execute.ts` :

```typescript
import type { Route } from "@lifi/sdk";

export async function executeSwap(
  route: Route,
  _onProgress?: (progress: number) => void,
): Promise<void> {
  const step = route.steps?.[0];
  if (!step?.estimate) {
    throw new Error("Pas de payload LI.FI pour cette route.");
  }

  await route.execute();
}
```

### 7.2 Rango — ⚠️ Routes uniquement

| Composant | Fichier | État |
|-----------|---------|------|
| Client | `lib/aggregators/rango/client.ts` | `throw Error("not implemented")` |
| Routes | `lib/aggregators/rango/routes.ts` | ✅ API call à `https://api.rango.exchange/basic/quote` |
| Execution | `lib/aggregators/rango/execute.ts` | `throw Error("not implemented")` |

La fonction `fetchRangoRoutes()` renvoie `[]` si `NEXT_PUBLIC_RANGO_API_KEY` n'est pas défini. `normalizeRangoRoute()` convertit en `NormalizedRoute`.

**Code de référence** — `lib/aggregators/rango/routes.ts` :

```typescript
export async function fetchRangoRoutes(params: SwapParams): Promise<RangoRoute[]> {
  const apiKey = process.env.NEXT_PUBLIC_RANGO_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://api.rango.exchange/basic/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        from: { blockchain: params.fromChainId === 1 ? "ETH" : "ETH", address: params.fromTokenAddress || null },
        to: { blockchain: params.toChainId === 1 ? "ETH" : "ETH", address: params.toTokenAddress || null },
        amount: params.fromAmount,
        fromAddress: params.fromAddress || undefined,
        toAddress: params.fromAddress || undefined,
        slippage: 1.5,
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const route = data?.route ?? data;
    if (!route) return [];

    return [{
      id: route.id ?? `rango-${params.fromChainId}-${params.toChainId}`,
      toAmount: route.toAmount ?? route.destinationAmount ?? "0",
      steps: route.steps ?? [],
    }];
  } catch {
    return [];
  }
}
```

### 7.3 Socket — ❌ Aucun code

Tous les fichiers `client.ts`, `routes.ts`, `execute.ts` contiennent uniquement :

```typescript
throw Error("not implemented");
```

### 7.4 Résumé

| Provider | Routes | Execution | État |
|----------|--------|-----------|------|
| LI.FI | ✅ | ✅ | **Opérationnel** |
| Rango | ✅ (stub API) | ❌ | **Preview only** |
| Socket | ❌ | ❌ | **Non intégré** |

---

## 8. Flux de routing complet

```
┌────────────────────────────────────────────────────────────────┐
│                         UI : SwapCard                          │
│  1. Utilisateur sélectionne : fromChain, fromToken            │
│     toChain, toToken, amount, selectedProviders[]             │
│                                                                │
│  2. handleSwap() se déclenche (bouton CTA)                     │
│     → fetchSwapRoutes(params, selectedProviders)               │
│                                                                │
│  3. getRoutesForSelection() → lib/routing/orchestrator.ts      │
│     ├── fetchRangoRoutes(params)   → normalized routes         │
│     ├── fetchRoutes(params) (LI.FI) → normalized routes       │
│     └── fetchSocketRoutes(params)  → throw error (ignored)    │
│                                                                │
│  4. normalizeAllRoutes() → NormalizedRoute[]                   │
│     (provider, from/to addresses, toAmount, toolLabel)         │
│                                                                │
│  5. normalized.sort(by BigInt(toAmount)) — meilleur en premier │
│                                                                │
│  6. RouteList → affiche chaque route                           │
│     └── onSelect(route) → set route dans SwapCard state        │
│                                                                │
│  7. CTA "Swap" → handleSwap() → executeSwap(route)             │
│     ├── Provider "lifi" → lib/aggregators/lifi/execute.ts      │
│     │   → route.execute() → txHash (si exécution réussie)      │
│     ├── Provider "rango" → throw Error("not implemented")      │
│     └── Provider "socket" → throw Error("not implemented")     │
└────────────────────────────────────────────────────────────────┘
```

### Code de référence — `lib/routing/orchestrator.ts` :

```typescript
import { fetchRoutes as fetchLifiRoutes } from "../aggregators/lifi/routes";
import { fetchRangoRoutes } from "../aggregators/rango/routes";
import { fetchSocketRoutes } from "../aggregators/socket/routes";
import { normalizeLifiRoute } from "../aggregators/lifi/routes";
import { normalizeRangoRoute } from "../aggregators/rango/routes";
import type { NormalizedRoute, ProviderName, ProviderSelection } from "../types/normalized-route";

export async function getRoutesForSelection(
  params: SwapParams,
  selectedProviders: ProviderSelection,
): Promise<NormalizedRoute[]> {
  const results: Promise<NormalizedRoute[]>[] = [];

  if (selectedProviders.rango) {
    const rangoRoutes = fetchRangoRoutes(params);
    results.push(rangoRoutes.then((raw) => raw.map((r) => normalizeRangoRoute(r, params))));
  }

  if (selectedProviders.lifi) {
    const lifiRoutes = fetchLifiRoutes(params);
    results.push(lifiRoutes.then((raw) => raw.map((r) => normalizeLifiRoute(r, params))));
  }

  // Socket : provider défini mais pas implémenté
  // if (selectedProviders.socket) { ... }

  const allResults = await Promise.all(results);
  const normalized = allResults.flat();

  normalized.sort((a, b) => {
    const aAmt = BigInt(a.toAmount);
    const bAmt = BigInt(b.toAmount);
    if (aAmt === bAmt) return 0;
    return aAmt > bAmt ? -1 : 1;
  });

  return normalized;
}
```

---

## 9. Orchestration côté client — SwapCard

### 9.1 Initialisation des états

**Code de référence** — `components/SwapCard.tsx` (lignes 70-90 approx.) :

```typescript
const [fromChainId, setFromChainId] = useState<number>(mainnet.id);
const [toChainId, setToChainId] = useState<number>(base.id);
const [fromToken, setFromToken] = useState<AppToken | null>(null);
const [toToken, setToToken] = useState<AppToken | null>(null);
const [fromAmount, setFromAmount] = useState("");
const [selectedRoute, setSelectedRoute] = useState<NormalizedRoute | null>(null);
const [providers, setProviders] = useState<ProviderSelection>({
  lifi: true,
  socket: false,
  rango: true,
});
const [routes, setRoutes] = useState<NormalizedRoute[]>([]);
```

### 9.2 Sélection de providers toggle

**Code de référence** — `components/SwapCard.tsx` (lignes 495-510) :

```tsx
<div className="provider-toggles">
  {providerButtons.map((provider) => {
    const { id, label } = provider;
    const active = providers[id as ProviderName] ?? false;
    return (
      <button
        key={id}
        className={active ? "amount-balance-pill" : "amount-quick-btn"}
        onClick={() => toggleProvider(provider)}
      >
        {active ? "●" : "○"} {label}
      </button>
    );
  })}
</div>
```

### 9.3 Appels de routing

**Code de référence** — `components/SwapCard.tsx` (ligne ~130, dans `handleSwap`) :

```typescript
async function handleSwap() {
  const params = {
    fromChainId, toChainId,
    fromTokenAddress: fromToken?.address ?? "",
    toTokenAddress: toToken?.address ?? "",
    fromAmount, fromAddress: address,
  };

  if (!routeSelected) {
    const fetchedRoutes = await getRoutesForSelection(params, providers);
    setRoutes(fetchedRoutes);
    return;
  }

  // Execute selected route
  if (selectedRoute?.provider === "lifi") {
    await executeSwap(selectedRoute.raw as Route);
  }
}
```

---

## 10. Pipeline de données tokens

```
LI.FI SDK getTokens({ chains: [1, 137, 56, 42161, 10, 8453, 43114] })
  ↓
  tokens[chainId] → pour chaque chaîne
  ↓
  Filtrer isTop20Symbol(token.symbol) — ligne 261 de routes.ts
  ↓
  normalizeToTopSymbol(symbol) — lignes 65-72 de topTokens.ts
  ↓
  bestByTop.get(topSymbol) — un seul entry par symbol (exact match preferred)
  ↓
  sort(topSymbolRank) — ordre stable : BTC > ETH > USDT > … > UNI
  ↓
  KnownTokensByChain = { 1: [...], 137: [...], 56: [...], … }
  ↓
  buildKnownFallbackTokens(chainId) — fallback si LI.FI ne retourne rien
  → native token + USDC + USDT/WETH/DAI selon chaîne (lignes 41-206 de routes.ts)
```

### Exemple : Tokens par chaîne (fallbacks)

| Chaîne | Fallback tokens (hardcoded) |
|--------|---------------------------|
| Ethereum (1) | ETH, USDC, USDT, WETH |
| Base (8453) | ETH, USDC, DAI, WETH |
| Arbitrum (42161) | ETH, USDC, USDT |
| Optimism (10) | ETH, USDC |
| Polygon (137) | POL, USDC |
| BSC (56) | BNB (fallback only) |
| Avalanche (43114) | AVAX (fallback only) |

---

## 11. i18n

### Contexte

**Code de référence** — `lib/i18n.tsx` :

```typescript
type Lang = "en" | "fr";

function detectBrowserLang(): Lang {
  if (typeof navigator !== "undefined" && navigator.language) {
    const code = navigator.language.slice(0, 2).toLowerCase();
    if (code === "fr") return "fr";
  }
  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("hermes-lang");
    if (saved === "en" || saved === "fr") {
      setLangState(saved);
    } else {
      setLangState(detectBrowserLang());
    }
  }, []);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem("hermes-lang", newLang);
  };

  const translate = (key: TranslationKey, params?: Record<string, string>) => {
    let result = t(key, lang);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, v);
      });
    }
    return result;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, translate }}>
      {children}
    </I18nContext.Provider>
  );
}
```

**62 clés de traduction** couvrant : labels UI, états de boot, messages d'erreur, modale, routes, CTA.
Fallback strict : `en` si `localStorage` est vide ou corrompu.

---

## 12. Prix & conversion devise

### Pricing

**Code de référence** — `lib/pricing.ts` :

```typescript
const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const CACHE_TTL_MS = 60_000; // 1 minute

const SYMBOL_ID_MAP: Record<string, string> = {
  ETH: "ethereum", WETH: "weth",
  BTC: "bitcoin", WBTC: "wrapped-bitcoin",
  USDC: "usd-coin", USDT: "tether", DAI: "dai",
  // …
};

export async function fetchTokenPriceUsd(token: AppToken): Promise<number | null> {
  const cached = priceCache.get(getCacheKey(token));
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const coinGeckoId = getCoinGeckoId(token);
  if (!coinGeckoId) return null;

  const response = await fetch(
    `${COINGECKO_PRICE_URL}?ids=${coinGeckoId}&vs_currencies=usd`
  );
  // cache 60s → priceCache.set(...)
  return value;
}
```

### Conversion

```typescript
export function formatCurrencyValue(
  value: number | null, currency: "USD" | "EUR" = "USD"
): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const rate = currency === "EUR" ? 0.92 : 1;
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${amount.toLocaleString("fr-FR", { min, max })}`;
}
```

---

## 13. Types

**Code de référence** — `lib/types/normalized-route.ts` :

```typescript
export type ProviderName = "lifi" | "socket" | "rango";

export interface ProviderSelection {
  lifi: boolean;
  socket: boolean;
  rango: boolean;
}

export interface NormalizedRoute {
  id: string;
  provider: ProviderName;
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  toAmount: string;
  toolLabel: string;    // e.g. "1inch → Hop" ou "LI.FI"
  durationSeconds: number;
  raw: unknown;         // Route LI.FI, RangoRoute, etc.
}
```

---

## 14. Variables d'environnement

| Variable | Rôle |
|----------|------|
| `NEXT_PUBLIC_LIFI_API_KEY` | Clé API LI.FI (optionnelle, pour quota) |
| `NEXT_PUBLIC_RANGO_API_KEY` | Clé API Rango (si activée) |
| `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` | Frais plateforme (ex: 0.5 = 0.5 %) |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | WalletConnect projectId |

---

## 15. Arborescence complète

```
swap-aggregator/
├── AGENTS.md
├── ARCHITECTURE.md        ← ce fichier
├── PROJECT.md
├── README.md
├── next.config.js
├── package.json
├── tsconfig.json
├── app/
│   ├── layout.tsx         # Providers: I18n, Wagmi, RainbowKit
│   ├── page.tsx           # "use client"; → <SwapPage>
│   └── globals.css
├── components/
│   ├── SwapCard.tsx       # UI principale (554 lignes)
│   ├── RouteList.tsx      # Liste des routes
│   └── TokenSelectModal.tsx # Modal sélection chaîne/token
├── lib/
│   ├── chains.ts          # 7 EVM chains
│   ├── topTokens.ts       # Top 20 + aliases
│   ├── lifi.ts            # SwapParams, AppToken, buildKnownFallbackTokens()
│   ├── orchestrator.ts    # getRoutesForSelection()
│   ├── pricing.ts         # Coingecko prices
│   ├── tokenUtils.ts      # Native asset meta, sorting
│   ├── i18n.tsx           # 62 clés de traduction en/fr
│   ├── types/
│   │   └── normalized-route.ts  # ProviderName, ProviderSelection, NormalizedRoute
│   └── aggregators/
│       ├── lifi/
│       │   ├── client.ts           # createClient()
│       │   ├── routes.ts           # getChains, getTokens, getRoutes, getTokenBalances, fetchWalletTokenBalances
│       │   └── execute.ts          # executeSwap()
│       │   └── routing/
│       │       └── orchestrator.ts # (LI.FI-specific, minimal wrapper)
│       ├── rango/
│       │   ├── client.ts           # throw Error("not implemented")
│       │   ├── routes.ts           # fetchRangoRoutes() + normalizeRangoRoute()
│       │   └── execute.ts          # throw Error("not implemented")
│       └── socket/
│           ├── client.ts           # throw Error("not implemented")
│           ├── routes.ts           # throw Error("not implemented")
│           └── execute.ts          # throw Error("not implemented")
└── public/
```

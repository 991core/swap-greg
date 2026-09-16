# AGENTS.md

## Project overview
- This repo is a Next.js 14 App Router + TypeScript app for Hermes, a cross-chain swap/bridge aggregator.
- The MVP uses LI.FI directly from the frontend and keeps the product scope intentionally narrow: curated top-20 tokens, transparent fees, and user-selected routes rather than an opaque “best route” recommendation.
- The main user flow starts in [app/page.tsx](app/page.tsx), then continues through [components/SwapCard.tsx](components/SwapCard.tsx), [components/RouteList.tsx](components/RouteList.tsx), and [components/TokenSelectModal.tsx](components/TokenSelectModal.tsx).

## Technical handoff summary
- Product context: Hermes is a web-based cross-chain swap/bridge aggregator MVP. The app is intentionally narrow: it shows LI.FI routes directly from the frontend, uses a curated top-20 token universe, and lets the user choose a route rather than relying on an opaque “best route” recommendation.
- Who does what:
  - [app/page.tsx](app/page.tsx) is the shell page. It renders the brand, the wallet connect button, and the main swap widget.
  - [app/providers.tsx](app/providers.tsx) wires the wallet stack: wagmi, viem, RainbowKit, and the supported EVM chains.
  - [components/SwapCard.tsx](components/SwapCard.tsx) is the main orchestrator for the swap flow: wallet state, token selection, balances, route fetching, route selection, and swap execution.
  - [components/RouteList.tsx](components/RouteList.tsx) renders the available routes as selectable options with net amount, duration, and tool labels.
  - [components/TokenSelectModal.tsx](components/TokenSelectModal.tsx) provides the token picker UI, including chain switching and wallet balance display.
  - [lib/lifi.ts](lib/lifi.ts) is the core integration layer for LI.FI. It handles chain/token discovery, route requests, amount parsing/formatting, fee injection, route sorting, balance helpers, and wallet-client setup for execution.
  - [lib/topTokens.ts](lib/topTokens.ts) defines the static top-20 token allowlist and the normalization logic that maps LI.FI symbols (for example WBTC or WETH) to the curated product symbols.
  - [lib/chains.ts](lib/chains.ts) defines the supported EVM chains and their display labels.
  - [lib/tokenUtils.ts](lib/tokenUtils.ts) contains helper functions used by the token picker to build, rank, and search token entries.
  - [app/layout.tsx](app/layout.tsx) defines the root metadata and injects the providers wrapper.
  - [app/globals.css](app/globals.css) contains the full visual system and component styling for the whole app.
  - [next.config.js](next.config.js) enables strict React mode for the Next.js app.
  - [tsconfig.json](tsconfig.json) configures TypeScript, path aliases, and Next.js support.
  - [.env.example](.env.example) documents the runtime environment variables needed for wallet connection, LI.FI, and platform fees.
- How the main flow works:
  1. The app boots, loads supported chains from LI.FI, and fetches the top-20 tokens available on those chains.
  2. The user connects a wallet and selects a source/target chain and token pair.
  3. When the user enters an amount, the app requests routes from LI.FI, sorts them by net received amount, and preselects the top route.
  4. The user can inspect and choose another route manually.
  5. When the user confirms, the app switches the wallet to the source chain if needed and executes the selected route through LI.FI.
- Important product constraints:
  - The token universe is intentionally curated and not a full-coverage aggregator catalog.
  - The MVP targets mainnet EVM chains; testnet coverage is too limited for a useful experience.
  - Fees are applied transparently and are included in the displayed net amount.
  - The UI is intentionally neutral: it shows routes and lets the user choose, rather than imposing a hidden “best” recommendation.
- Runtime configuration:
  - NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  - NEXT_PUBLIC_LIFI_API_KEY
  - NEXT_PUBLIC_PLATFORM_FEE_PERCENT
- Operational caveats for future work or edits:
  - LI.FI coverage varies by chain and asset; some top-20 tokens may be absent on some networks.
  - Decimal and BigInt handling should reuse the helpers in [lib/lifi.ts](lib/lifi.ts) instead of introducing ad-hoc parsing.
  - The current MVP relies on frontend-only orchestration; backend orchestration, multi-provider aggregation, and reliability scoring are future work.

## File-by-file technical breakdown
### [app/layout.tsx](app/layout.tsx)
- Purpose: bootstrap the app shell and metadata for Next.js.
- Responsibilities:
  - Declares the page metadata title and description.
  - Injects the [app/providers.tsx](app/providers.tsx) wrapper so wagmi/RainbowKit/query client are available throughout the app.
  - Loads global CSS once at the root.

### [app/page.tsx](app/page.tsx)
- Purpose: top-level page component for the landing/swap experience.
- Responsibilities:
  - Renders the Hermes branding header and wallet connect button.
  - Mounts [components/SwapCard.tsx](components/SwapCard.tsx), which contains the full swap widget.

### [app/providers.tsx](app/providers.tsx)
- Purpose: configure the wallet and chain stack.
- Responsibilities:
  - Creates the wagmi configuration with RainbowKit and a default WalletConnect project ID.
  - Registers the EVM chains used by the app: mainnet, Base, Arbitrum, Optimism, Polygon, BNB Chain, and Avalanche.
  - Wraps children with Wagmi, React Query, and RainbowKit providers.

### [app/globals.css](app/globals.css)
- Purpose: styling system for the full experience.
- Responsibilities:
  - Defines the Hermes theme colors, typography, spacing, layout primitives, and component classes.
  - Styles the swap widget, token panels, token picker buttons, route list, modal, and action buttons.

### [components/SwapCard.tsx](components/SwapCard.tsx)
- Purpose: main orchestrator of the swap UX.
- Responsibilities:
  - Maintains local state for source/target chain, selected tokens, amount input, routes, selected route, loading state, error state, and modal visibility.
  - Loads supported chains and token universe on startup via [lib/lifi.ts](lib/lifi.ts).
  - Requests routes whenever the wallet is connected and both tokens/amount are ready.
  - Computes the preview amount for the destination token from the selected route.
  - Reads wallet balances for the source token (native or ERC-20) and offers quick amount buttons.
  - Handles inversion of the swap direction.
  - Executes the selected route by switching chains if necessary and calling `executeRoute` from LI.FI.
- Key functions and logic:
  - `formatQuickAmount(raw, decimals)`: trims and formats decimal input for quick percentage amounts.
  - `TokenButton(...)`: small presentational component for the token selector button.
  - `SwapCard()`: main component and stateful controller.
  - `loadRoutes`: fetches routes from LI.FI after validating the wallet, tokens, and amount.
  - `applyQuickAmount(percent)`: fills the input with a percentage of the current balance.
  - `invert()`: swaps the source and destination chain/token state.
  - `handleSelect(side, chainId, token)`: updates the selected source or destination token.
  - `handleSwap()`: switches to the source chain if needed and triggers route execution.

### [components/RouteList.tsx](components/RouteList.tsx)
- Purpose: render the available LI.FI routes as a selectable list.
- Responsibilities:
  - Displays each route with the net amount received, estimated duration, and tool labels.
  - Lets the user choose a route via radio selection.
- Key logic:
  - Uses helpers from [lib/lifi.ts](lib/lifi.ts) to convert route amounts and duration to human-readable strings.
  - The selected route is communicated upward through the `onSelect` callback.

### [components/TokenSelectModal.tsx](components/TokenSelectModal.tsx)
- Purpose: token picker modal with chain filtering and wallet balance support.
- Responsibilities:
  - Shows a searchable list of tokens for the selected chain.
  - Supports switching between chains from the modal UI.
  - Displays wallet balances for native assets and ERC-20 tokens when available.
  - Builds a ranked list of entries using helpers from [lib/tokenUtils.ts](lib/tokenUtils.ts).
- Key logic:
  - `useEffect` opens the modal and resets query/chain state.
  - `knownTokens` filters to non-zero-address tokens for the chosen chain.
  - `nativeBalance` and `erc20Balances` fetch wallet balances for the currently viewed chain.
  - `ownedEntries` creates balance-aware token entries for the wallet.
  - `tokens` merges owned tokens with fallback entries, ranks them, and applies search filtering.

### [lib/lifi.ts](lib/lifi.ts)
- Purpose: the core LI.FI adapter and amount/formatting utility layer.
- Responsibilities:
  - Initializes the LI.FI SDK config with the integrator name and optional API key.
  - Maps supported EVM chains to viem chain definitions for balance and wallet interactions.
  - Builds fallback token data when LI.FI does not return enough tokens for a chain.
  - Provides helpers for fetching supported chains, top-20 tokens, wallet balances, routes, and formatting/amount parsing.
- Key functions:
  - `buildKnownFallbackTokens(chainId)`: returns a curated fallback list of common tokens for a chain.
  - `setLifiWalletClient(walletClient)`: registers the active wallet client with LI.FI so the SDK can execute swaps.
  - `fetchSupportedChains()`: calls LI.FI to get supported chains and keeps only those allowed by the app.
  - `fetchTopTokensByChain(chainIds)`: retrieves tokens for each chain from LI.FI, filters them to the curated top-20 universe, normalizes symbols (for example WBTC → BTC, WETH → ETH), and sorts them by product rank.
  - `fetchOnchainBalancesForChain(walletAddress, chainId, tokens)`: reads native and ERC-20 balances directly from chain RPCs.
  - `fetchWalletTokenBalances(walletAddress, knownTokensByChain)`: attempts to read balances via LI.FI and then falls back to direct on-chain polling.
  - `fetchRoutes(params)`: requests routes from LI.FI, applies the optional platform fee, caps price impact, and sorts routes by net amount received.
  - `formatTokenAmount(amount, decimals, maxFrac)`: converts raw token amounts into human-readable decimal strings.
  - `parseTokenAmount(human, decimals)`: converts user input like `1.23` into the raw integer string expected by the LI.FI SDK.
  - `estimateRouteSeconds(route)`: adds the execution durations from each route step.
  - `formatDuration(seconds)`: converts seconds to a human-friendly string like `~5 min`.
  - `routeToolLabels(route)`: extracts the tool names from each step and joins them into a readable label.

### [lib/topTokens.ts](lib/topTokens.ts)
- Purpose: define the curated top-20 token universe and symbol normalization rules.
- Responsibilities:
  - Maintains a static allowlist of product symbols.
  - Normalizes LI.FI symbols like `WBTC`, `WETH`, `MATIC`, `USDC.E`, and `WAVAX` to product-level symbols like `BTC`, `ETH`, `POL`, and `USDC`.
  - Provides rank ordering so the UI can sort tokens consistently.
- Key functions:
  - `normalizeToTopSymbol(symbol)`: maps LI.FI token symbols onto the Hermes top-symbol vocabulary.
  - `isTop20Symbol(symbol)`: checks whether a symbol belongs to the curated universe.
  - `topSymbolRank(topSymbol)`: returns a stable numeric order for UI sorting.

### [lib/chains.ts](lib/chains.ts)
- Purpose: define the supported EVM chains and labels used throughout the UI.
- Responsibilities:
  - Lists the app-supported chains.
  - Exposes their numeric IDs and human-readable labels.
  - Provides `isAppChainId()` as a small guard for validation.

### [lib/tokenUtils.ts](lib/tokenUtils.ts)
- Purpose: helpers for token modal presentation and ordering.
- Responsibilities:
  - Maps a chain ID to the correct native asset metadata (ETH, POL, BNB, AVAX, etc.).
  - Creates token entries with chain metadata and balance overrides.
  - Builds fallback entries from LI.FI token lists.
  - Sorts tokens by ownership and balance before display.
  - Produces search terms from symbol, name, and top symbol.
- Key functions:
  - `getNativeAssetMeta(chainId)`: returns the native symbol/name for the chain.
  - `createTokenEntry(token, chainId, overrides)`: returns a token enriched with chain metadata.
  - `buildFallbackEntries(tokens, chainId)`: filters and rewraps tokens into a UI-friendly list.
  - `sortTokenEntries(tokens)`: ranks tokens with owned balances first, then by USD balance, then alphabetically.
  - `getTokenSearchTerms(token)`: creates a normalized search string for the modal query.

## Runtime and configuration
- The app expects these environment variables from [.env.example](.env.example):
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for RainbowKit / WalletConnect.
  - `NEXT_PUBLIC_LIFI_API_KEY` for LI.FI requests when needed.
  - `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` for transparent platform fees.
- In local development, the values should be placed in `.env.local` rather than committed to the repository.

## Key implementation notes for future edits
- Reuse helpers from [lib/lifi.ts](lib/lifi.ts) for amount parsing, formatting, and route duration/tool labeling rather than creating duplicate logic.
- Keep the curated token universe intact unless product scope is explicitly changed.
- Be cautious with BigInt and decimal conversion; the SDK expects integer strings rather than user-facing decimal values.
- The current architecture is frontend-only; any deeper orchestration, multi-provider aggregation, or reliability scoring should be planned as a future backend layer.

## Recent additions
- **i18n** : `lib/i18n.tsx` (use client), dictionnaires `en.ts` / `fr.ts`, sélecteur de langue dans le header, détection `navigator.language`, persistance `localStorage`, fallback `en`. Aucune string résiduelle en FR (seuls des symboles universels ×/÷ restent).
- **Taux avec solde insuffisant** : la validation de solde est découplée du calcul du taux ; un avertissement indicatif est affiché sans casser le layout.
- **Paires par défaut** : initialisation par défaut sur ETH/ETH et ETH/Optimism au montage de `SwapCard.tsx`.

## Data flow and state map
- UI state lives mostly in [components/SwapCard.tsx](components/SwapCard.tsx): chain IDs, selected tokens, amount, route list, selected route, loading/error states, and modal visibility.
- Boot-time data is loaded once from [lib/lifi.ts](lib/lifi.ts) into `chains` and `tokensByChain` and then passed into the modal.
- Route requests are triggered by `loadRoutes()` whenever the wallet is connected, both tokens are selected, and the amount parses successfully.
- The selected route is passed down to [components/RouteList.tsx](components/RouteList.tsx) for display and selection, while the preview amount is derived from the route’s destination amount.
- Token selection updates the local state and then re-triggers route search because the token pair and chain pair changed.
- On swap execution, the route object is handed to LI.FI via `executeRoute`, while the component keeps the local route list synchronized with any updates returned by the SDK.

## Dependency map between modules
- [app/layout.tsx](app/layout.tsx) → mounts [app/providers.tsx](app/providers.tsx) and global styles.
- [app/page.tsx](app/page.tsx) → renders the page shell and mounts [components/SwapCard.tsx](components/SwapCard.tsx).
- [app/providers.tsx](app/providers.tsx) → configures wagmi/RainbowKit and exposes wallet state to the whole app.
- [components/SwapCard.tsx](components/SwapCard.tsx) → depends on [lib/lifi.ts](lib/lifi.ts), [lib/chains.ts](lib/chains.ts), [components/RouteList.tsx](components/RouteList.tsx), and [components/TokenSelectModal.tsx](components/TokenSelectModal.tsx).
- [components/TokenSelectModal.tsx](components/TokenSelectModal.tsx) → depends on [lib/tokenUtils.ts](lib/tokenUtils.ts) and [lib/lifi.ts](lib/lifi.ts) for token metadata, balance formatting, and ranking.
- [components/RouteList.tsx](components/RouteList.tsx) → depends on [lib/lifi.ts](lib/lifi.ts) for route amount/duration/tool formatting.
- [lib/lifi.ts](lib/lifi.ts) → depends on [lib/chains.ts](lib/chains.ts) and [lib/topTokens.ts](lib/topTokens.ts).
- [lib/topTokens.ts](lib/topTokens.ts) → is used by [lib/lifi.ts](lib/lifi.ts) to normalize symbols and filter the supported token universe.
- [lib/tokenUtils.ts](lib/tokenUtils.ts) → is used only by [components/TokenSelectModal.tsx](components/TokenSelectModal.tsx) for presentation logic.

## Key files to inspect first
- [README.md](README.md) and [PROJECT.md](PROJECT.md) for product scope and roadmap.
- [app/providers.tsx](app/providers.tsx) for wallet and chain setup.
- [lib/lifi.ts](lib/lifi.ts) for LI.FI calls, route sorting, amount parsing, and formatting helpers.
- [lib/topTokens.ts](lib/topTokens.ts) for the curated token allowlist and symbol normalization.
- [lib/chains.ts](lib/chains.ts) for supported EVM chains.

## Working conventions
- Prefer small, localized changes. Most UI logic belongs in the client components under [components](components).
- Preserve the product constraints already encoded in the app: top-20 token universe, mainnet-oriented EVM support, transparent fee handling, and neutral route presentation.
- Reuse helpers from [lib/lifi.ts](lib/lifi.ts) for token amount parsing/formatting and route duration/tool labeling instead of duplicating logic.
- Keep branding and copy consistent with Hermes / HMS Protocol.
- When touching token selection or route loading, keep LI.FI coverage limitations in mind: some top-20 assets are not available on every chain.

## Build and run commands
- Install dependencies: `npm install`
- Start the dev server: `npm run dev`
- Create a production build: `npm run build`
- Run lint: `npm run lint`

## Environment and config
- Use the values from [.env.example](.env.example) and place local overrides in `.env.local`.
- The main runtime config keys are `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_LIFI_API_KEY`, and `NEXT_PUBLIC_PLATFORM_FEE_PERCENT`.

## Pitfalls to avoid
- Do not introduce backend-only orchestration or new aggregation providers unless the task explicitly asks for it.
- Avoid changing the token allowlist or chain support without checking the product intent in [README.md](README.md) and [PROJECT.md](PROJECT.md).
- Be careful with `BigInt` and decimal formatting; use the existing helpers in [lib/lifi.ts](lib/lifi.ts) rather than ad-hoc parsing.

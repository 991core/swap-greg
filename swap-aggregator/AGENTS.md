# Hermes handoff guide

## Scope

Hermes is a Next.js 14 App Router MVP for EVM cross-chain swaps. LI.FI is the
only active provider. Rango and Socket are intentionally disabled until their
quote, transaction, and tracking flows are implemented end to end.

The product searches LI.FI tokens by name, symbol or address on supported EVM
networks, uses transparent platform fees, and
lets the user select a route. It does not silently force a “best” route.

## Where to make changes

- `app/page.tsx` renders the Hermes shell and the RainbowKit connect button.
- `app/providers.tsx` mounts wagmi, React Query, and RainbowKit.
- `lib/wallet.ts` defines the wagmi config. It uses the injected browser-wallet
  connector so the server build does not pull optional Coinbase/Base x402
  connectors. There is no WalletConnect project ID in the current MVP.
- `lib/chains.ts` is the EVM chain allowlist.
- `lib/aggregators/lifi/client.ts` creates the LI.FI client and reads the live
  wallet client from wagmi at execution time.
- `lib/aggregators/lifi/routes.ts` requests routes with the configured fee and timeout.
- `lib/tokens/catalog.ts` pins the local native/ERC-20 defaults by chain/address,
  decimals and symbol. `TOKEN_CATALOG.md` records their sources and maintenance.
  The form and modal initialize from local configuration without a chain/API gate.
- `app/api/tokens/search/route.ts` exposes validated token search. `lib/tokens/`
  separates browser requests, shared validation, and a server-only LI.FI client.
  Search has a bounded one-minute cache, request coalescing and per-process quotas.
- `lib/routing/` owns quote keys, expiry, cancellation, normalization,
  deduplication, sorting, and execution preflight.
- `lib/amounts.ts` is the only user amount parser. It preserves precision with
  `BigInt` and rejects grouping separators, exponents, signs, non-finite values,
  and excess decimals.
- `lib/contractTokenResolver.ts` resolves EVM metadata through the token API only;
  do not restore RPC/CoinGecko fallbacks as proof of LI.FI recognition.
- `lib/pricing.ts` looks up prices by `(chainId, tokenAddress)` and uses a dated
  USD/EUR reference rate.
- `components/SwapCard.tsx`, `TokenSelectModal.tsx`, and `RouteList.tsx` form
  the client-side swap UI.
- `components/QuoteCountdown.tsx` shows the animated quote deadline and retry state.
- `next.config.js` optimizes `viem/chains` imports so unused Tempo worker modules
  are not bundled into the token route. Do not suppress Webpack warnings globally.

## Required invariants

- A quote is executable only while its `quoteKey`, wallet, source chain, token
  addresses, amount, recipient, and expiry still match the form.
- Renew quotes automatically at their deadline (60 seconds). Disable execution
  while refreshing; retry errors/empty results after 15 seconds. Abort obsolete
  requests, pause while executing, and wait while hidden/offline. Resuming must
  not overlap requests or accept late responses. Refreshing never signs or swaps.
- Before signing, check the connected account, source network, source token
  balance, and native gas reserve. This applies to ERC-20 swaps as well as
  native-asset swaps.
- Identify tokens by chain ID and address, never symbol. Do not restore a top-20
  allowlist or LI.FI's default minimum-price filter; search uses `minPriceUSD: 0`.
- Block a flagged verdict even if another provider/duplicate says verified.
  Absent or unverified status requires explicit consent, except an exact reviewed
  catalog entry. Never accept UI consent or a catalog exemption from upstream metadata.
- Opening the modal or selecting a catalog asset must not make an authenticity
  request. A known exact address resolves locally; text searches can still query
  LI.FI for other matches. Price requests are independent and never gate selection.
- Before execution, use pinned metadata for catalog tokens and fetch fresh metadata
  for other tokens. Compare identities and decimals with the selection and quote,
  reject altered catalog metadata, and fail closed if non-catalog metadata is unavailable.
  Recheck account and quote after asynchronous work. LI.FI verdicts are not guarantees.
- Catalog changes require an explicit network/address/decimals review and source
  documentation. This convenience list is not a restriction on remote discovery.
- Pass LI.FI integer amounts as strings. Do not use floating-point arithmetic
  for token amounts.
- Keep the LI.FI execution provider EVM-only. Do not route a Rango or Socket
  object through `executeLifiRoute`.
- Preserve the user-visible minimum received amount, gas estimate, and platform
  fee; do not replace them with a hard-coded estimate.

## Environment

Copy `.env.example` to `.env.local` when needed:

- `LIFI_API_KEY` is optional and server-only for token metadata/search/prices.
  Do not expose it in the browser SDK or restore `NEXT_PUBLIC_LIFI_API_KEY`.
- `TOKEN_SEARCH_REQUESTS_PER_MINUTE` defaults to 60 per process (1–1000).
- `NEXT_PUBLIC_PLATFORM_FEE_PERCENT` is bounded to 0–100.

No secret belongs in the repository.

## Verification

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

The test suite covers amounts, stale quotes, recipients, account/chain changes,
balances, token identity/verdicts, consent, live preflight validation, EUR pricing,
search cancellation, API input, cache expiry/coalescing and quotas.
It also covers instant local selection, impostors, local execution without token
API access, automatic expiry/refresh/retry, hidden/offline tabs and animation states.

## Deliberate limitations

- Rango, Socket, Solana, non-EVM wallets, GoPlus screening and backend quote
  orchestration are future work. The option-B token backend is implemented.
- Cache/quota are per process; distributed deployments need a shared limit if
  they require a global quota. Browser quote requests are outside that budget.
- LI.FI coverage, RPC availability, and route prices are external dependencies.
- Mainnet execution uses real funds; the UI must continue to show the actual
  route data and require an explicit wallet confirmation.

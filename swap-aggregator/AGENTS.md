# Hermes handoff guide

## Scope

Hermes is a Next.js 14 App Router MVP for EVM cross-chain swaps. LI.FI is the
only active provider. Rango and Socket are intentionally disabled until their
quote, transaction, and tracking flows are implemented end to end.

The product uses a curated top-token universe, transparent platform fees, and
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
- `lib/aggregators/lifi/routes.ts` loads chains/tokens, requests routes, and
  reads native/ERC-20 balances.
- `lib/routing/` owns quote keys, expiry, cancellation, normalization,
  deduplication, sorting, and execution preflight.
- `lib/amounts.ts` is the only user amount parser. It preserves precision with
  `BigInt` and rejects grouping separators, exponents, signs, non-finite values,
  and excess decimals.
- `lib/contractTokenResolver.ts` resolves custom EVM token metadata on the
  selected chain; never infer decimals or prices from a symbol alone.
- `lib/pricing.ts` looks up prices by `(chainId, tokenAddress)` and uses a dated
  USD/EUR reference rate.
- `components/SwapCard.tsx`, `TokenSelectModal.tsx`, and `RouteList.tsx` form
  the client-side swap UI.

## Required invariants

- A quote is executable only while its `quoteKey`, wallet, source chain, token
  addresses, amount, recipient, and expiry still match the form.
- Before signing, check the connected account, source network, source token
  balance, and native gas reserve. This applies to ERC-20 swaps as well as
  native-asset swaps.
- Pass LI.FI integer amounts as strings. Do not use floating-point arithmetic
  for token amounts.
- Keep the LI.FI execution provider EVM-only. Do not route a Rango or Socket
  object through `executeLifiRoute`.
- Preserve the user-visible minimum received amount, gas estimate, and platform
  fee; do not replace them with a hard-coded estimate.

## Environment

Copy `.env.example` to `.env.local` when needed:

- `NEXT_PUBLIC_LIFI_API_KEY` is optional and only changes LI.FI quota/auth.
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

The test suite covers strict amount parsing, stale/expired quotes, recipient
validation, account and chain changes, native gas/ERC-20 balances, token
metadata, EUR pricing, and token-modal chain switching.

## Deliberate limitations

- Rango, Socket, Solana, non-EVM wallets, live market-cap ranking, and backend
  orchestration are future work.
- LI.FI coverage, RPC availability, and route prices are external dependencies.
- Mainnet execution uses real funds; the UI must continue to show the actual
  route data and require an explicit wallet confirmation.

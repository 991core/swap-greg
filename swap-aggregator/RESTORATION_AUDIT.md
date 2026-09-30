# Feature restoration audit

Compared `design/cow-jumper` (`e3e55d6`) with `feat/hermes-oneclick` (`e2b0f9e`).
The earlier visual port retained the older application internals and omitted these features.

| Area | Restored behavior |
| --- | --- |
| Token discovery | Remote LI.FI name/symbol/address search, browse, 25/50/100/200 result limits, retry and cancellation; no top-symbol filter or default minimum-price restriction. |
| Token selection | Instant pinned popular catalog, exact identities and variants, native metadata, unverified-token consent and flagged-token blocking. |
| Search service | Validated server endpoint, bounded cache, request coalescing, timeouts and per-process quota; private API key stays server-side. |
| Routes | Exact output, minimum received, actual fee breakdown, source/destination addresses, duration, provider branding, preserved distinct route IDs and output sorting. |
| Quotes | 30-second expiry/refresh, failed/empty retries, hidden/offline pause, cancellation, parallel providers and partial results, selected-route identity and stale-wallet invalidation. |
| Execution | Current wallet/network, token metadata, amount, balances, gas and expiry checked before signing; form lock and progress display. |
| Rango | Quote/swap/status server adapter, rebuilt transaction validation, finite approvals, gas estimation, source receipt and destination tracking, resumable pending record. |
| Amounts and prices | Exact integer parsing and balance percentages, native gas reserve, address-based prices, dated USD/EUR rate and remembered currency. |
| Application | Lightweight wallet/SDK configuration, restored dependency lock, maintenance docs and regression suite. |

Retained additions: 1Click quote/deposit/status integration, anonymous previews, network search,
right-hand desktop routes, amount-preserving inversion and pinned popular-token continuity.
The 1Click registry no longer filters to top symbols. It supplements remote discovery but never
updates the continuity allowlist. No automatic catalog-maintenance service was added.

1Click uses the common slippage setting. The new execution adapter preserves confirmation and
tracking while adding live preflight and gas checks. Native source deposits remain unsupported.
Nonzero platform fees disable 1Click until its fee configuration is implemented.
Noncatalog execution still requires fresh recognized metadata, as on the restored design branch.

Validation: 203 automated tests, TypeScript, lint and production build. Browser checks use provider
fixtures; they do not sign transactions or prove live liquidity for every pair. Rango and 1Click
mainnet execution still require separate wallet-based manual validation.

# Token identity and signing security

External APIs supply untrusted information. The versioned local token registry is the authority for execution; the transaction validator is the final signature boundary. Selection, LI.FI verification badges, market ranking and consent checkboxes cannot approve an identity.

## Discovery and independent identity

`getTopAssets()` selects CoinGecko by default and CoinMarketCap as fallback, with 120 candidates and a target of 100. LI.FI supplies availability and routing, not market ranking. Display ranking requires a market provider match by exact chain/address. Provider IDs are namespaced; symbols never join providers. Ambiguous, bridged and wrapped contracts require separate reviewed bindings.

The selector puts the network's native asset first, followed by known market capitalizations in descending order, and displays them beside each token. It applies the market snapshot immediately without waiting for discovery on the other networks. Unknown capitalizations remain available afterwards; a failed market source is explicitly reported rather than replaced by an invented ranking. An exact search match can precede this default ordering.

The CoinGecko bulk platform map is fetched in parallel with market data; only its fixed `/api/v3/coins/list` endpoint has an 8 MiB response limit (the real map exceeded the previous 2 MiB limit). Other upstream responses retain the tighter bound. Missing exact LI.FI matches are enriched in a bounded background queue. Browser polling reads that cached enrichment and never signs. Native market bindings are display-only local mappings, not independent identity votes or registry approvals.

The canonical internal identity is `(chainId, address)`, with `type: native` and `address: null` for native assets. Zero-address provider sentinels are normalized; native ETH and WETH remain distinct. Discovery continues across all nine Hermes EVM networks and never authorizes onboarding.

Provider adapters use fixed hosts, bounded payloads, timeouts, cache/coalescing and quotas. Keys stay server-side. Without an explicit provider asset binding, a result is unavailable for independent voting. A LI.FI lookup of an address supplied by the caller is candidate-bound information, not a vote confirming that address independently.

`verifyTokenConsensus()` is pure. Three independent sources matching the registry verify it; two matching and one disagreeing produce an attributed warning and persistent conflict. Different addresses without a majority require review. A majority or unanimity proposing a different registry address blocks execution and records a critical contract-change event. Missing data does not vote. A previously reviewed local identity remains authoritative during provider outages only while there is no unresolved high/critical conflict; this never creates new registry entries.

A fresh flagged verdict is retained for its exact asset/network/address in the persistent journal. Later provider outages, positive verdicts and process restarts cannot clear it. Only a documented offline `resolve` revision approved after the flag, or a separately reviewed migration to another identity, can clear its applicability. A new negative observation after that review blocks again. Ambiguous identities, wrong IDs/native types and malformed or oversized identity responses fail closed rather than being treated as ordinary outages.

## Persistence and administration

There is no database in this MVP. The version-1 JSON seed `security/trusted-tokens.v1.json` contains only the 39 already reviewed catalog identities, sourced in `TOKEN_CATALOG.md`. Initial runtime bootstrap copies it into `.hermes-security/trusted-tokens.json` only when absent. Existing files are never replaced by discovery. Atomic writes, file locks and revision replay against the seed reject inconsistent history. No new on-chain addresses have been invented or approved by this change.

`TOKEN_REGISTRY_PATH` and `TOKEN_CONFLICT_LOG_PATH` select persistent storage; deploy on a durable volume. A shared database and shared quotas are needed for multiple hosts. The ignored runtime directory must be backed up separately.

Explicit administration is offline:

```bash
node scripts/token-registry.ts show
node scripts/token-registry.ts apply /absolute/path/approval.json
node scripts/token-registry.ts show-events --provider lifi --since 2026-10-01
node scripts/token-registry.ts metrics --provider lifi --since 2026-10-01
```

Approval JSON must contain `operation` (`onboard`, `migrate`, `disable`, `resolve`), `assetId`, `chainId`, `oldAddress`, `newAddress`, `reason`, `externalEvidence`, `approvedBy`, `approvedAt`, and `expectedVersion`. Onboarding/migration also supplies the reviewed `entry`, including address, decimals, native/ERC-20 type and explicit `providerAssetIds` if independently established. Version comparison prevents overwriting concurrent changes; the previous and next entries are retained in history. This is a local operator attestation, not a cryptographic approval service. Do not expose this CLI through an unauthenticated HTTP administration endpoint.

The audit store retains required token, quote and target events. Address conflicts are deduplicated by asset, chain, event type and provider/address set. Repeats update occurrence count and timestamps; changed values create another record. Full independent three-source agreement with the unchanged trusted registry resolves prior conflicts without deleting them. `TOKEN_CONFLICT_LOG_RETENTION` is an archive-policy hint; no automatic deletion occurs. Correlation IDs connect server validation failures. Diagnostic fields are bounded and allowlisted; provider keys, raw responses and arbitrary upstream error messages are excluded.

## Signature boundary

The browser calls `/api/security/validate` for the selected quote and before every transaction. The endpoint checks same-origin JSON input, bounded bodies, process quotas, fresh registry/configuration, independent identity observations, unresolved conflicts, and expiry after asynchronous work. If persistence, registry or validation fails, signing is blocked. These checks supplement existing wallet/account/chain, token balance and native gas checks.

After server authorization, every provider rechecks live token/native balances, estimates and gas fees before signing, followed by the final account/network/quote check. The server rechecks all selected identities against the journal and reads the registry again after its final asynchronous audit read. The browser requires a bounded JSON response with `authorized: true` and a valid registry version; an HTTP 200 alone is insufficient.

LI.FI executes with a newly guarded wallet transport, including SDK calls that rebuild calldata after preflight. Rango authorizes every allowance reset, finite approval and final swap; 1Click authorizes the final ERC-20 deposit. No adapter can execute without an authorizer. Account/chain and quote state are rechecked after authorization. Typed permits, raw signed transactions, batched/user-operation and unknown signing methods fail closed.

Allowlist entries bind **chain + address + provider + protocol**. `LIFI_ALLOWED_CONTRACTS` is the shared reviewed router policy despite its historical name; `ALLOWED_APPROVAL_TARGETS` independently restricts spenders, and `ALLOWED_DEPOSIT_RECEIVERS` restricts 1Click beneficiaries. They default to empty and therefore block all real signatures. Merely adding a router address is insufficient: its calldata needs supported reviewed semantics.

Current supported decoding: exact finite ERC-20 `approve` (plus zero reset), 1Click exact ERC-20 `transfer` to an explicitly reviewed deposit beneficiary, and canonical Uniswap V2 `swapExactTokensForTokens` for a two-token path on one chain. Amount, receiver, minimum, path tokens, native value and deadline are validated. Other routers, bridges, native swaps, multi-hop paths and unknown ABI selectors are blocked. General cross-chain execution needs reviewed protocol-specific validators before enablement. Quote previews and existing pending-transfer tracking remain available; tracking never signs or resends.

Example policy shape, with placeholders requiring actual independent review (do not paste as deployable configuration):

```json
[{"chainId":8453,"address":"<reviewed EVM address>","provider":"lifi","protocol":"<exact tool id>","abi":"uniswap_v2_swap_exact_tokens_v1"}]
```

## Verification and limitations

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Tests simulate compromised provider combinations, untrusted tokens, persistent conflicts, explicit administration and intercepted wallet calls. They do not prove the correctness of externally reviewed addresses, production RPC/provider uptime or real signed bridge settlement. No live wallet signing or use of funds is part of this implementation. Market and identity API coverage can be unavailable; the interface must not present unavailable evidence as verification.

Verification on 2026-10-02: TypeScript, ESLint, all 576 tests and the production build passed. A cold local universe request returned HTTP 200 in 0.718 seconds with CoinGecko ranking and no initial provider failure; exact ranked identities were present on all nine supported chains. Browser verification on Base showed ETH, USDC, LINK and USDS in descending market-cap order, with no captured console warnings/errors. These are read-only observations, not a qualification of signed execution or every browser.

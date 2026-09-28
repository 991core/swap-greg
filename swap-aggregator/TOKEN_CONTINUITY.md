# Token selection across networks

`lib/token-continuity.ts` preserves a selection only when source and destination
both match the local chain/address/decimal pins in `lib/token-icons.ts`, and the
asset is in the explicit popular-asset allowlist. Matching symbols alone, or the
routing layer's normalized `topSymbol`, never authorize a match.

The destination must also be present in the currently loaded provider catalog.
If missing, unrecognized, ambiguous, or unsupported, the network changes and the
user chooses a token in the picker. Dismissing it leaves the token unselected;
no native asset is silently substituted. Source amounts survive a recognized
match and are cleared when manual selection is required.

ETH/WETH, USDC/USDC.e, USDT/USDT0, DAI/xDAI, and different BTC wrappers remain
separate. Binance-pegged assets have separate identities. Coverage is restricted
to the app's listed EVM networks and existing pins; this does not assert that
all popular assets exist on every network.

## Maintenance

The initial pins are reused from the existing local design catalog. This change
does not add or independently certify new token contracts. Before adding a pin,
verify its chain, contract, decimals and representation against the issuer or
canonical bridge documentation. Review `assetFamily` when adding a bridged
representation, and add regression cases for source and destination spoofing.
An icon-only addition does not automatically add a new popular symbol.

Provider APIs supply availability and prices, not authority to modify these pins.
There is no scheduled update or automatic external-list import. Any future API
monitoring or periodic review system requires a separate decision.

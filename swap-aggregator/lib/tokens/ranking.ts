import { getCatalogToken } from "./catalog";
import type { AppToken } from "./types";
import { isKnownNativeToken, knownTokenMetric, tokenKey, tokenVerification } from "./validation";

function exactMatch(token: AppToken, query: string): number {
  if (!query) return 0;
  if (token.address.toLowerCase() === query) return 2;
  return token.symbol.toLowerCase() === query || token.name.toLowerCase() === query ? 1 : 0;
}

/** Stable display ordering. Unknown market data never means a zero capitalization. */
function sortResults(tokens: readonly AppToken[], query: string, sourceMatches?: Map<string, number>): AppToken[] {
  const text = query.trim().toLowerCase().replace(/ +/g, " ");
  return tokens.map((token, index) => ({ token, index })).sort((a, b) => {
    const match = (sourceMatches?.get(tokenKey(b.token)) ?? exactMatch(b.token, text))
      - (sourceMatches?.get(tokenKey(a.token)) ?? exactMatch(a.token, text));
    if (match) return match;
    const native = Number(isKnownNativeToken(b.token)) - Number(isKnownNativeToken(a.token));
    if (native) return native;
    const aKnown = Boolean(a.token.marketSource) && knownTokenMetric(a.token.marketCapUSD);
    const bKnown = Boolean(b.token.marketSource) && knownTokenMetric(b.token.marketCapUSD);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown && bKnown && a.token.marketCapUSD !== b.token.marketCapUSD) {
      return a.token.marketCapUSD! > b.token.marketCapUSD! ? -1 : 1;
    }
    return a.index - b.index;
  }).map(({ token }) => token);
}

export function sortTokenResults(tokens: readonly AppToken[], query = ""): AppToken[] {
  return sortResults(tokens, query);
}

/** Merge display sources by identity while preserving reviewed metadata and negative verdicts. */
export function rankTokenResults(local: AppToken[], remote: AppToken[], extra: AppToken[] = [], query = ""): AppToken[] {
  const grouped = new Map<string, AppToken[]>();
  const sourceMatches = new Map<string, number>();
  const text = query.trim().toLowerCase().replace(/ +/g, " ");
  for (const token of [...local, ...remote, ...extra]) {
    const key = tokenKey(token);
    const group = grouped.get(key);
    if (group) group.push(token);
    else grouped.set(key, [token]);
  }
  const merged = [...grouped.values()].map((group) => {
    const first = group[0];
    const pinned = getCatalogToken(first.chainId, first.address);
    const token: AppToken = { ...(pinned ?? first) };
    // Only local selection state can contain consent. Never import it from providers.
    if (!local.includes(first) || pinned) delete token.riskAcknowledged;
    delete token.marketCapUSD;
    delete token.marketSource;
    delete token.volumeUSD24H;
    // Address + network identify the asset. Symbol aliases (USDT/USDt, etc.)
    // must not drop market data attached to that same contract.
    const matching = group.filter(item => item.decimals === token.decimals);
    // A provider can use a different display name for a pinned identity. Keep
    // that exact-search match without replacing the catalog's name or symbol.
    sourceMatches.set(tokenKey(token), Math.max(exactMatch(token, text), ...matching.map(item => exactMatch(item, text))));
    for (const metric of ["marketCapUSD", "volumeUSD24H"] as const) {
      const observation = matching.find(item => Boolean(item.marketSource) && knownTokenMetric(item[metric]));
      if (observation) { token[metric] = observation[metric]; token.marketSource = observation.marketSource; }
    }
    // A bad verdict applies to the identity even if its other metadata disagrees.
    const restrictive = group.find(item => tokenVerification(item) === "flagged")
      ?? group.find(item => tokenVerification(item) === "unverified")
      ?? first;
    token.verificationStatus = tokenVerification(restrictive);
    token.verificationStatusBreakdown = restrictive.verificationStatusBreakdown?.map(item => ({ ...item }));
    return token;
  });
  return sortResults(merged, query, sourceMatches);
}

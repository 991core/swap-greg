import type { AppToken } from "@/lib/lifi";

export function getNativeAssetMeta(chainId: number) {
  switch (chainId) {
    case 1:
    case 8453:
    case 42161:
    case 10:
      return { symbol: "ETH", name: "Ether" };
    case 137:
      return { symbol: "POL", name: "Polygon" };
    case 56:
      return { symbol: "BNB", name: "BNB" };
    case 43114:
      return { symbol: "AVAX", name: "Avalanche" };
    default:
      return { symbol: "ETH", name: "Ether" };
  }
}

export function createTokenEntry(
  token: AppToken,
  chainId: number,
  overrides: Partial<AppToken> = {},
) {
  return {
    ...token,
    chainId,
    ...overrides,
  } as AppToken;
}

export function buildFallbackEntries(tokens: AppToken[], chainId: number) {
  return tokens
    .filter((token) => token.topSymbol && token.topSymbol !== "")
    .map((token) => createTokenEntry(token, chainId, { balanceUsd: 0, hasBalance: false }));
}

export function sortTokenEntries(tokens: AppToken[]) {
  return [...tokens].sort((a, b) => {
    if ((b.hasBalance ?? false) !== (a.hasBalance ?? false)) {
      return Number(b.hasBalance ?? false) - Number(a.hasBalance ?? false);
    }

    if ((b.balanceUsd ?? 0) !== (a.balanceUsd ?? 0)) {
      return (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0);
    }

    return (a.symbol?.toLowerCase() ?? "").localeCompare(b.symbol?.toLowerCase() ?? "");
  });
}

export function getTokenSearchTerms(token: AppToken) {
  const terms = [token.symbol, token.name, token.topSymbol]
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  if (token.address) {
    const shortAddr = token.address.length > 10 ? token.address.slice(0, 10) : token.address;
    terms.push(token.address.toLowerCase(), shortAddr.toLowerCase());
  }
  return terms;
}

export function tokenMatchesQuery(token: AppToken, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const terms = getTokenSearchTerms(token);
  return terms.some((term) => term.includes(q) || q.includes(term));
}

import { getChains, getRoutes, getTokens, getTokenBalances, ChainType, type ExtendedChain, type Route, type Token } from "@lifi/sdk";
import type { TokenAmount } from "@lifi/types";
import { APP_CHAINS, APP_CHAIN_IDS, isAppChainId } from "../../chains";
import { isTop20Symbol, normalizeToTopSymbol, topSymbolRank } from "../../topTokens";
import { formatTokenAmount } from "../../amounts";
import { MAX_PRICE_IMPACT, PLATFORM_FEE, ROUTE_TIMEOUT_MS, SLIPPAGE } from "../../routing/config";
import { getLifiSdkClient } from "./client";

export type SwapParams = {
  fromChainId: number; toChainId: number; fromTokenAddress: string;
  toTokenAddress: string; fromAmount: string; fromAddress: string;
};
export type AppToken = Token & { topSymbol: string; balance?: string; balanceUsd?: number; hasBalance?: boolean };
export type TokenBalanceEntry = { chainId: number; token: AppToken; balance: string; balanceUsd: number };

// On metadata failure only the chain's known native asset is offered, with no invented price.
export function buildKnownFallbackTokens(chainId: number): AppToken[] {
  const chain = APP_CHAINS.find((c) => c.id === chainId);
  if (!chain) return [];
  return [{ ...chain.nativeCurrency, chainId, address: "0x0000000000000000000000000000000000000000",
    priceUSD: "0", logoURI: "", topSymbol: chain.nativeCurrency.symbol.toUpperCase() } as AppToken];
}

export async function fetchSupportedChains(): Promise<ExtendedChain[]> {
  const chains = await getChains(getLifiSdkClient(), { chainTypes: [ChainType.EVM] }, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  return chains.filter((c) => isAppChainId(c.id)).sort((a, b) => APP_CHAIN_IDS.indexOf(a.id as typeof APP_CHAIN_IDS[number]) - APP_CHAIN_IDS.indexOf(b.id as typeof APP_CHAIN_IDS[number]));
}

export async function fetchTopTokensByChain(chainIds: number[]): Promise<Record<number, AppToken[]>> {
  const { tokens } = await getTokens(getLifiSdkClient(), { chains: chainIds }, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  return Object.fromEntries(chainIds.map((chainId) => {
    const bySymbol = new Map<string, AppToken>();
    for (const token of tokens[chainId] ?? []) {
      if (!isTop20Symbol(token.symbol)) continue;
      const topSymbol = normalizeToTopSymbol(token.symbol)!;
      const old = bySymbol.get(topSymbol);
      if (!old || (token.symbol.toUpperCase() === topSymbol && old.symbol.toUpperCase() !== topSymbol)) {
        bySymbol.set(topSymbol, { ...token, topSymbol });
      }
    }
    const list = [...bySymbol.values()].sort((a, b) => topSymbolRank(a.topSymbol) - topSymbolRank(b.topSymbol));
    return [chainId, list.length ? list : buildKnownFallbackTokens(chainId)];
  }));
}

export async function fetchWalletTokenBalances(walletAddress: string, knownTokensByChain: Record<number, AppToken[]> = {}): Promise<TokenBalanceEntry[]> {
  if (!walletAddress) return [];
  void knownTokensByChain;
  const balances = await getTokenBalances(getLifiSdkClient(), walletAddress, []) as TokenAmount[];
  return balances.map((token) => {
    const balance = formatTokenAmount(String(token.amount ?? "0"), token.decimals, token.decimals);
    const balanceUsd = Number(balance) * Number(token.priceUSD ?? 0);
    return { chainId: Number(token.chainId), token: { ...token, topSymbol: normalizeToTopSymbol(token.symbol) ?? token.symbol }, balance, balanceUsd };
  });
}

export async function fetchRoutes(params: SwapParams, signal?: AbortSignal): Promise<Route[]> {
  if (!isAppChainId(params.fromChainId) || !isAppChainId(params.toChainId)) throw new Error("Unsupported network.");
  const result = await getRoutes(getLifiSdkClient(), {
    ...params, toAddress: params.fromAddress,
    options: { fee: PLATFORM_FEE, slippage: SLIPPAGE, maxPriceImpact: MAX_PRICE_IMPACT },
  }, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ROUTE_TIMEOUT_MS)]) : AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  return result.routes ?? [];
}

import { getChains, getRoutes, ChainType, type ExtendedChain, type Route } from "@lifi/sdk";
import { APP_CHAINS, APP_CHAIN_IDS, isAppChainId } from "../../chains";
import type { AppToken } from "../../tokens/types";
import { NATIVE_ADDRESS } from "../../tokens/validation";
import { MAX_PRICE_IMPACT, PLATFORM_FEE, ROUTE_TIMEOUT_MS, SLIPPAGE } from "../../routing/config";
import { getLifiSdkClient } from "./client";

export type SwapParams = {
  fromChainId: number; toChainId: number; fromTokenAddress: string;
  toTokenAddress: string; fromAmount: string; fromAddress: string;
};
export type { AppToken } from "../../tokens/types";

// Native metadata comes from chain configuration. The interactive defaults use
// the broader reviewed catalog in lib/tokens/catalog.ts.
export function buildKnownFallbackTokens(chainId: number): AppToken[] {
  const chain = APP_CHAINS.find((c) => c.id === chainId);
  if (!chain) return [];
  return [{ ...chain.nativeCurrency, chainId, address: NATIVE_ADDRESS, priceUSD: "0" }];
}

export async function fetchSupportedChains(): Promise<ExtendedChain[]> {
  const chains = await getChains(getLifiSdkClient(), { chainTypes: [ChainType.EVM] }, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  return chains.filter((c) => isAppChainId(c.id)).sort((a, b) => APP_CHAIN_IDS.indexOf(a.id as typeof APP_CHAIN_IDS[number]) - APP_CHAIN_IDS.indexOf(b.id as typeof APP_CHAIN_IDS[number]));
}

export async function fetchRoutes(params: SwapParams, signal?: AbortSignal): Promise<Route[]> {
  if (!isAppChainId(params.fromChainId) || !isAppChainId(params.toChainId)) throw new Error("Unsupported network.");
  const result = await getRoutes(getLifiSdkClient(), {
    ...params, toAddress: params.fromAddress,
    options: { fee: PLATFORM_FEE, slippage: SLIPPAGE, maxPriceImpact: MAX_PRICE_IMPACT },
  }, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ROUTE_TIMEOUT_MS)]) : AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
  return result.routes ?? [];
}

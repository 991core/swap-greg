import type { AppToken } from "../lifi/routes";
import type { RouteSelectionParams } from "../../routing/orchestrator";
import type { NormalizedRoute } from "../../types/normalized-route";
import { isTop20Symbol, normalizeToTopSymbol } from "../../topTokens";

const CHAINS: Record<number, string> = {
  1: "eth", 8453: "base", 42161: "arb", 10: "op", 137: "pol",
  56: "bsc", 43114: "avax", 100: "gnosis",
};

type Token = { assetId: string; blockchain: string; contractAddress: string; decimals: number; symbol: string };

export async function fetchOneClickTokens(): Promise<Record<number, AppToken[]>> {
  const response = await fetch("/api/oneclick/tokens");
  if (!response.ok) throw new Error("1Click token registry unavailable");
  const tokens = await response.json() as Token[];
  const result: Record<number, AppToken[]> = {};
  for (const token of tokens) {
    const chainId = Number(Object.keys(CHAINS).find((id) => CHAINS[Number(id)] === token.blockchain));
    const eure = token.blockchain === "gnosis" && token.symbol === "EURe";
    const topSymbol = eure ? "EURe" : normalizeToTopSymbol(token.symbol);
    if (!chainId || !topSymbol || (!isTop20Symbol(token.symbol) && !eure)) continue;
    (result[chainId] ??= []).push({
      chainId,
      address: token.contractAddress,
      decimals: token.decimals,
      symbol: token.symbol,
      topSymbol,
      name: `1Click · ${token.contractAddress.slice(0, 8)}…${token.contractAddress.slice(-4)}`,
      logoURI: "",
      priceUSD: "0",
    } as AppToken);
  }
  return result;
}

export type OneClickQuote = {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  timeEstimate: number;
  depositAddress?: string;
  deadline?: string;
};

export async function fetchOneClickQuote(params: RouteSelectionParams, dry: boolean): Promise<OneClickQuote> {
  if (!dry && !params.fromAddress) throw new Error("Connect a wallet before requesting an executable quote.");
  const response = await fetch("/api/oneclick/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      fromAmount: params.fromAmount,
      fromTokenDecimals: params.fromTokenDecimals,
      toTokenDecimals: params.toTokenDecimals,
      wallet: params.fromAddress,
      dry,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `1Click HTTP ${response.status}`);
  return result as OneClickQuote;
}

export async function fetchOneClickRoute(params: RouteSelectionParams): Promise<NormalizedRoute[]> {
  if (!CHAINS[params.fromChainId] || !CHAINS[params.toChainId] ||
      !/^0x[0-9a-fA-F]{40}$/.test(params.fromTokenAddress) ||
      !/^0x[0-9a-fA-F]{40}$/.test(params.toTokenAddress)) return [];
  try {
    const quote = await fetchOneClickQuote(params, true);
    return [{
      id: `oneclick:${params.fromChainId}:${params.toChainId}:${params.fromTokenAddress}:${params.toTokenAddress}:${params.fromAmount}`,
      provider: "oneclick",
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      fromAmount: params.fromAmount,
      toAmount: quote.amountOut,
      toolLabel: "1Click · NEAR Intents",
      durationSeconds: quote.timeEstimate,
      raw: { minAmountOut: quote.minAmountOut },
    }];
  } catch {
    return [];
  }
}

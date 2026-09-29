import type { AppToken } from "../../tokens/types";
import { validateToken } from "../../tokens/validation";
import type { RouteSelectionParams } from "../../routing/orchestrator";
import type { OneClickNormalizedRoute } from "../../types/normalized-route";
import { QUOTE_TTL_MS, ROUTE_TIMEOUT_MS } from "../../routing/config";
const CHAINS: Record<number, string> = { 1: "eth", 8453: "base", 42161: "arb", 10: "op", 137: "pol", 56: "bsc", 43114: "avax", 100: "gnosis" };
type Token = { assetId: string; blockchain: string; contractAddress: string; decimals: number; symbol: string };
export async function fetchOneClickTokens(signal?: AbortSignal): Promise<Record<number, AppToken[]>> {
  const response = await fetch("/api/oneclick/tokens", { signal });
  if (!response.ok) throw new Error("1Click token registry unavailable");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid 1Click registry");
  const result: Record<number, AppToken[]> = {};
  for (const token of data as Token[]) {
    const chainId = Number(Object.keys(CHAINS).find((id) => CHAINS[Number(id)] === token.blockchain));
    const validated = validateToken({ chainId, address: token.contractAddress, decimals: token.decimals,
      symbol: token.symbol, name: token.symbol, priceUSD: "0" }, chainId);
    if (validated) (result[chainId] ??= []).push(validated);
  }
  return result;
}
export type OneClickQuote = { amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number; depositAddress?: string; deadline?: string };
export async function fetchOneClickQuote(params: RouteSelectionParams, dry: boolean, signal?: AbortSignal): Promise<OneClickQuote> {
  if (!dry && !params.fromAddress) throw new Error("Connect a wallet before requesting an executable quote.");
  const response = await fetch("/api/oneclick/quote", {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ROUTE_TIMEOUT_MS)]) : AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    body: JSON.stringify({ fromChainId: params.fromChainId, toChainId: params.toChainId,
      fromTokenAddress: params.fromTokenAddress, toTokenAddress: params.toTokenAddress, fromAmount: params.fromAmount,
      fromTokenDecimals: params.fromTokenDecimals, toTokenDecimals: params.toTokenDecimals, wallet: params.fromAddress || undefined, dry }),
  });
  const quote = await response.json();
  if (!response.ok) throw new Error(quote.error ?? `1Click HTTP ${response.status}`);
  if (quote.amountIn !== params.fromAmount || !/^[1-9]\d*$/.test(quote.amountOut) || !/^[1-9]\d*$/.test(quote.minAmountOut) ||
      BigInt(quote.minAmountOut) > BigInt(quote.amountOut) || !Number.isFinite(quote.timeEstimate) || quote.timeEstimate < 0) throw new Error("Invalid 1Click quote");
  return quote;
}
export async function fetchOneClickRoute(params: RouteSelectionParams, signal?: AbortSignal): Promise<OneClickNormalizedRoute[]> {
  if (!CHAINS[params.fromChainId] || !CHAINS[params.toChainId] || !params.fromToken || !params.toToken ||
      !/^0x[0-9a-fA-F]{40}$/.test(params.fromTokenAddress) || /^0x0{40}$/i.test(params.fromTokenAddress) ||
      !/^0x[0-9a-fA-F]{40}$/.test(params.toTokenAddress)) return [];
  const quote = await fetchOneClickQuote(params, true, signal);
  return [{ ...params, id: `oneclick:${params.fromChainId}:${params.toChainId}:${params.fromTokenAddress}:${params.toTokenAddress}:${params.fromAmount}`,
    provider: "oneclick", toAmount: quote.amountOut, toAmountMin: quote.minAmountOut, gasCostUSD: null,
    toolLabel: "1Click · NEAR Intents", durationSeconds: quote.timeEstimate, expiresAt: Date.now() + QUOTE_TTL_MS,
    raw: { minAmountOut: quote.minAmountOut, fromToken: params.fromToken, toToken: params.toToken } }];
}

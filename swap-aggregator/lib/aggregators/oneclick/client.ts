import type { AppToken } from "../../tokens/types";
import { validateToken } from "../../tokens/validation";
import type { RouteSelectionParams } from "../../routing/orchestrator";
import type { OneClickNormalizedRoute } from "../../types/normalized-route";
import { QUOTE_TTL_MS, ROUTE_TIMEOUT_MS, SLIPPAGE } from "../../routing/config";
import { isOneClickTokenEvidence, ONECLICK_CHAINS, validateOneClickQuoteResponse, type OneClickQuoteResponse, type OneClickQuoteRequest, type OneClickTokenEvidence } from "./validation";
export const ONECLICK_CHAIN_NAMES = ONECLICK_CHAINS;
type Token = { assetId: string; blockchain: string; contractAddress: string; decimals: number; symbol: string };
export async function fetchOneClickTokens(signal?: AbortSignal): Promise<Record<number, AppToken[]>> {
  const response = await fetch("/api/oneclick/tokens", { signal });
  if (!response.ok) throw new Error("1Click token registry unavailable");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid 1Click registry");
  const result: Record<number, AppToken[]> = {};
  for (const token of data as Token[]) {
    const chainId = Number(Object.keys(ONECLICK_CHAIN_NAMES).find((id) => ONECLICK_CHAIN_NAMES[Number(id)] === token.blockchain));
    const validated = validateToken({ chainId, address: token.contractAddress, decimals: token.decimals,
      symbol: token.symbol, name: token.symbol, priceUSD: "0" }, chainId);
    if (validated) (result[chainId] ??= []).push(validated);
  }
  return result;
}
export type OneClickQuote = { amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number; depositAddress?: string; deadline?: string;
  quoteResponse: OneClickQuoteResponse; originToken: OneClickTokenEvidence; destinationToken: OneClickTokenEvidence };

export function validateOneClickTokenBinding(value: unknown, chainId: number, address: string, decimals: number | undefined): OneClickTokenEvidence {
  if (!isOneClickTokenEvidence(value)) throw new Error("Invalid 1Click asset evidence");
  const token = value;
  if (!ONECLICK_CHAIN_NAMES[chainId] || token.blockchain !== ONECLICK_CHAIN_NAMES[chainId] ||
      token.contractAddress.toLowerCase() !== address.toLowerCase() || token.decimals !== decimals) throw new Error("Invalid 1Click asset evidence");
  return token;
}

export function validateOneClickBoundQuote(value: unknown, params: RouteSelectionParams, dry: boolean): OneClickQuote {
  if (!value || typeof value !== "object") throw new Error("Invalid 1Click quote");
  const dto = value as OneClickQuote;
  const origin = validateOneClickTokenBinding(dto.originToken, params.fromChainId, params.fromTokenAddress, params.fromTokenDecimals);
  const destination = validateOneClickTokenBinding(dto.destinationToken, params.toChainId, params.toTokenAddress, params.toTokenDecimals);
  const deadline = dto.quoteResponse?.quoteRequest?.deadline;
  const now = Date.now();
  if (typeof deadline !== "string" || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= now + 30_000 ||
      Date.parse(deadline) > now + 20 * 60_000 + 5_000) throw new Error("Invalid or expired 1Click deposit instructions.");
  const expected: OneClickQuoteRequest = { dry, swapType: "EXACT_INPUT", slippageTolerance: Math.round(SLIPPAGE * 10_000),
    originAsset: origin.assetId, destinationAsset: destination.assetId, amount: params.fromAmount,
    depositType: "ORIGIN_CHAIN", refundTo: params.fromAddress || "0x0000000000000000000000000000000000000000",
    refundType: "ORIGIN_CHAIN", recipient: params.fromAddress || "0x0000000000000000000000000000000000000000",
    recipientType: "DESTINATION_CHAIN", deadline, depositMode: "SIMPLE" };
  const proof = validateOneClickQuoteResponse(dto.quoteResponse, expected, now);
  const quote = proof.quote;
  if (dto.amountIn !== quote.amountIn || dto.amountOut !== quote.amountOut || dto.minAmountOut !== quote.minAmountOut ||
      dto.timeEstimate !== quote.timeEstimate || (!dry && (dto.depositAddress !== quote.depositAddress || dto.deadline !== quote.deadline)) ||
      (dry && (dto.depositAddress !== undefined || dto.deadline !== undefined))) throw new Error("Invalid 1Click quote");
  return { ...dto, quoteResponse: proof, originToken: origin, destinationToken: destination };
}
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
  if (!response.ok) throw Object.assign(new Error(quote.error ?? `1Click HTTP ${response.status}`), { status: response.status });
  return validateOneClickBoundQuote(quote, params, dry);
}
export async function fetchOneClickRoute(params: RouteSelectionParams, signal?: AbortSignal): Promise<OneClickNormalizedRoute[]> {
  if (!ONECLICK_CHAIN_NAMES[params.fromChainId] || !ONECLICK_CHAIN_NAMES[params.toChainId] || !params.fromToken || !params.toToken ||
      !/^0x[0-9a-fA-F]{40}$/.test(params.fromTokenAddress) || /^0x0{40}$/i.test(params.fromTokenAddress) ||
      !/^0x[0-9a-fA-F]{40}$/.test(params.toTokenAddress)) return [];
  const quote = await fetchOneClickQuote(params, true, signal);
  return [{ ...params, id: `oneclick:${params.fromChainId}:${params.toChainId}:${params.fromTokenAddress}:${params.toTokenAddress}:${params.fromAmount}`,
    provider: "oneclick", toAmount: quote.amountOut, toAmountMin: quote.minAmountOut, gasCostUSD: null,
    toolLabel: "1Click · NEAR Intents", durationSeconds: quote.timeEstimate, expiresAt: Date.now() + QUOTE_TTL_MS,
    raw: { minAmountOut: quote.minAmountOut, fromToken: params.fromToken, toToken: params.toToken } }];
}

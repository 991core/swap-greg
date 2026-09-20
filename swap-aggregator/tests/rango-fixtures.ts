import { encodeFunctionData, erc20Abi } from "viem";
import type { RangoQuote, RangoSwap, RangoToken, RangoPending } from "../lib/aggregators/rango/types";
import { normalizeRangoQuote } from "../lib/aggregators/rango/routes";
import { params, wallet } from "./fixtures";

export const requestId = "11111111-1111-4111-8111-111111111111";
export const router = "0x3333333333333333333333333333333333333333";
export const hash = `0x${"a".repeat(64)}` as const;
export const rangoFrom: RangoToken = { blockchain: "BASE", chainId: "8453", address: null, symbol: "ETH", name: "Ether", decimals: 18, usdPrice: 2500 };
export const rangoTo: RangoToken = { ...rangoFrom, blockchain: "ETH", chainId: "1" };
export function rangoQuote(): RangoQuote & { route: NonNullable<RangoQuote["route"]> } {
  return { requestId, resultType: "OK", error: null, route: {
    from: { ...rangoFrom }, to: { ...rangoTo }, outputAmount: "950000000000000", outputAmountMin: "940000000000000",
    swapper: { id: "Bridge", title: "Bridge", enabled: true, types: ["BRIDGE"] }, estimatedTimeInSeconds: 40,
    fee: [{ name: "Network Fee", token: { ...rangoFrom }, amount: "300000", expenseType: "FROM_SOURCE_WALLET" },
      { name: "Rango Fee", token: { ...rangoFrom }, amount: "100000", expenseType: "DECREASE_FROM_OUTPUT" }],
  } };
}
export function rangoSwap(): RangoSwap {
  return { ...rangoQuote(), tx: { type: "EVM", blockChain: { name: "BASE", chainId: "0x2105" }, from: wallet,
    txTo: router, txData: "0x12345678", value: params.fromAmount, approveTo: null, approveData: null } };
}
export function normalizedRango() { return normalizeRangoQuote(rangoQuote(), params); }
export function tokenSwap() {
  const token = { blockchain: "BASE", chainId: "8453", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, usdPrice: 1 };
  const input = { ...params, fromAmount: "1000000", fromTokenAddress: token.address };
  const data = rangoSwap(); data.route!.from = token; data.tx!.value = "0";
  data.tx!.approveTo = token.address; data.tx!.approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, BigInt(input.fromAmount)] });
  return { input, data, route: normalizeRangoQuote(data, input) };
}
export function pendingRango(): RangoPending { return { provider: "rango", requestId, txHash: hash, account: wallet, chainId: 8453, toToken: rangoTo, minimum: "940000000000000" }; }

import { QUOTE_TTL_MS } from "../lib/routing/config";
import type { Route } from "@lifi/sdk";
import type { AppToken, SwapParams } from "../lib/aggregators/lifi/routes";
import type { LifiNormalizedRoute } from "../lib/types/normalized-route";
export const wallet = "0x1111111111111111111111111111111111111111";
export const native = "0x0000000000000000000000000000000000000000";
export const fromToken: AppToken = { address: native, chainId: 8453, decimals: 18, symbol: "ETH", name: "Ether", priceUSD: "2500", verificationStatus: "verified" };
export const toToken: AppToken = { ...fromToken, chainId: 1 };
export const params: SwapParams = { fromChainId: 8453, toChainId: 1, fromTokenAddress: native, toTokenAddress: native, fromAmount: "1000000000000000", fromAddress: wallet };
export function rawRoute(id = "quote-a"): Route {
  return { id, fromChainId: 8453, toChainId: 1, fromToken, toToken, fromAddress: wallet, toAddress: wallet, fromAmount: params.fromAmount, fromAmountUSD: "2.5", toAmount: "900000000000000", toAmountMin: "895500000000000", toAmountUSD: "2.25", gasCostUSD: "0.02", insurance: { state: "NOT_INSURABLE", feeAmountUsd: "0" },
    steps: [{ id: "step-a", type: "lifi", tool: "bridge", toolDetails: { key: "bridge", name: "Bridge", logoURI: "" }, includedSteps: [], action: { ...params, fromToken, toToken, toAddress: wallet }, estimate: { tool: "bridge", fromAmount: params.fromAmount, toAmount: "900000000000000", toAmountMin: "895500000000000", approvalAddress: native, executionDuration: 30, gasCosts: [{ type: "SEND", price: "1", estimate: "21000", limit: "25000", amount: "21000", amountUSD: "0.02", token: fromToken }] } }],
  } as unknown as Route;
}
export function quote(id = "lifi:quote-a"): LifiNormalizedRoute {
  return { ...params, id, provider: "lifi", toAmount: "900000000000000", toAmountMin: "895500000000000", gasCostUSD: "0.02", durationSeconds: 30, toolLabel: "Bridge", raw: rawRoute(id.replace("lifi:", "")), expiresAt: Date.now() + QUOTE_TTL_MS };
}

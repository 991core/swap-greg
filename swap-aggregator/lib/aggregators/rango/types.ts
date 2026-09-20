import type { SwapParams } from "../lifi/routes";

export type RangoToken = { blockchain: string; chainId: string; address: string | null; symbol: string; name: string | null; decimals: number; usdPrice: number | null };
export type RangoFee = { name: string; token: RangoToken; expenseType: "FROM_SOURCE_WALLET" | "DECREASE_FROM_OUTPUT" | "FROM_DESTINATION_WALLET"; amount: string; meta?: { type: string; gasLimit: string; gasPrice: string } | null };
export type RangoRoute = {
  from: RangoToken; to: RangoToken; outputAmount: string; outputAmountMin: string;
  swapper: { id: string; title: string; enabled: boolean; types: string[] };
  fee: RangoFee[]; estimatedTimeInSeconds: number;
};
export type RangoQuote = { requestId: string; resultType: string; route: RangoRoute | null; error: string | null };
export type RangoPayload = { quote: RangoQuote & { route: RangoRoute }; params: SwapParams };
export type RangoTransaction = {
  type: "EVM"; blockChain: { name: string; chainId: string }; from: string | null;
  txTo: string; txData: string | null; value: string;
  approveTo: string | null; approveData: string | null;
};
export type RangoSwap = RangoQuote & { tx: RangoTransaction | null };
export type RangoStatus = { status: "running" | "success" | "failed" | null; error: string | null;
  output: { type: string; amount: string; receivedToken: RangoToken } | null };
export type RangoPending = { provider: "rango"; requestId: string; txHash: `0x${string}`; chainId: number;
  account: string; toToken: RangoToken; minimum: string };
export type RangoExecution = RangoPending & { status: "success" | "failed" | "pending"; message?: string };
export type RangoProgress = { stage: "preparing" | "approval" | "signing" | "tracking" | "complete" | "failed"; txHash?: string; txLink?: string; pending?: RangoPending };

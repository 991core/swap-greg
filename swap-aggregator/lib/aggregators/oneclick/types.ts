import type { Address } from "viem";
import type { OneClickQuote } from "./client";
export type PendingOneClick = { wallet: Address; fromChainId: number; depositAddress: Address; hash: `0x${string}`; status: string; destinationUrl?: string };
export const PENDING_ONECLICK_KEY = "hermes:oneclick:latest";
export type OneClickExecutionOptions = { confirm: (quote: OneClickQuote) => boolean; onPending: (pending: PendingOneClick) => void };

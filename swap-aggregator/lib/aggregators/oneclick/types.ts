import type { Address } from "viem";
import type { OneClickQuote } from "./client";
import type { OneClickQuoteResponse, OneClickTokenEvidence } from "./validation";

export type OneClickPendingStatus = "UNKNOWN" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "FAILED";
type PendingBase = {
  wallet: Address;
  fromChainId: number;
  depositAddress: Address;
  hash?: `0x${string}`;
  status: OneClickPendingStatus;
  destinationUrl?: string;
};
// Old records cannot establish delivery; retain their hash and block resubmission.
export type LegacyPendingOneClick = PendingBase & { version: 0; hash: `0x${string}`; status: "UNKNOWN" };
export type PendingOneClickV1 = PendingBase & {
  version: 1;
  toChainId: number;
  fromTokenAddress: Address;
  toTokenAddress: Address;
  fromTokenDecimals: number;
  toTokenDecimals: number;
  originToken: OneClickTokenEvidence;
  destinationToken: OneClickTokenEvidence;
  amount: string;
  minimum: string;
  quoteResponse: OneClickQuoteResponse;
  submittedAt: number;
  sourceOutcome?: "rejected" | "reverted";
  delivery?: unknown;
};
export type PendingOneClick = PendingOneClickV1 | LegacyPendingOneClick;
export const PENDING_ONECLICK_KEY = "hermes:oneclick:latest";
// The intention callback runs before the wallet call; throwing prevents signing.
export type OneClickExecutionOptions = { confirm: (quote: OneClickQuote) => boolean; onPending: (pending: PendingOneClick) => void };

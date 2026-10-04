import type { Route } from "@lifi/sdk";
import type { RangoPayload } from "../aggregators/rango/types";
export type ProviderName = "lifi" | "socket" | "rango" | "oneclick";
export type ProviderSelection = Record<Exclude<ProviderName, "oneclick">, boolean> & { oneclick?: boolean };
type RouteBase = {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAddress: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  gasCostUSD: string | null;
  toolLabel: string;
  durationSeconds: number;
  expiresAt: number;
};
export type LifiNormalizedRoute = RouteBase & { provider: "lifi"; raw: Route };
export type RangoNormalizedRoute = RouteBase & { provider: "rango"; raw: RangoPayload };
export type OneClickNormalizedRoute = RouteBase & { provider: "oneclick"; raw: {
  fromToken: import("../tokens/types").AppToken; toToken: import("../tokens/types").AppToken; minAmountOut: string;
} };
export type NormalizedRoute = LifiNormalizedRoute | RangoNormalizedRoute | OneClickNormalizedRoute;

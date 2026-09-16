import { createClient, type ExtendedChain, type Route, type Token } from "@lifi/sdk";
import { SolanaProvider } from "@lifi/sdk-provider-solana";
import { TronProvider } from "@lifi/sdk-provider-tron";
import type { WalletClient } from "viem";

export const lifiClient = createClient({
  integrator: "hermes-hms",
  apiKey: process.env.LIFI_API_KEY || process.env.NEXT_PUBLIC_LIFI_API_KEY || undefined,
  providers: [SolanaProvider(), TronProvider()],
});

let activeWalletClient: WalletClient | null = null;

export function setLifiWalletClient(walletClient: WalletClient | null) {
  activeWalletClient = walletClient;
}

export function getLifiSdkClient() {
  return lifiClient;
}

export function getActiveWalletClient() {
  return activeWalletClient;
}

export type LifiRoute = Route;
export type LifiToken = Token;
export type LifiExtendedChain = ExtendedChain;

import {
  arbitrum,
  avalanche,
  base,
  bsc,
  gnosis,
  mainnet,
  metis,
  optimism,
  polygon,
  tron,
} from "viem/chains";

/** Chains with LI.FI coverage for top-20 market-cap tokens. Solana/Tron are non-EVM. */
export const APP_CHAINS = [
  base,
  mainnet,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  gnosis,
  metis,
  tron,
] as const;

export const APP_CHAIN_IDS = APP_CHAINS.map((c) => c.id);

export type AppChainId = (typeof APP_CHAIN_IDS)[number];

export const CHAIN_LABELS: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum",
  [optimism.id]: "Optimism",
  [polygon.id]: "Polygon",
  [bsc.id]: "BNB Chain",
  [avalanche.id]: "Avalanche",
  [gnosis.id]: "Gnosis",
  [metis.id]: "Metis",
  [tron.id]: "Tron",
};

export function isAppChainId(id: number): id is AppChainId {
  return APP_CHAIN_IDS.includes(id as AppChainId);
}

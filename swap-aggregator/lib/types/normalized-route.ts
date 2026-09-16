export type ProviderName = "lifi" | "socket" | "rango";

export type ProviderSelection = Record<ProviderName, boolean>;

export type NormalizedRoute = {
  id: string;
  provider: ProviderName;
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  toAmount: string;
  toolLabel: string;
  durationSeconds: number;
  raw?: unknown;
};

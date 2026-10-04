export const TOKEN_PROVIDERS = ["coingecko", "coinmarketcap", "lifi"] as const;
export type TokenProvider = typeof TOKEN_PROVIDERS[number];
export type VerificationStatus = "verified" | "verified_with_warning" | "manual_review" | "blocked";
export type TokenSourceResult = {
  provider: TokenProvider;
  providerAssetId?: string;
  assetId?: string;
  chainId: number;
  tokenType: "native" | "contract";
  address: string | null;
  decimals?: number;
  symbol?: string;
  fetchedAt: string;
  lookupMode?: "asset-id" | "candidate-bound" | "local-binding";
};
export type TokenProviderUnavailable = { provider: TokenProvider; chainId: number; reason: string };
export type TrustedTokenEntry = {
  assetId: string;
  chainId: number;
  type: "native" | "erc20";
  address: string | null;
  decimals: number;
  symbol: string;
  name?: string;
  status: "trusted" | "disabled" | "pending_migration";
  providerAssetIds?: Partial<Record<TokenProvider, string>>;
  consensusSources: string[];
  firstVerifiedAt: string;
  lastVerifiedAt: string;
  version: number;
};
export type TrustedTokenRegistryEntry = TrustedTokenEntry;
export type RegistryApproval = {
  operation: "onboard" | "migrate" | "disable" | "resolve";
  assetId: string;
  chainId: number;
  oldAddress: string | null;
  newAddress: string | null;
  reason: string;
  externalEvidence: string[];
  approvedBy: string;
  approvedAt: string;
  expectedVersion: number;
  entry?: TrustedTokenEntry;
};
export type RegistryRevision = Omit<RegistryApproval, "entry" | "expectedVersion"> & {
  version: number;
  previousEntry: TrustedTokenEntry | null;
  nextEntry: TrustedTokenEntry;
};
export type TrustedRegistryDocument = {
  schemaVersion: 1;
  version: number;
  entries: TrustedTokenEntry[];
  history: RegistryRevision[];
};
export const SECURITY_EVENT_TYPES = [
  "TOKEN_ADDRESS_CONFLICT", "TOKEN_CONTRACT_CHANGED", "TOKEN_PROVIDER_UNAVAILABLE", "TOKEN_NOT_IN_REGISTRY",
  "UNKNOWN_APPROVAL_TARGET", "UNKNOWN_TRANSACTION_TARGET", "QUOTE_TOKEN_MISMATCH", "QUOTE_CHAIN_MISMATCH",
  "QUOTE_RECEIVER_MISMATCH", "QUOTE_VALIDATION_FAILED", "TOKEN_CONSENSUS_RESTORED",
] as const;
export type SecurityEventType = typeof SECURITY_EVENT_TYPES[number];
export type SecurityEvent = {
  event: SecurityEventType;
  assetId: string;
  chainId: number;
  symbol?: string;
  registryAddress?: string | null;
  providers?: Partial<Record<TokenProvider, { address: string | null; fetchedAt: string; independent?: boolean }>>;
  consensusAddress?: string | null;
  oldAddress?: string | null;
  newAddress?: string | null;
  divergentProviders?: TokenProvider[];
  severity: "warning" | "high" | "critical";
  action: "allowed_with_warning" | "manual_review" | "blocked";
  detectedAt: string;
  correlationId?: string;
  details?: Record<string, string | number | boolean | null>;
};
export type TokenAddressConflictLog = SecurityEvent & {
  event: "TOKEN_ADDRESS_CONFLICT" | "TOKEN_CONTRACT_CHANGED";
  conflictId: string;
  deduplicationKey: string;
  status: "open" | "resolved";
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  resolvedAt?: string;
  resolution?: "provider_returned_to_consensus" | "manual_review";
};
export type StoredSecurityEvent = SecurityEvent & { eventId: string };
export type SecurityEventDocument = {
  schemaVersion: 1;
  version: number;
  conflicts: TokenAddressConflictLog[];
  events: StoredSecurityEvent[];
};
export type TokenConsensusInput = {
  assetId: string;
  chainId: number;
  registryEntry?: TrustedTokenEntry | null;
  results: TokenSourceResult[];
  unavailable?: TokenProviderUnavailable[];
  requiredSources?: number;
  detectedAt?: string;
  correlationId?: string;
};
export type TokenConsensusResult = {
  status: VerificationStatus;
  consensusAddress: string | null | undefined;
  divergentProviders: TokenProvider[];
  events: SecurityEvent[];
};

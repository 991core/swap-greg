/** Quote-only research contracts. No wallet signer or transaction submission. */
export interface Asset {
  chainId: number;
  address: string;
  decimals: number;
  symbol?: string;
}

export interface QuoteRequest {
  from: Asset;
  to: Asset;
  amount: string;
  wallet: string;
  slippageBps: number;
}

export interface Quote {
  id: string;
  provider: string;
  from: Asset;
  to: Asset;
  amountIn: string;
  amountOut: string;
  /** Applies to this leg and its exact input, not to a composed route. */
  minimumOut: string | null;
  quotedAt: number;
  expiresAt: number;
  /** An estimate paid in addition to amountIn. Embedded fees stay in amountOut. */
  externalCostUsd: string | null;
  /** Empty only when the adapter can account for every external cost. */
  missingCosts: string[];
  durationSeconds: number | null;
  warnings: string[];
  /** Informational breakdown; included fees are already reflected in amountOut. */
  fees?: QuoteFee[];
  gasEstimates?: GasEstimate[];
  gasAccounting?: "transactions" | "provider_summary";
}

export interface QuoteFee {
  name: string;
  amountRaw: string | null;
  amountUsd: string | null;
  token?: Asset;
  included: boolean | null;
  recipients: Array<{ name: string; amountRaw: string }>;
}

export interface GasEstimate {
  step: string;
  chainId: number;
  gas: string;
  priceWei: string;
  basis: "gas_times_max_fee" | "gas_times_gas_price";
  amountRaw: string;
  amountUsd: string;
}

export interface QuoteContext {
  signal: AbortSignal;
  now: () => number;
}

export interface QuoteProvider {
  id: string;
  supports: (from: Asset, to: Asset) => boolean;
  quote: (request: QuoteRequest, context: QuoteContext) => Promise<Quote[]>;
}

export interface Valuation {
  /** One shared snapshot for the exact destination token across all providers. */
  usdPerToken: string;
  observedAt: number;
  expiresAt: number;
  source: string;
}

export interface SearchOptions {
  pivots: Asset[];
  maxLegs?: number;
  maxRequests?: number;
  concurrency?: number;
  beamWidthPerAsset?: number;
  maxQuotesPerRequest?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  maxQuoteAgeMs?: number;
  maxQuoteSkewMs?: number;
  valuation?: Valuation;
  signal?: AbortSignal;
  now?: () => number;
}

export interface CandidateRoute {
  id: string;
  kind: "provider" | "composed";
  legs: Quote[];
  amountOut: string;
  reportedExternalCostUsd: string | null;
  netAfterReportedCosts: string | null;
  /** No global minimum is asserted for sequential, independently quoted legs. */
  globalMinimumOut: null;
  conditionalLastLegMinimum: string | null;
  economics: "QUOTE_ESTIMATE" | "INCOMPLETE_COSTS" | "NO_VALUATION" | "STALE";
  execution: "NOT_VALIDATED";
  warnings: string[];
}

export interface Diagnostic {
  provider: string;
  from: string;
  to: string;
  amount: string;
  status: "ok" | "no_route" | "error" | "invalid_quote";
  detail: string;
}

export interface SearchReport {
  schemaVersion: 1;
  request: QuoteRequest;
  startedAt: number;
  finishedAt: number;
  routes: CandidateRoute[];
  diagnostics: Diagnostic[];
  requestsMade: number;
  cacheHits: number;
  truncated: boolean;
  stopReasons: string[];
  pivotCoverage: Array<{
    asset: Asset;
    reached: boolean;
    targetAttempts: number;
    targetSuccesses: number;
  }>;
  comparison: {
    status: "QUOTED_ONLY" | "UNRESOLVED";
    baselineId: string | null;
    candidateId: string | null;
    gainRaw: string | null;
    reason: string;
  };
  assumptions: string[];
}

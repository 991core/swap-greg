import { isAddress, zeroAddress } from "viem";
import type { TrustedTokenEntry } from "./types";

export type SecurityProvider = "lifi" | "rango" | "oneclick";
/** All fields come from the user-approved form/quote snapshot, never an API's trust claim. */
export type SecuritySwapIntent = {
  provider: SecurityProvider;
  protocol: string;
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromTokenDecimals: number;
  toTokenDecimals: number;
  fromAddress: string;
  receiver: string;
  fromAmount: string;
  toAmount: string;
  minimumAmountOut: string;
  expiresAt: number;
  maxSlippageBps: number;
  depositAddress?: string;
};
export type RegistrySnapshot = { entries: readonly TrustedTokenEntry[] };
export type SecurityValidationCode = "TOKEN_NOT_IN_REGISTRY" | "QUOTE_TOKEN_MISMATCH" | "QUOTE_CHAIN_MISMATCH" |
  "QUOTE_RECEIVER_MISMATCH" | "UNKNOWN_TRANSACTION_TARGET" | "UNKNOWN_APPROVAL_TARGET" | "QUOTE_VALIDATION_FAILED";
export class SecurityValidationError extends Error {
  readonly event: SecurityValidationCode;
  readonly eventData: { event: SecurityValidationCode; assetId: string; chainId: number; severity: "critical"; action: "blocked"; detectedAt: string; details: { reason: string } };
  constructor(readonly code: SecurityValidationCode, chainId: number, reason: string, assetId = "unknown") {
    super(code);
    this.name = "SecurityValidationError";
    this.event = code;
    this.eventData = { event: code, assetId, chainId, severity: "critical", action: "blocked", detectedAt: new Date().toISOString(), details: { reason } };
  }
}
export const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
export function securityUint(value: unknown, allowZero = false): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,77})$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= MAX_UINT256 && (allowZero || amount > BigInt(0)) ? amount : null;
}
export function normalizedSecurityAddress(value: unknown): string | null {
  return typeof value === "string" && isAddress(value, { strict: false }) ? value.toLowerCase() : null;
}
function requiredToken(registry: RegistrySnapshot, chainId: number, address: string, decimals: number): TrustedTokenEntry {
  const normalized = normalizedSecurityAddress(address);
  if (!normalized || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !Array.isArray(registry?.entries)) {
    throw new SecurityValidationError("QUOTE_TOKEN_MISMATCH", chainId, "invalid_token_identity");
  }
  const native = normalized === zeroAddress;
  const matches = registry.entries.filter(entry => entry.chainId === chainId &&
    (native ? entry.type === "native" && entry.address === null : entry.type === "erc20" && normalizedSecurityAddress(entry.address) === normalized));
  if (matches.length !== 1 || matches[0].status !== "trusted") {
    throw new SecurityValidationError("TOKEN_NOT_IN_REGISTRY", chainId, matches.length > 1 ? "ambiguous_registry_identity" : "token_not_trusted", matches[0]?.assetId);
  }
  if (matches[0].decimals !== decimals) throw new SecurityValidationError("QUOTE_TOKEN_MISMATCH", chainId, "registry_decimals_mismatch", matches[0].assetId);
  return matches[0];
}
export function validateSwapQuote(quote: SecuritySwapIntent, intent: SecuritySwapIntent, registry: RegistrySnapshot, now = Date.now()): void {
  const chain = intent?.fromChainId;
  const fail = (reason: string): never => { throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", chain, reason); };
  if (!intent || !quote || !["lifi", "rango", "oneclick"].includes(intent.provider) || quote.provider !== intent.provider ||
      typeof intent.protocol !== "string" || !/^[\w .:()/+-]{1,160}$/.test(intent.protocol) || quote.protocol !== intent.protocol) fail("invalid_provider_or_protocol");
  for (const field of ["fromChainId", "toChainId"] as const) {
    if (!Number.isSafeInteger(intent[field]) || intent[field] <= 0 || quote[field] !== intent[field]) throw new SecurityValidationError("QUOTE_CHAIN_MISMATCH", chain, "quote_chain_changed");
  }
  for (const [address, decimals, chainId] of [["fromTokenAddress", "fromTokenDecimals", "fromChainId"], ["toTokenAddress", "toTokenDecimals", "toChainId"]] as const) {
    if (normalizedSecurityAddress(quote[address]) !== normalizedSecurityAddress(intent[address]) || quote[decimals] !== intent[decimals]) {
      throw new SecurityValidationError("QUOTE_TOKEN_MISMATCH", intent[chainId], "quote_token_changed");
    }
    requiredToken(registry, intent[chainId], intent[address], intent[decimals]);
  }
  const receiver = normalizedSecurityAddress(intent.receiver);
  const account = normalizedSecurityAddress(intent.fromAddress);
  if (!receiver || receiver === zeroAddress || normalizedSecurityAddress(quote.receiver) !== receiver) {
    throw new SecurityValidationError("QUOTE_RECEIVER_MISMATCH", chain, "quote_receiver_changed");
  }
  if (!account || account === zeroAddress || normalizedSecurityAddress(quote.fromAddress) !== account) fail("quote_account_changed");
  const amount = securityUint(intent.fromAmount);
  const output = securityUint(quote.toAmount);
  const minimum = securityUint(quote.minimumAmountOut);
  const requestedMinimum = securityUint(intent.minimumAmountOut);
  if (amount === null || securityUint(quote.fromAmount) !== amount || output === null || minimum === null || requestedMinimum === null ||
      minimum < requestedMinimum || minimum > output || securityUint(intent.toAmount) === null || requestedMinimum > BigInt(intent.toAmount)) fail("quote_amount_or_minimum_changed");
  if (!Number.isFinite(now) || !Number.isFinite(intent.expiresAt) || !Number.isFinite(quote.expiresAt) ||
      intent.expiresAt <= now || quote.expiresAt <= now || quote.expiresAt > intent.expiresAt) fail("quote_expired_or_deadline_changed");
  if (!Number.isInteger(intent.maxSlippageBps) || intent.maxSlippageBps < 0 || intent.maxSlippageBps >= 10_000 ||
      quote.maxSlippageBps !== intent.maxSlippageBps || minimum! * BigInt(10_000) < output! * BigInt(10_000 - intent.maxSlippageBps)) fail("slippage_exceeds_limit");
}

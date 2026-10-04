import { decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex, zeroAddress } from "viem";
import { MAX_UINT256, normalizedSecurityAddress, SecurityValidationError, securityUint, validateSwapQuote,
  type RegistrySnapshot, type SecurityProvider, type SecuritySwapIntent } from "./quote-validator";
export type { SecuritySwapIntent } from "./quote-validator";

export type TransactionCandidate = { chainId: number; from: string; to: string; data: string; value: string };
export type TransactionContext = { provider: SecurityProvider; kind: "swap" | "approval" | "approval_reset" | "deposit"; protocol?: string; depositAddress?: string };
export type TransactionAuthorizer = (candidate: TransactionCandidate, context: TransactionContext) => Promise<void>;
export type ReviewedContractTarget = { chainId: number; address: string; provider?: SecurityProvider; protocol?: string; abi?: "uniswap_v2_swap_exact_tokens_v1" | "erc20_transfer" };
export type TransactionPolicy = { supportedChainIds: readonly number[]; maxSlippageBps: number; lifiAllowedContracts: readonly ReviewedContractTarget[]; allowedApprovalTargets: readonly ReviewedContractTarget[]; allowedDepositReceivers: readonly ReviewedContractTarget[] };
export type ValidatedTransaction = { kind: TransactionContext["kind"]; target: string; spender?: string };
/** Reviewed semantics of the canonical V2 exact-input token swap. No router is trusted by this ABI alone. */
export const REVIEWED_UNISWAP_V2_ABI = parseAbi(["function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)"]);

function matchTarget(targets: readonly ReviewedContractTarget[], address: string, intent: SecuritySwapIntent) {
  return targets.find(target => target.chainId === intent.fromChainId && target.provider === intent.provider && target.protocol === intent.protocol &&
    normalizedSecurityAddress(target.address) === address);
}
export function validateTransaction(candidate: TransactionCandidate, intent: SecuritySwapIntent, registry: RegistrySnapshot, policy: TransactionPolicy,
  context?: TransactionContext, now = Date.now()): ValidatedTransaction {
  validateSwapQuote(intent, intent, registry, now);
  const fail = (reason: string): never => { throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", intent.fromChainId, reason); };
  if (!candidate || !policy || !Array.isArray(policy.supportedChainIds) || !Array.isArray(policy.lifiAllowedContracts) || !Array.isArray(policy.allowedApprovalTargets) || !Array.isArray(policy.allowedDepositReceivers) ||
      !Number.isInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 0 || policy.maxSlippageBps >= 10_000 || intent.maxSlippageBps > policy.maxSlippageBps) fail("invalid_security_policy");
  if (Object.keys(candidate).some(field => !["chainId", "from", "to", "data", "value"].includes(field))) fail("unsupported_transaction_fields");
  if (candidate.chainId !== intent.fromChainId || !policy.supportedChainIds.includes(intent.fromChainId) || !policy.supportedChainIds.includes(intent.toChainId)) {
    throw new SecurityValidationError("QUOTE_CHAIN_MISMATCH", intent.fromChainId, "transaction_chain_changed");
  }
  if (normalizedSecurityAddress(candidate.from) !== normalizedSecurityAddress(intent.fromAddress)) fail("transaction_account_changed");
  if (context && (context.provider !== intent.provider || (context.protocol !== undefined && context.protocol !== intent.protocol) ||
      !["swap", "approval", "approval_reset", "deposit"].includes(context.kind))) fail("transaction_context_changed");
  const target = normalizedSecurityAddress(candidate.to);
  const source = normalizedSecurityAddress(intent.fromTokenAddress)!;
  const value = securityUint(candidate.value, true);
  if (!target || target === zeroAddress) throw new SecurityValidationError("UNKNOWN_TRANSACTION_TARGET", intent.fromChainId, "invalid_transaction_target");
  if (value === null || typeof candidate.data !== "string" || !/^0x(?:[0-9a-f]{2}){4,}$/i.test(candidate.data)) fail("invalid_transaction_payload");
  const data = candidate.data as Hex;
  const selector = data.slice(0, 10).toLowerCase();
  if (selector === "0x095ea7b3") {
    if (source === zeroAddress || target !== source || value !== BigInt(0)) fail("approval_token_or_value_changed");
    let spender: string; let amount: bigint;
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data });
      if (decoded.functionName !== "approve" || encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: decoded.args }).toLowerCase() !== data.toLowerCase()) return fail("invalid_approval_calldata");
      spender = decoded.args[0].toLowerCase(); amount = decoded.args[1];
    } catch { return fail("invalid_approval_calldata"); }
    if (!matchTarget(policy.allowedApprovalTargets, spender, intent)) throw new SecurityValidationError("UNKNOWN_APPROVAL_TARGET", intent.fromChainId, "spender_not_reviewed");
    if (!matchTarget(policy.lifiAllowedContracts, spender, intent)) throw new SecurityValidationError("UNKNOWN_TRANSACTION_TARGET", intent.fromChainId, "approval_router_not_reviewed");
    const kind = amount === BigInt(0) ? "approval_reset" : "approval";
    if (amount === MAX_UINT256 || (amount !== BigInt(0) && amount !== BigInt(intent.fromAmount)) || (context && context.kind !== kind)) fail("approval_not_exact_amount");
    return { kind, target, spender };
  }
  if (selector === "0xa9059cbb") {
    if (intent.provider !== "oneclick" || source === zeroAddress || target !== source || value !== BigInt(0) || (context && context.kind !== "deposit")) fail("unsupported_token_transfer");
    let recipient: string; let amount: bigint;
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data });
      if (decoded.functionName !== "transfer" || encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: decoded.args }).toLowerCase() !== data.toLowerCase()) return fail("invalid_transfer_calldata");
      recipient = decoded.args[0].toLowerCase(); amount = decoded.args[1];
    } catch { return fail("invalid_transfer_calldata"); }
    // A dynamic provider deposit is information, never an allowlist or authority.
    const expectedDeposit = normalizedSecurityAddress(intent.depositAddress ?? context?.depositAddress);
    const reviewed = matchTarget(policy.allowedDepositReceivers, recipient, intent);
    if (!reviewed || reviewed.abi !== "erc20_transfer") throw new SecurityValidationError("UNKNOWN_TRANSACTION_TARGET", intent.fromChainId, "deposit_recipient_not_reviewed");
    if (!expectedDeposit || expectedDeposit !== recipient || amount !== BigInt(intent.fromAmount)) fail("deposit_recipient_or_amount_changed");
    return { kind: "deposit", target };
  }
  const reviewed = matchTarget(policy.lifiAllowedContracts, target, intent);
  if (!reviewed) throw new SecurityValidationError("UNKNOWN_TRANSACTION_TARGET", intent.fromChainId, "router_not_reviewed");
  if (reviewed.abi !== "uniswap_v2_swap_exact_tokens_v1" || intent.fromChainId !== intent.toChainId || source === zeroAddress ||
      normalizedSecurityAddress(intent.toTokenAddress) === zeroAddress || value !== BigInt(0) || (context && context.kind !== "swap")) fail("unsupported_protocol_or_transaction_type");
  try {
    const decoded = decodeFunctionData({ abi: REVIEWED_UNISWAP_V2_ABI, data });
    if (encodeFunctionData({ abi: REVIEWED_UNISWAP_V2_ABI, functionName: decoded.functionName, args: decoded.args }).toLowerCase() !== data.toLowerCase()) return fail("noncanonical_protocol_calldata");
    const [amount, minimum, path, receiver, deadline] = decoded.args;
    if (amount !== BigInt(intent.fromAmount) || minimum < BigInt(intent.minimumAmountOut) || minimum > BigInt(intent.toAmount) || path.length !== 2 ||
        path[0].toLowerCase() !== source || path[1].toLowerCase() !== normalizedSecurityAddress(intent.toTokenAddress)) return fail("protocol_tokens_or_amounts_changed");
    if (receiver.toLowerCase() !== normalizedSecurityAddress(intent.receiver)) throw new SecurityValidationError("QUOTE_RECEIVER_MISMATCH", intent.fromChainId, "protocol_receiver_changed");
    if (deadline * BigInt(1000) <= BigInt(Math.floor(now)) || deadline * BigInt(1000) > BigInt(Math.floor(intent.expiresAt))) return fail("protocol_deadline_changed");
  } catch (error) {
    if (error instanceof SecurityValidationError) throw error;
    return fail("unknown_or_invalid_protocol_calldata");
  }
  return { kind: "swap", target };
}

import { createWalletClient, custom, encodeFunctionData, erc20Abi, type Address, type Client, type EIP1193RequestFn, type WalletClient } from "viem";
import { normalizedSecurityAddress, SecurityValidationError, securityUint } from "./quote-validator";
import type { TransactionAuthorizer, TransactionCandidate, TransactionContext } from "./transaction-validator";

export type LifiWalletSecurity = { account: string; chainId: number; protocol: string; fromTokenAddress: string; fromAmount: string;
  quotedNativeGasReserve: string; authorizeTransaction: TransactionAuthorizer; check: () => void };
const READ_METHODS = new Set([
  "eth_accounts", "eth_chainId", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getLogs", "eth_getStorageAt", "net_version", "web3_clientVersion", "wallet_getCapabilities", "wallet_getPermissions",
]);
const ENVELOPE_FIELDS = new Set(["from", "to", "data", "input", "value", "chainId", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "type"]);
function rpcQuantity(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,77}|0x[\da-f]{1,64})$/i.test(value)) return null;
  return securityUint(BigInt(value).toString(), true);
}

/** Rebuild viem actions around the guarded request, so their closed-over transport cannot bypass it. */
export function createGuardedLifiWallet(client: Client, security: LifiWalletSecurity): WalletClient {
  const fail = (reason: string): never => { throw new SecurityValidationError("QUOTE_VALIDATION_FAILED", security?.chainId, reason); };
  if (!security || typeof security.check !== "function" || typeof security.authorizeTransaction !== "function" ||
      !Number.isSafeInteger(security.chainId) || !normalizedSecurityAddress(security.account) || !security.protocol ||
      !normalizedSecurityAddress(security.fromTokenAddress) || securityUint(security.fromAmount) === null || securityUint(security.quotedNativeGasReserve, true) === null ||
      client.account?.type !== "json-rpc" || normalizedSecurityAddress(client.account.address) !== normalizedSecurityAddress(security.account) ||
      client.chain?.id !== security.chainId) return fail("unguarded_or_unsupported_wallet");
  const originalRequest = client.request.bind(client);
  const sourceToken = security.fromTokenAddress as Address;
  const sourceAmount = BigInt(security.fromAmount);
  const quotedReserve = BigInt(security.quotedNativeGasReserve);
  const nativeSource = /^0x0{40}$/i.test(sourceToken);
  const assertWallet = async () => {
    const [accounts, chainId] = await Promise.all([
      originalRequest({ method: "eth_accounts" }), originalRequest({ method: "eth_chainId" }),
    ]);
    security.check();
    if (!Array.isArray(accounts) || accounts.length !== 1 || normalizedSecurityAddress(accounts[0]) !== normalizedSecurityAddress(security.account) ||
        rpcQuantity(chainId) !== BigInt(security.chainId)) return fail("live_wallet_account_or_chain_changed");
  };
  let signing = false;
  let requiresReconciliation = false;
  const guardedRequest = async (args: { method: string; params?: unknown }) => {
    if (READ_METHODS.has(args.method)) return originalRequest(args as Parameters<typeof client.request>[0]);
    if (args.method !== "eth_sendTransaction" && args.method !== "eth_signTransaction") return fail("unsupported_signature_or_wallet_method");
    if (signing || requiresReconciliation) return fail("wallet_outcome_requires_reconciliation");
    security.check();
    if (!Array.isArray(args.params) || args.params.length !== 1 || !args.params[0] || typeof args.params[0] !== "object" || Array.isArray(args.params[0])) return fail("invalid_wallet_transaction");
    // Only scalar, standard EOA fields. EIP-7702 authorizations, blobs, userops,
    // batches and new/unknown envelope fields need a separately reviewed policy.
    const transaction = { ...args.params[0] } as Record<string, unknown>;
    if (Object.keys(transaction).some(field => !ENVELOPE_FIELDS.has(field))) return fail("unsupported_transaction_envelope");
    for (const field of ["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "type"] as const) {
      if (transaction[field] !== undefined && rpcQuantity(transaction[field]) === null) return fail("invalid_transaction_envelope");
    }
    if (transaction.type !== undefined && rpcQuantity(transaction.type)! > BigInt(2)) return fail("unsupported_transaction_type");
    if (transaction.chainId !== undefined && rpcQuantity(transaction.chainId) !== BigInt(security.chainId)) return fail("wallet_transaction_chain_changed");
    if (transaction.data !== undefined && transaction.input !== undefined && transaction.data !== transaction.input) return fail("ambiguous_transaction_calldata");
    const value = transaction.value === undefined ? BigInt(0) : rpcQuantity(transaction.value);
    const data = transaction.data ?? transaction.input ?? "0x";
    if (value === null || typeof data !== "string" || !/^0x(?:[\da-f]{2})*$/i.test(data) ||
        !normalizedSecurityAddress(transaction.to) || normalizedSecurityAddress(transaction.from) !== normalizedSecurityAddress(security.account)) return fail("invalid_wallet_transaction_identity");
    const candidate: TransactionCandidate = Object.freeze({ chainId: security.chainId, from: String(transaction.from), to: String(transaction.to), data, value: value.toString() });
    const selector = data.slice(0, 10).toLowerCase();
    const kind: TransactionContext["kind"] = selector === "0x095ea7b3"
      ? (/^0x[\da-f]{136}$/i.test(data) && BigInt(`0x${data.slice(-64)}`) === BigInt(0) ? "approval_reset" : "approval") : "swap";
    // Hold an independent immutable snapshot across the network authorization.
    transaction.chainId = `0x${security.chainId.toString(16)}`;
    const authorizedRequest = { method: args.method, params: [Object.freeze(transaction)] };
    await security.authorizeTransaction(candidate, { provider: "lifi", protocol: security.protocol, kind });
    security.check();
    await assertWallet();
    const [nativeBalanceResult, gasResult, gasPriceResult, tokenBalanceResult] = await Promise.all([
      originalRequest({ method: "eth_getBalance", params: [security.account as Address, "pending"] }),
      originalRequest({ method: "eth_estimateGas", params: [{ from: security.account as Address, to: candidate.to as Address, data: candidate.data as `0x${string}`, value: `0x${value.toString(16)}` }] }),
      originalRequest({ method: "eth_gasPrice" }),
      nativeSource ? Promise.resolve(null) : originalRequest({ method: "eth_call", params: [{ to: sourceToken,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [security.account as Address] }) }, "pending"] }),
    ]);
    security.check();
    const nativeBalance = rpcQuantity(nativeBalanceResult), estimatedGas = rpcQuantity(gasResult), networkGasPrice = rpcQuantity(gasPriceResult);
    if (nativeBalance === null || estimatedGas === null || estimatedGas <= BigInt(0) || networkGasPrice === null || networkGasPrice <= BigInt(0)) return fail("invalid_live_balance_or_gas_estimate");
    const paddedGas = (estimatedGas * BigInt(120) + BigInt(99)) / BigInt(100);
    const explicitGas = transaction.gas === undefined ? null : rpcQuantity(transaction.gas);
    if (explicitGas !== null && explicitGas < estimatedGas) return fail("insufficient_transaction_gas_limit");
    const gas = explicitGas !== null && explicitGas > paddedGas ? explicitGas : paddedGas;
    const explicitPrice = rpcQuantity(transaction.maxFeePerGas ?? transaction.gasPrice);
    const gasPrice = explicitPrice !== null && explicitPrice > networkGasPrice ? explicitPrice : networkGasPrice;
    const gasCost = gas * gasPrice;
    const requiredGas = kind === "approval" || kind === "approval_reset" ? gasCost + quotedReserve : (gasCost > quotedReserve ? gasCost : quotedReserve);
    if (nativeBalance < (nativeSource ? sourceAmount : value) + requiredGas) return fail("insufficient_live_native_balance");
    if (!nativeSource && (typeof tokenBalanceResult !== "string" || !/^0x[\da-f]{64}$/i.test(tokenBalanceResult) || BigInt(tokenBalanceResult) < sourceAmount)) return fail("insufficient_or_invalid_live_token_balance");
    // Funds and estimation are asynchronous too: recheck identity and quote at
    // the final boundary after all of those reads have completed.
    await assertWallet();
    if (signing || requiresReconciliation) return fail("wallet_outcome_requires_reconciliation");
    signing = true;
    try {
      // The original viem request wrapper has its own retry policy. Disable it
      // explicitly as well as the outer custom transport for a broadcast.
      const result = await originalRequest(authorizedRequest as Parameters<typeof client.request>[0], { retryCount: 0 });
      if (args.method === "eth_sendTransaction" && (typeof result !== "string" || !/^0x[\da-f]{64}$/i.test(result))) {
        requiresReconciliation = true;
        return fail("invalid_or_unknown_wallet_broadcast_result");
      }
      return result;
    } catch (error) {
      // A transport failure may follow a successful broadcast. Further SDK
      // retries on this wallet scope cannot ask for another signature.
      let current: unknown = error; let rejected = false;
      for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
        const value = current as { code?: unknown; name?: unknown; cause?: unknown };
        if (value.code === 4001 || value.name === "UserRejectedRequestError") { rejected = true; break; }
        current = value.cause;
      }
      if (!rejected) requiresReconciliation = true;
      throw error;
    } finally { signing = false; }
  };
  return createWalletClient({ account: security.account as Address, chain: client.chain,
    transport: custom({ request: guardedRequest as EIP1193RequestFn }, { retryCount: 0 }),
  }) as WalletClient;
}

import { canExecuteNewSwap, assertExecutionEnabled } from "../../release-mode";
import { buildIntentSeed, withIntentExecution, type IntentExecutionSession } from "../../intent/journal";
import { erc20Abi, encodeFunctionData, isAddress, type Address } from "viem";
import { estimateFeesPerGas, estimateGas, getAccount, getBalance, getBytecode, getTransactionCount, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { walletConfig } from "../../wallet";
import { isAppChainId } from "../../chains";
import type { OneClickNormalizedRoute } from "../../types/normalized-route";
import { fetchOneClickQuote } from "./client";
import type { SwapParams } from "../lifi/routes";
import type { PendingOneClickV1, OneClickExecutionOptions } from "./types";
export type { OneClickExecutionOptions } from "./types";
import type { TransactionAuthorizer } from "../../security/transaction-validator";

function explicitlyRejected(error: unknown): boolean {
  // RPC/transport failures can happen after broadcast; only wallet rejection
  // establishes that the request was not sent. Never infer it from message text.
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const value = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (value.code === 4001 || value.name === "UserRejectedRequestError") return true;
    current = value.cause;
  }
  return false;
}
export async function executeOneClickRoute(route: OneClickNormalizedRoute, params: SwapParams, check: () => void, options: OneClickExecutionOptions,
  authorizeTransaction?: TransactionAuthorizer, journal?: IntentExecutionSession): Promise<{ provider: "oneclick"; pending: PendingOneClickV1 } | null> {
  if (!canExecuteNewSwap()) throw new Error("Execution is disabled by the release mode.");
  if (!journal) return withIntentExecution(buildIntentSeed(route, params), session => executeOneClickRoute(route, params, check, options, authorizeTransaction, session));
  if (typeof check !== "function") throw new Error("A quote check is required before 1Click execution.");
  const chainId = params.fromChainId;
  if (!isAppChainId(chainId)) throw new Error("Unsupported network");
  if (/^0x0{40}$/i.test(params.fromTokenAddress)) throw new Error("1Click native deposits are not supported.");
  check();
  const quote = await fetchOneClickQuote({ ...params, fromTokenDecimals: route.raw.fromToken.decimals, toTokenDecimals: route.raw.toToken.decimals }, false);
  check();
  if (!quote.depositAddress || !isAddress(quote.depositAddress) || /^0x0{40}$/i.test(quote.depositAddress) ||
      !quote.deadline || !Number.isFinite(Date.parse(quote.deadline)) || Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("Invalid or expired 1Click deposit instructions.");
  if (BigInt(quote.minAmountOut) < BigInt(route.toAmountMin)) throw new Error("The 1Click minimum changed. Refresh the quote before swapping.");
  if (!options.confirm(quote)) return null;
  check();
  const account = params.fromAddress as Address; const amount = BigInt(params.fromAmount); const args = [quote.depositAddress, amount] as const;
  const assertFunds = async () => {
    const [estimatedGas, fees, balance, tokenBalance] = await Promise.all([
      estimateGas(walletConfig, { account, chainId, to: params.fromTokenAddress as Address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args }) }),
      estimateFeesPerGas(walletConfig, { chainId }), getBalance(walletConfig, { address: account, chainId }),
      readContract(walletConfig, { chainId, address: params.fromTokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    ]);
    check();
    if (estimatedGas <= BigInt(0)) throw new Error("Invalid source gas estimate.");
    const gas = (estimatedGas * BigInt(120) + BigInt(99)) / BigInt(100);
    const gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
    if (gasPrice == null || gasPrice <= BigInt(0) || balance.value < gas * gasPrice) throw new Error("Insufficient native balance for gas.");
    if (tokenBalance < amount) throw new Error("Insufficient token balance.");
    return gas;
  };
  await assertFunds();
  if (Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("1Click deposit instructions expired.");
  await authorizeTransaction?.({ chainId, from: account, to: params.fromTokenAddress,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args }), value: "0" },
  { provider: "oneclick", protocol: "oneclick", kind: "deposit", depositAddress: quote.depositAddress });
  check();
  const assertWallet = () => {
    check();
    const live = getAccount(walletConfig);
    if (!live.isConnected || live.address?.toLowerCase() !== account.toLowerCase() || live.chainId !== chainId) throw new Error("The live wallet account or network changed.");
  };
  assertWallet();
  const assertEoa = async () => {
    const code = await getBytecode(walletConfig, { chainId, address: account });
    assertWallet();
    if (code && code !== "0x") throw new Error("Contract wallets and delegated EIP-7702 accounts are not supported.");
  };
  // Use the fresh estimate for the actual wallet request as well.
  let gas = await assertFunds();
  assertWallet();
  if (Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("1Click deposit instructions expired.");
  const nonce = await getTransactionCount(walletConfig, { chainId, address: account, blockTag: "pending" });
  assertWallet();
  if (Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("1Click deposit instructions expired.");
  let pending: PendingOneClickV1 = { journalId: journal.id, version: 1, wallet: account, fromChainId: chainId, toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress as Address, toTokenAddress: params.toTokenAddress as Address,
    fromTokenDecimals: route.raw.fromToken.decimals, toTokenDecimals: route.raw.toToken.decimals,
    depositAddress: quote.depositAddress as Address, status: "UNKNOWN", submittedAt: Date.now(),
    amount: params.fromAmount, minimum: quote.minAmountOut, originToken: quote.originToken,
    destinationToken: quote.destinationToken, quoteResponse: quote.quoteResponse };
  // Persist before the wallet request, including when its broadcast result is
  // ambiguous. The caller must fail closed if this intention cannot be saved.
  journal.saveProviderState(pending);
  const actionId = await journal.beforeAction({ nonce, kind: "deposit", chainId, to: params.fromTokenAddress,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args }), value: "0" });
  let hash: `0x${string}`;
  let requested = false;
  try {
    options.onPending(pending);
    if (!canExecuteNewSwap()) throw new Error("Execution is disabled by the release mode.");
    await assertExecutionEnabled();
    assertWallet();
    await assertEoa();
    const [finalNonce, freshGas] = await Promise.all([
      getTransactionCount(walletConfig, { chainId, address: account, blockTag: "pending" }), assertFunds(),
    ]);
    gas = freshGas;
    assertWallet();
    if (finalNonce !== nonce) throw new Error("The source nonce changed before the wallet request.");
    if (Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("1Click deposit instructions expired.");
    requested = true;
    hash = await writeContract(walletConfig, { account, chainId, address: params.fromTokenAddress as Address,
      abi: erc20Abi, functionName: "transfer", args, gas, nonce });
    if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error("Unknown source transfer outcome. Keep tracking the existing deposit.");
    journal.sent(actionId, hash);
  } catch (error) {
    if (!requested) {
      journal.notSent(actionId);
      pending = { ...pending, status: "FAILED", sourceOutcome: "not_sent" };
      journal.saveProviderState(pending);
      options.onPending(pending);
    }
    else if (explicitlyRejected(error)) { journal.rejected(actionId); pending = { ...pending, status: "FAILED", sourceOutcome: "rejected" }; journal.saveProviderState(pending); options.onPending(pending); }
    else { try { journal.ambiguous(actionId); } catch { /* emergency export retains available hash */ } }
    // A timeout or transport error does not authorize a new transfer.
    throw error;
  }
  pending = { ...pending, hash, status: "PENDING_DEPOSIT" };
  journal.saveProviderState(pending);
  options.onPending(pending);
  const receipt = await waitForTransactionReceipt(walletConfig, { hash, chainId });
  if (receipt.status === "reverted") { journal.sourceFailed(actionId, { receipt }); pending = { ...pending, status: "FAILED", sourceOutcome: "reverted" }; journal.saveProviderState(pending); options.onPending(pending); throw new Error("The source transfer reverted."); }
  if (receipt.status !== "success") throw new Error("Unknown source receipt outcome. Keep tracking the existing deposit.");
  journal.confirmed(actionId, { receipt });
  return { provider: "oneclick" as const, pending };
}

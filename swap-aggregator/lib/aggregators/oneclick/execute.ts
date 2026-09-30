import { erc20Abi, encodeFunctionData, isAddress, type Address } from "viem";
import { estimateFeesPerGas, estimateGas, getBalance, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { walletConfig } from "../../wallet";
import { isAppChainId } from "../../chains";
import type { OneClickNormalizedRoute } from "../../types/normalized-route";
import { fetchOneClickQuote } from "./client";
import type { SwapParams } from "../lifi/routes";
import type { PendingOneClick, OneClickExecutionOptions } from "./types";
export type { OneClickExecutionOptions } from "./types";
export async function executeOneClickRoute(route: OneClickNormalizedRoute, params: SwapParams, check: () => void, options: OneClickExecutionOptions) {
  const chainId = params.fromChainId;
  if (!isAppChainId(chainId)) throw new Error("Unsupported network");
  if (/^0x0{40}$/i.test(params.fromTokenAddress)) throw new Error("1Click native deposits are not supported.");
  const quote = await fetchOneClickQuote({ ...params, fromTokenDecimals: route.raw.fromToken.decimals, toTokenDecimals: route.raw.toToken.decimals }, false);
  check();
  if (!quote.depositAddress || !isAddress(quote.depositAddress) || /^0x0{40}$/i.test(quote.depositAddress) ||
      !quote.deadline || !Number.isFinite(Date.parse(quote.deadline)) || Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("Invalid or expired 1Click deposit instructions.");
  if (BigInt(quote.minAmountOut) < BigInt(route.toAmountMin)) throw new Error("The 1Click minimum changed. Refresh the quote before swapping.");
  if (!options.confirm(quote)) return null;
  check();
  const account = params.fromAddress as Address; const amount = BigInt(params.fromAmount); const args = [quote.depositAddress, amount] as const;
  const gas = await estimateGas(walletConfig, { account, chainId, to: params.fromTokenAddress as Address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args }) });
  const [fees, balance, tokenBalance] = await Promise.all([
    estimateFeesPerGas(walletConfig, { chainId }), getBalance(walletConfig, { address: account, chainId }),
    readContract(walletConfig, { chainId, address: params.fromTokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  ]);
  check();
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
  if (gasPrice == null || balance.value < gas * gasPrice) throw new Error("Insufficient native balance for gas.");
  if (tokenBalance < amount) throw new Error("Insufficient token balance.");
  if (Date.parse(quote.deadline) <= Date.now() + 30_000) throw new Error("1Click deposit instructions expired.");
  const hash = await writeContract(walletConfig, { account, chainId, address: params.fromTokenAddress as Address, abi: erc20Abi, functionName: "transfer", args });
  const pending: PendingOneClick = { wallet: account, fromChainId: chainId, depositAddress: quote.depositAddress, hash, status: "PENDING_DEPOSIT" };
  options.onPending(pending);
  const receipt = await waitForTransactionReceipt(walletConfig, { hash, chainId });
  if (receipt.status !== "success") { options.onPending({ ...pending, status: "FAILED" }); throw new Error("The source transfer reverted."); }
  return { provider: "oneclick" as const, pending };
}

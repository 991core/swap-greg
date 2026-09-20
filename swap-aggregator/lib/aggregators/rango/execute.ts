import { decodeFunctionData, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { estimateFeesPerGas, estimateGas, getBalance, readContract, sendTransaction, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { walletConfig } from "../../wallet";
import { isAppChainId } from "../../chains";
import type { SwapParams } from "../lifi/routes";
import type { RangoNormalizedRoute } from "../../types/normalized-route";
import { NATIVE_ADDRESS } from "../../tokens/catalog";
import { sourceGasAmount } from "../../routing/quote";
import { rangoRequest } from "./client";
import { isAddress, rangoToken, RANGO_CHAINS, validateRangoQuote } from "./validation";
import { trackRangoTransaction } from "./tracking";
import type { RangoExecution, RangoProgress, RangoSwap, RangoTransaction } from "./types";
import { transactionLink } from "./explorer";

export function validateRangoTransaction(data: RangoSwap, route: RangoNormalizedRoute, params: SwapParams): RangoTransaction {
  const quoted = validateRangoQuote(data, params).route;
  const previous = route.raw.quote.route;
  if (quoted.swapper.id !== previous.swapper.id || BigInt(quoted.outputAmountMin) < BigInt(route.toAmountMin) ||
      quoted.from.decimals !== previous.from.decimals || quoted.to.decimals !== previous.to.decimals) throw new Error("Rango: quote changed. Refresh before signing.");
  const feeTotals = (value: typeof quoted) => value.fee.reduce((totals, fee) => {
    const token = rangoToken(fee.token);
    const key = [fee.expenseType, token.chainId, token.address.toLowerCase()].join(":");
    totals.set(key, (totals.get(key) ?? BigInt(0)) + BigInt(fee.amount)); return totals;
  }, new Map<string, bigint>());
  const oldFees = feeTotals(previous);
  for (const [key, amount] of feeTotals(quoted)) if (amount > (oldFees.get(key) ?? BigInt(0))) throw new Error("Rango: fees changed. Refresh before signing.");
  const tx = data.tx;
  const native = params.fromTokenAddress.toLowerCase() === NATIVE_ADDRESS;
  if (!tx || tx.type !== "EVM" || Number(tx.blockChain?.chainId) !== params.fromChainId || tx.blockChain?.name !== RANGO_CHAINS[params.fromChainId].name ||
      (tx.from != null && tx.from.toLowerCase() !== params.fromAddress.toLowerCase()) || !isAddress(tx.txTo) || tx.txTo === NATIVE_ADDRESS ||
      typeof tx.value !== "string" || !/^(?:\d{1,78}|0x[\da-f]{1,64})$/i.test(tx.value) ||
      BigInt(tx.value) !== (native ? BigInt(params.fromAmount) : BigInt(0)) ||
      typeof tx.txData !== "string" || !/^0x(?:[\da-f]{2}){4,}$/i.test(tx.txData)) throw new Error("Rango: unsupported or mismatched transaction.");
  if (tx.approveTo != null || tx.approveData != null) {
    if (native || !isAddress(tx.approveTo) || tx.approveTo.toLowerCase() !== params.fromTokenAddress.toLowerCase() ||
        typeof tx.approveData !== "string" || !/^0x[\da-f]{136}$/i.test(tx.approveData)) throw new Error("Rango: invalid token approval.");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.approveData as Hex });
    if (decoded.functionName !== "approve" || decoded.args[0].toLowerCase() !== tx.txTo.toLowerCase() || decoded.args[1] !== BigInt(params.fromAmount)) throw new Error("Rango: approval must be limited to the selected amount and router.");
  }
  return tx;
}

export async function executeRangoRoute(route: RangoNormalizedRoute, params: SwapParams, check: () => void,
  onProgress: (progress: RangoProgress) => void = () => {}): Promise<RangoExecution> {
  if (!isAppChainId(params.fromChainId)) throw new Error("Unsupported source chain.");
  const chainId = params.fromChainId;
  const account = params.fromAddress as Address;
  const native = params.fromTokenAddress.toLowerCase() === NATIVE_ADDRESS;
  const prepare = async () => {
    check();
    const data = await rangoRequest<RangoSwap>("swap", { params, swapper: route.raw.quote.route.swapper.id });
    check();
    return { data, tx: validateRangoTransaction(data, route, params) };
  };
  const assertFunds = async (to: Address, data: Hex, value: bigint, reserve: bigint) => {
    const [gas, fees, balance, tokenBalance] = await Promise.all([
      estimateGas(walletConfig, { chainId, account, to, data, value }),
      estimateFeesPerGas(walletConfig, { chainId }), getBalance(walletConfig, { address: account, chainId }),
      native ? Promise.resolve(null) : readContract(walletConfig, { chainId, address: params.fromTokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    ]);
    check();
    const price = fees.maxFeePerGas ?? fees.gasPrice;
    if (!price || balance.value < value + (gas * price * BigInt(120) / BigInt(100)) + reserve) throw new Error("Rango: insufficient native balance for transaction fees.");
    if (tokenBalance !== null && tokenBalance < BigInt(params.fromAmount)) throw new Error("Rango: insufficient token balance.");
  };
  onProgress({ stage: "preparing" });
  let prepared = await prepare();
  if (prepared.tx.approveTo && prepared.tx.approveData) {
    const token = params.fromTokenAddress as Address;
    const spender = prepared.tx.txTo as Address;
    const allowance = await readContract(walletConfig, { chainId, address: token, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
    check();
    // USDT-style tokens require resetting a nonzero allowance first. No unlimited approvals.
    const amounts = allowance > BigInt(0) && allowance < BigInt(params.fromAmount) ? [BigInt(0), BigInt(params.fromAmount)] : [BigInt(params.fromAmount)];
    if (allowance < BigInt(params.fromAmount)) for (const amount of amounts) {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
      await assertFunds(token, data, BigInt(0), sourceGasAmount(route));
      check(); onProgress({ stage: "approval" });
      const hash = await writeContract(walletConfig, { chainId, account, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
      onProgress({ stage: "approval", txHash: hash, txLink: transactionLink(chainId, hash) });
      const receipt = await waitForTransactionReceipt(walletConfig, { chainId, hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("Rango: approval failed.");
      check();
    }
    // Rebuild after approval, but never silently lower the displayed minimum or change protocol.
    prepared = await prepare();
    if (prepared.tx.txTo.toLowerCase() !== spender.toLowerCase()) throw new Error("Rango: router changed after approval.");
    const approved = await readContract(walletConfig, { chainId, address: token, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
    check();
    if (approved < BigInt(params.fromAmount)) throw new Error("Rango: token approval is not sufficient.");
  }
  const tx = prepared.tx;
  await assertFunds(tx.txTo as Address, tx.txData as Hex, BigInt(tx.value), BigInt(0));
  check(); onProgress({ stage: "signing" });
  const hash = await sendTransaction(walletConfig, { chainId, account, to: tx.txTo as Address, data: tx.txData as Hex, value: BigInt(tx.value) });
  const pending = { provider: "rango" as const, requestId: prepared.data.requestId, txHash: hash, chainId,
    account, toToken: prepared.data.route!.to, minimum: route.toAmountMin };
  // From here, never auto-resubmit. The source receipt is not proof of bridge completion.
  onProgress({ stage: "tracking", txHash: hash, txLink: transactionLink(chainId, hash), pending });
  return trackRangoTransaction(pending);
}

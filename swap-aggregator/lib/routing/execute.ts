import type { UpdateRouteHook } from "@lifi/sdk";
import { erc20Abi, type Address } from "viem";
import { getAccount, getBalance, readContract, switchChain } from "wagmi/actions";
import { walletConfig } from "../wallet";
import { isAppChainId } from "../chains";
import type { SwapParams } from "../aggregators/lifi/routes";
import { executeLifiRoute } from "../aggregators/lifi/execute";
import type { NormalizedRoute } from "../types/normalized-route";
import { canExecuteQuote, sourceGasAmount } from "./quote";

export class SwapValidationError extends Error {
  constructor(public readonly key: "quote_changed" | "insufficient_balance" | "insufficient_gas") { super(key); }
}
export async function executeSwapQuote(route: NormalizedRoute, params: SwapParams, updateRouteHook: UpdateRouteHook) {
  const check = () => {
    const account = getAccount(walletConfig);
    if (!account.isConnected || account.address?.toLowerCase() !== params.fromAddress.toLowerCase() || !canExecuteQuote(route, params)) {
      throw new SwapValidationError("quote_changed");
    }
  };
  check();
  if (!isAppChainId(params.fromChainId)) throw new SwapValidationError("quote_changed");
  if (getAccount(walletConfig).chainId !== params.fromChainId) await switchChain(walletConfig, { chainId: params.fromChainId });
  check();
  const address = params.fromAddress as Address;
  const native = /^0x0{40}$/i.test(params.fromTokenAddress);
  const [gasBalance, tokenBalance] = await Promise.all([
    getBalance(walletConfig, { address, chainId: params.fromChainId }),
    native ? Promise.resolve(null) : readContract(walletConfig, { chainId: params.fromChainId, address: params.fromTokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  const amount = BigInt(params.fromAmount);
  if ((native ? gasBalance.value : tokenBalance!) < amount) throw new SwapValidationError("insufficient_balance");
  if (gasBalance.value < sourceGasAmount(route) + (native ? amount : BigInt(0)) || gasBalance.value === BigInt(0)) throw new SwapValidationError("insufficient_gas");
  check();
  if (getAccount(walletConfig).chainId !== params.fromChainId) throw new SwapValidationError("quote_changed");
  return executeLifiRoute(route.raw, { updateRouteHook, acceptExchangeRateUpdateHook: async () => false });
}

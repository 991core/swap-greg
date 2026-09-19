import { getToken } from "@lifi/sdk";
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { APP_CHAINS, isAppChainId } from "./chains";
import { getLifiSdkClient } from "./aggregators/lifi/client";

export interface ResolvedToken {
  symbol: string; name: string; decimals: number; address: string; chainId: number;
  logoURI?: string; priceUSD?: string | null; topSymbol?: string;
}
export function looksLikeAddress(query: string): boolean { return /^0x[a-fA-F0-9]{40}$/.test(query.trim()); }
export function detectChainFromAddress(address: string) {
  return looksLikeAddress(address) ? { chainId: 1, confidence: "low" as const } : null;
}
export async function resolveTokenByAddress(chainId: number, input: string): Promise<ResolvedToken | null> {
  if (!isAppChainId(chainId) || !looksLikeAddress(input)) return null;
  const address = getAddress(input.trim().toLowerCase());
  try {
    const token = await getToken(getLifiSdkClient(), chainId, address, { signal: AbortSignal.timeout(5000) });
    if (token.chainId === chainId && token.address.toLowerCase() === address.toLowerCase() &&
        Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 255 && token.symbol) {
      return { chainId, address, decimals: token.decimals, symbol: token.symbol,
        name: token.name || token.symbol, logoURI: token.logoURI || "", priceUSD: token.priceUSD ?? null };
    }
  } catch { /* Metadata can still be verified directly on the selected EVM chain. */ }
  const chain = APP_CHAINS.find((c) => c.id === chainId)!;
  const client = createPublicClient({ chain, transport: http(undefined, { timeout: 5000, retryCount: 0 }) });
  try {
    const [decimals, symbol, name] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    ]);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !symbol || !name) return null;
    return { address, chainId, decimals, symbol, name };
  } catch { return null; }
}

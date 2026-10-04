import { APP_CHAINS } from "../../chains";
export function transactionLink(chainId: number, hash: string): string | undefined {
  const base = APP_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers.default.url;
  return /^0x[\da-f]{64}$/i.test(hash) && base ? `${base}/tx/${hash}` : undefined;
}

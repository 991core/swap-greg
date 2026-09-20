import Image from "next/image";

const icons: Record<number, string> = { 1: "eth", 10: "optimism", 56: "bsc", 100: "gnosis", 137: "polygon", 1088: "metis", 8453: "base", 42161: "arbitrum", 43114: "avax_cchain" };
export function ChainIcon({ chainId, size = 22, className = "" }: { chainId: number; size?: number; className?: string }) {
  return icons[chainId] ? <Image className={`jumper-chain-icon ${className}`} src={`/tokens/chain-${icons[chainId]}.svg`} alt="" width={size} height={size} unoptimized /> :
    <span className={`jumper-chain-icon ${className}`} aria-hidden="true">◇</span>;
}

import Image from "next/image";
export function ProviderBadge({ provider }: { provider: "lifi" | "rango" | "oneclick" | "socket" }) {
  return <span className={`jumper-provider-brand ${provider}`}>
    {provider === "rango" ? <Image src="/tokens/rango.svg" alt="" width={18} height={18} unoptimized /> : <span className="jumper-lifi-mark" aria-hidden="true">{provider === "oneclick" ? "1" : "↗"}</span>}
    {provider === "rango" ? "Rango" : provider === "oneclick" ? "1Click" : provider === "socket" ? "Socket" : "LI.FI"}
  </span>;
}

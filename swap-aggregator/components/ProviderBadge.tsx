import Image from "next/image";
export function ProviderBadge({ provider }: { provider: "lifi" | "rango" }) {
  return <span className={`jumper-provider-brand ${provider}`}>
    {provider === "rango" ? <Image src="/tokens/rango.svg" alt="" width={18} height={18} unoptimized /> : <span className="jumper-lifi-mark" aria-hidden="true">↗</span>}
    {provider === "rango" ? "Rango" : "LI.FI"}
  </span>;
}

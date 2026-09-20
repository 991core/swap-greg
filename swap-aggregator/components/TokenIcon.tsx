"use client";
import Image from "next/image";
import { useState } from "react";
import type { AppToken } from "@/lib/tokens/types";
import { getCatalogToken } from "@/lib/tokens/catalog";
import { ChainIcon } from "./ChainIcon";

const variants: Record<string, string> = { WETH: "W", WBNB: "W", WAVAX: "W", cbBTC: "cb", BTCB: "B", XDAI: "x", USDT0: "0" };
export function TokenIcon({ token, network = false }: { token: AppToken | null; network?: boolean }) {
  const known = token ? getCatalogToken(token.chainId, token.address) : null;
  const src = known?.logoURI ?? (token?.logoURI?.startsWith("https://") ? token.logoURI : null);
  const [failed, setFailed] = useState<string | null>(null);
  const variant = known && variants[known.symbol];
  return <span className="jumper-token-icon" aria-hidden="true">
    {src && failed !== src ? <Image className="jumper-token-logo" src={src} alt="" width={36} height={36} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(src)} /> :
      <span className="jumper-token-logo placeholder">{(token?.symbol ?? "?").slice(0, 2)}</span>}
    {variant && <span className="jumper-token-variant">{variant}</span>}
    {network && token && <ChainIcon chainId={token.chainId} className="jumper-network-icon" size={16} />}
  </span>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChainSelect } from "./ChainSelect";
import { TokenIcon } from "./TokenIcon";
import { useI18n } from "@/lib/i18n";
import type { ExtendedChain } from "@lifi/sdk";
import type { AppToken } from "@/lib/lifi";
import { looksLikeAddress, resolveTokenByAddress } from "@/lib/contractTokenResolver";

/* ------------------------------------------------------------------ */
/*  TokenSelectModal  –  Jumper-style token picker                     */
/* ------------------------------------------------------------------ */

function formatUsd(value: number | undefined | string | null): string {
  if (value == null || value === 0 || value === "0" || value === "null") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num == null || isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(num);
}

interface TokenSelectModalProps {
  open: boolean;
  onClose: () => void;
  chains: ExtendedChain[];
  tokensByChain: Record<number, AppToken[]>;
  selectedChainId: number;
  selectedToken: AppToken | null;
  onSelect: (chainId: number, token: AppToken) => void;
  title: string;
}

export default function TokenSelectModal({
  open,
  onClose,
  chains,
  tokensByChain,
  selectedChainId,
  selectedToken,
  onSelect,
  title,
}: TokenSelectModalProps) {
  const { translate } = useI18n();

  const [query, setQuery] = useState("");
  const [contractToken, setContractToken] = useState<AppToken | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [chainFilter, setChainFilter] = useState<number | null>(null);

  const activeChainId = chainFilter ?? selectedChainId;

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setChainFilter(null); setQuery(""); }
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) { setContractToken(null); setIsResolving(false); return; }
    const trimmed = query.trim();
    if (!looksLikeAddress(trimmed)) { setContractToken(null); setIsResolving(false); return; }
    let cancelled = false;
    setContractToken(null);
    setIsResolving(true);
    (async () => {
      try {
        const resolved = await resolveTokenByAddress(activeChainId, trimmed);
        if (!cancelled && resolved) {
          setContractToken({
            address: resolved.address, chainId: resolved.chainId,
            decimals: resolved.decimals, name: resolved.name,
            symbol: resolved.symbol, topSymbol: resolved.symbol,
            priceUSD: resolved.priceUSD || "0",
            logoURI: resolved.logoURI || "",
          });
        } else if (!cancelled) { setContractToken(null); }
      } catch { if (!cancelled) setContractToken(null); }
      finally { if (!cancelled) setIsResolving(false); }
    })();
    return () => { cancelled = true; };
  }, [query, open, activeChainId]);

  const availableTokens = useMemo(() => {
    const list: AppToken[] = [];
    if (tokensByChain && activeChainId) list.push(...(tokensByChain[activeChainId] ?? []));
    return list;
  }, [tokensByChain, activeChainId]);

  const filteredTokens = useMemo(() => {
    if (!query.trim()) return availableTokens;
    const q = query.trim().toLowerCase();
    return availableTokens.filter(
      (t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.address.toLowerCase().includes(q),
    );
  }, [query, availableTokens]);

  useEffect(() => {
    if (open && contractToken && !looksLikeAddress(query.trim())) setContractToken(null);
  }, [query, open, contractToken]);

  const chainsByMap = useMemo(() => {
    const map = new Map<number, ExtendedChain>();
    chains.forEach((c) => map.set(c.id, c));
    return map;
  }, [chains]);

  if (!open) return null;

  return createPortal(<div className="jumper-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="jumper-modal-card" role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header className="jumper-modal-header"><h2>{title}</h2><button className="jumper-modal-close" type="button" aria-label={translate("modal_close")} onClick={onClose}>×</button></header>
      <div className="jumper-modal-search"><span>{translate("chains_label")}</span>
        <ChainSelect chainId={activeChainId} chains={chains} label={translate("chains_label")} onChange={(id) => { setChainFilter(id); setQuery(""); setContractToken(null); }} />
        <input ref={inputRef} aria-label={translate("search_placeholder")} placeholder={translate("search_placeholder")} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} autoComplete="off" spellCheck={false} />
      </div>
      <div className="jumper-token-list" aria-busy={isResolving}>
        {contractToken && <section className="jumper-resolved-block">
          <div className="jumper-token-review-title"><TokenIcon token={contractToken} network /><strong>{contractToken.symbol} · {contractToken.name}</strong></div>
          <p className="jumper-hint">{translate("contract_resolved")}</p><code>{contractToken.address}</code>
          <button type="button" className="jumper-refresh" onClick={() => { onSelect(contractToken.chainId, contractToken); setQuery(""); onClose(); }}>{contractToken.symbol} →</button>
        </section>}
        {filteredTokens.map((token) => {
          const selected = selectedToken?.chainId === token.chainId && selectedToken.address.toLowerCase() === token.address.toLowerCase();
          return <button key={token.address} type="button" className="jumper-token-row" aria-pressed={selected} onClick={() => { onSelect(token.chainId, token); setQuery(""); setContractToken(null); onClose(); }}>
            <TokenIcon token={token} network />
            <span className="jumper-token-row-info"><strong>{token.symbol}</strong><span>{token.name}</span><code title={token.address}>{token.address}</code></span>
            <span className="jumper-token-row-end"><span className="jumper-chain-badge">{chainsByMap.get(token.chainId)?.name}</span><span>{formatUsd(token.priceUSD)}</span><span aria-hidden="true">{selected ? "✓" : "↗"}</span></span>
          </button>;
        })}
        {!filteredTokens.length && !isResolving && <p className="jumper-hint">{translate("no_tokens_for_chain")}</p>}
        {isResolving && <p role="status" className="jumper-hint">{translate("searching_routes")}</p>}
      </div>
    </div>
  </div>, document.body);
}

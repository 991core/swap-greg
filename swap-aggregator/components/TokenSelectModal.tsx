"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExtendedChain } from "@lifi/sdk";
import type { AppToken } from "@/lib/lifi";
import { looksLikeAddress, resolveTokenByAddress } from "@/lib/contractTokenResolver";
import { useI18n } from "@/lib/i18n";

type Props = { open: boolean; onClose: () => void; chains: ExtendedChain[]; tokensByChain: Record<number, AppToken[]>; selectedChainId: number; selectedToken: AppToken | null; onSelect: (chainId: number, token: AppToken) => void; title: string };
export default function TokenSelectModal({ open, onClose, chains, tokensByChain, selectedChainId, selectedToken, onSelect, title }: Props) {
  const { translate } = useI18n();
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState(selectedChainId);
  const [contractToken, setContractToken] = useState<AppToken | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const available = tokensByChain[chainId] ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const knownAddress = available.some((token) => token.address.toLowerCase() === normalizedQuery);

  useEffect(() => {
    if (!open) return;
    setChainId(selectedChainId); setQuery(""); setContractToken(null); setLookupFailed(false);
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => { document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, [open, selectedChainId]);

  useEffect(() => {
    setContractToken(null); setLookupFailed(false); setIsResolving(false);
    if (!open || !looksLikeAddress(query) || knownAddress) return;
    let cancelled = false;
    setIsResolving(true);
    const timer = setTimeout(async () => {
      try {
        const token = await resolveTokenByAddress(chainId, query);
        if (cancelled) return;
        if (token) setContractToken({ ...token, logoURI: token.logoURI ?? "", priceUSD: token.priceUSD ?? "0", topSymbol: token.symbol });
        else setLookupFailed(true);
      } catch { if (!cancelled) setLookupFailed(true); }
      finally { if (!cancelled) setIsResolving(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, chainId, knownAddress]);
  if (!open) return null;
  const filtered = available.filter((token) => `${token.name} ${token.symbol} ${token.address}`.toLowerCase().includes(normalizedQuery));
  const resolved = contractToken?.chainId === chainId && contractToken.address.toLowerCase() === normalizedQuery ? contractToken : null;
  const select = (token: AppToken) => { onSelect(chainId, token); onClose(); };
  return createPortal(<div className="jumper-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="jumper-modal-card" role="dialog" aria-modal="true" aria-labelledby="token-modal-title" ref={dialog}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key !== "Tab") return;
        const focusable = dialog.current
          ? Array.from(dialog.current.querySelectorAll('button:not(:disabled), input, select, a[href]')) as HTMLElement[]
          : [];
        if (!focusable?.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <header className="jumper-modal-header"><h2 id="token-modal-title">{title}</h2><button className="jumper-modal-close" type="button" aria-label={translate("modal_close")} onClick={onClose}>×</button></header>
      <div className="jumper-modal-search"><label htmlFor="token-chain">{translate("chains_label")}</label>
        <select id="token-chain" value={chainId} onChange={(event) => { setChainId(Number(event.target.value)); setQuery(""); }}>{chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}</select>
        <input ref={input} aria-label={translate("search_placeholder")} placeholder={translate("search_placeholder")} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <div className="jumper-token-list">
        {filtered.map((token) => <button key={`${token.chainId}:${token.address}`} type="button" className="jumper-token-row" aria-pressed={selectedToken !== null && selectedToken.chainId === chainId && selectedToken.address.toLowerCase() === token.address.toLowerCase()} onClick={() => select(token)}>
          {token.logoURI ? <img src={token.logoURI} alt="" className="jumper-token-logo" loading="lazy" referrerPolicy="no-referrer" /> : <span className="jumper-token-logo placeholder">{token.symbol.slice(0, 2)}</span>}
          <span className="jumper-token-row-info"><strong>{token.symbol}</strong><span>{token.name}</span></span><span className="jumper-chain-badge">{chains.find((chain) => chain.id === chainId)?.name}</span>
        </button>)}
        {!filtered.length && !isResolving && !resolved && <p className="jumper-hint">{translate("no_tokens_for_chain")}</p>}
        {isResolving && <p role="status" className="jumper-hint">…</p>}
        {lookupFailed && <p role="status" className="jumper-warning">{translate("lookup_failed")}</p>}
        {resolved && <div className="jumper-resolved-block"><strong>{resolved.symbol} · {resolved.name}</strong><code>{resolved.address}</code><p className="jumper-warning">{translate("custom_token_warning")}</p><button type="button" className="jumper-refresh" onClick={() => select(resolved)}>{translate("confirm_token", { symbol: resolved.symbol })}</button></div>}
      </div>
    </div>
  </div>, document.body);
}

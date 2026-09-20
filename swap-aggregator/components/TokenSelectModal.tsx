"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExtendedChain } from "@lifi/sdk";
import { APP_CHAINS } from "@/lib/chains";
import { searchTokens } from "@/lib/tokens/client";
import { SEARCH_LIMITS, TokenSearchError, type AppToken, type TokenSearchResult, type TokenSearchErrorCode } from "@/lib/tokens/types";
import { isKnownNativeToken, requiresTokenConfirmation, tokenKey, tokenVerification, uniqueTokens } from "@/lib/tokens/validation";
import { useI18n } from "@/lib/i18n";

type Props = { open: boolean; onClose: () => void; chains: ExtendedChain[]; tokensByChain: Record<number, AppToken[]>; selectedChainId: number; selectedToken: AppToken | null; onSelect: (chainId: number, token: AppToken) => void; title: string };
type SearchState = { key: string; loading: boolean; result?: TokenSearchResult; error?: TokenSearchErrorCode };
export default function TokenSelectModal({ open, onClose, chains, tokensByChain, selectedChainId, selectedToken, onSelect, title }: Props) {
  const { translate } = useI18n();
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState(selectedChainId);
  const [limit, setLimit] = useState<number>(SEARCH_LIMITS[0]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState | null>(null);
  const [confirmation, setConfirmation] = useState<{ key: string; token: AppToken } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const consent = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const requestKey = chainId + ":" + normalizedQuery + ":" + limit;
  const current = state?.key === requestKey ? state : null;
  const loading = !current || current.loading;
  const pendingToken = confirmation?.key === requestKey ? confirmation.token : null;
  const chainName = chains.find((chain) => chain.id === chainId)?.name ?? String(chainId);
  const explorer = APP_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;

  useEffect(() => {
    if (!open) return;
    setChainId(selectedChainId); setQuery(""); setLimit(SEARCH_LIMITS[0]); setState(null);
    setConfirmation(null); setAcknowledged(false);
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => { document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, [open, selectedChainId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ key: requestKey, loading: true });
    const timer = setTimeout(async () => {
      try {
        const result = await searchTokens(chainId, normalizedQuery, { limit, signal: controller.signal });
        if (!controller.signal.aborted) setState({ key: requestKey, loading: false, result });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key: requestKey, loading: false, error: error instanceof TokenSearchError ? error.code : "tokens_unavailable" });
      }
    }, normalizedQuery ? 300 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, chainId, normalizedQuery, limit, requestKey, retry]);

  useEffect(() => { if (pendingToken) consent.current?.focus(); }, [pendingToken]);

  if (!open) return null;
  const found = current?.result?.tokens ?? [];
  const initial = normalizedQuery ? [] : (tokensByChain[chainId] ?? []).filter((token) => token.chainId === chainId && !found.some((item) => tokenKey(item) === tokenKey(token)));
  const tokens = uniqueTokens([...found, ...initial]);
  const select = (token: AppToken) => {
    if (token.chainId !== chainId || tokenVerification(token) === "flagged") return;
    onSelect(chainId, token); onClose();
  };
  const choose = (token: AppToken) => {
    if (requiresTokenConfirmation(token)) { setAcknowledged(false); setConfirmation({ key: requestKey, token }); }
    else select(token);
  };
  const resetConfirmation = () => { setConfirmation(null); setAcknowledged(false); };
  return createPortal(<div className="jumper-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="jumper-modal-card" role="dialog" aria-modal="true" aria-labelledby="token-modal-title" ref={dialog}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key !== "Tab") return;
        const focusable = dialog.current
          ? Array.from(dialog.current.querySelectorAll('button:not(:disabled), input, select, a[href]')) as HTMLElement[]
          : [];
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <header className="jumper-modal-header"><h2 id="token-modal-title">{title}</h2><button className="jumper-modal-close" type="button" aria-label={translate("modal_close")} onClick={onClose}>×</button></header>
      <div className="jumper-modal-search"><label htmlFor="token-chain">{translate("chains_label")}</label>
        <select id="token-chain" value={chainId} onChange={(event) => { setChainId(Number(event.target.value)); setQuery(""); setLimit(SEARCH_LIMITS[0]); resetConfirmation(); }}>{chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}</select>
        <input ref={input} aria-label={translate("search_placeholder")} placeholder={translate("search_placeholder")} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(SEARCH_LIMITS[0]); resetConfirmation(); }} maxLength={100} autoComplete="off" spellCheck={false} />
      </div>
      <div className="jumper-token-list" aria-busy={loading}>
        {pendingToken ? <section className="jumper-resolved-block" aria-label={translate("token_review")}>
          <strong>{pendingToken.symbol} · {pendingToken.name}</strong>
          <p>{chainName}</p><code>{pendingToken.address}</code>
          {explorer && <a href={explorer + "/address/" + pendingToken.address} target="_blank" rel="noopener noreferrer">{translate("view_contract")} ↗</a>}
          <p className="jumper-warning">{translate("custom_token_warning")}</p>
          <label className="jumper-token-consent"><input ref={consent} type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{translate("token_acknowledge")}</label>
          <div className="jumper-token-actions"><button type="button" className="jumper-refresh" onClick={resetConfirmation}>{translate("token_back")}</button>
            <button type="button" className="jumper-refresh" disabled={!acknowledged} onClick={() => { if (acknowledged) select({ ...pendingToken, riskAcknowledged: true }); }}>{translate("confirm_token", { symbol: pendingToken.symbol })}</button></div>
        </section> : <>
          <p className="jumper-hint">{translate(normalizedQuery ? "token_search_results" : "popular_tokens")}</p>
          {tokens.map((token) => {
            const status = tokenVerification(token);
            return <button key={tokenKey(token)} type="button" className="jumper-token-row" disabled={status === "flagged"} aria-pressed={selectedToken !== null && tokenKey(selectedToken) === tokenKey(token)} onClick={() => choose(token)}>
              {token.logoURI ? <img src={token.logoURI} alt="" className="jumper-token-logo" loading="lazy" referrerPolicy="no-referrer" /> : <span className="jumper-token-logo placeholder">{token.symbol.slice(0, 2)}</span>}
              <span className="jumper-token-row-info"><strong>{token.symbol}</strong><span>{token.name}</span>
                <code>{isKnownNativeToken(token) ? translate("native_asset") : token.address}</code>
                <span className={"jumper-token-verification " + status}>{translate(status === "flagged" ? "token_flagged" : isKnownNativeToken(token) ? "native_asset" : status === "verified" ? "token_verified" : "token_unverified")}</span>
              </span><span className="jumper-chain-badge">{chainName}</span>
            </button>;
          })}
          {!tokens.length && !loading && !current?.error && <p className="jumper-hint">{translate("no_tokens_for_chain")}</p>}
          {loading && <p role="status" className="jumper-hint">{translate("tokens_searching")}</p>}
          {current?.error && <div role="status" className="jumper-warning"><p>{translate(current.error)}</p>
            {!["invalid_search", "invalid_address"].includes(current.error) && <button type="button" className="jumper-refresh" onClick={() => setRetry((old) => old + 1)}>{translate("token_retry")}</button>}</div>}
          {current?.result?.hasMore && <button type="button" className="jumper-refresh" onClick={() => setLimit(SEARCH_LIMITS.find((value) => value > limit) ?? limit)}>{translate("tokens_more")}</button>}
          {current?.result?.truncated && !current.result.hasMore && <p className="jumper-hint">{translate("tokens_refine")}</p>}
        </>}
        <p className="jumper-hint">{translate("token_route_hint")}</p>
      </div>
    </div>
  </div>, document.body);
}

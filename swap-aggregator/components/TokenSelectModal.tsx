"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
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
  const { address } = useAccount();

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

  return (
    <>
      <div
        role="presentation"
        className="jumper-modal-overlay"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        {/* Modal card */}
        <div
          className="jumper-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Header */}
          <div className="jumper-modal-header">
            <h2 className="jumper-modal-title">{title}</h2>
            <button
              onClick={onClose}
              className="jumper-modal-close"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="jumper-modal-content" style={{ maxHeight: "70vh" }}>
            {/* Chain + Search */}
            <div className="jumper-modal-controls">
              {/* Chain selector */}
              <div className="jumper-chain-select-row">
                <label className="jumper-hint" htmlFor="jumper-chain-select">Chain</label>
                <select
                  id="jumper-chain-select"
                  value={activeChainId}
                  onChange={(e) => setChainFilter(Number(e.target.value))}
                  className="jumper-chain-select"
                >
                  {chains.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div className="jumper-search-wrap">
                <span className="jumper-search-icon">🔍</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, symbol, or paste address…"
                  className="jumper-search-input"
                  autoComplete="off"
                  spellCheck={false}
                />
                {isResolving && (
                  <span className="jumper-search-loading" aria-hidden>⋯</span>
                )}
              </div>

              {/* Contract resolution result */}
              {contractToken && (
                <div className="jumper-resolved-block">
                  <p className="jumper-resolved-label">✓ Contract resolved</p>
                  <p className="jumper-resolved-info">
                    {contractToken.symbol} — {contractToken.name}
                  </p>
                  <p className="jumper-resolved-addr">
                    {contractToken.address}
                  </p>
                  <button
                    onClick={() => {
                      onSelect(contractToken.chainId, contractToken);
                      setQuery(""); onClose();
                    }}
                    className="jumper-resolved-btn"
                  >
                    Select {contractToken.symbol}
                  </button>
                </div>
              )}
            </div>

            {/* Token list */}
            <div className="jumper-token-scroll">
              {filteredTokens.length === 0 ? (
                <div className="jumper-modal-empty">
                  <span className="jumper-empty-icon">🪙</span>
                  <p className="jumper-hint">No tokens found</p>
                  <p className="jumper-hint" style={{ marginTop: 4, fontSize: 11 }}>Try a different search term</p>
                </div>
              ) : (
                <div className="jumper-token-list">
                  {filteredTokens.map((token) => {
                    const chain = chainsByMap.get(token.chainId);
                    return (
                      <button
                        key={token.address}
                        onClick={() => {
                          onSelect(token.chainId, token);
                          setQuery(""); setContractToken(null); onClose();
                        }}
                        className="jumper-token-row"
                      >
                        {/* Logo */}
                        <img
                          src={token.logoURI}
                          alt={token.symbol}
                          className="jumper-token-row-logo"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        {/* Info */}
                        <div className="jumper-token-row-info">
                          <span className="jumper-token-row-symbol">{token.symbol}</span>
                          <span className="jumper-token-row-name">{token.name}</span>
                        </div>
                        {/* Right side */}
                        <div className="jumper-token-row-right">
                          {chain && <span className="jumper-chain-badge">{chain.name}</span>}
                          {token.priceUSD && formatUsd(token.priceUSD) !== "—" && (
                            <span className="jumper-token-price">{formatUsd(token.priceUSD)}</span>
                          )}
                          <span className="jumper-token-row-arrow">›</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="jumper-modal-footer">
              <p className="jumper-footer-hint">Paste a contract address to auto-resolve</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

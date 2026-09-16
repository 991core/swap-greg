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

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) { setContractToken(null); setIsResolving(false); return; }
    const trimmed = query.trim();
    if (!looksLikeAddress(trimmed)) { setContractToken(null); return; }
    let cancelled = false;
    setIsResolving(true);
    (async () => {
      try {
        const resolved = await resolveTokenByAddress(selectedChainId, trimmed);
        if (!cancelled && resolved) {
          setContractToken({
            address: resolved.address, chainId: resolved.chainId,
            decimals: resolved.decimals, name: resolved.name,
            symbol: resolved.symbol, topSymbol: resolved.symbol,
            priceUSD: resolved.priceUSD || "0",
            logoURI: resolved.logoURI || "",
          });
        } else { setContractToken(null); }
      } catch { if (!cancelled) setContractToken(null); }
      finally { if (!cancelled) setIsResolving(false); }
    })();
    return () => { cancelled = true; };
  }, [query, open, selectedChainId]);

  const availableTokens = useMemo(() => {
    const list: AppToken[] = [];
    if (tokensByChain && selectedChainId) list.push(...(tokensByChain[selectedChainId] ?? []));
    return list;
  }, [tokensByChain, selectedChainId]);

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
      <style>{`
        @keyframes jumperModal_fadeIn {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        role="presentation"
        aria-hidden
        className="fixed inset-0 z-[9999] flex items-start justify-center p-4 pt-[10vh] sm:pt-16"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        style={{ animation: "jumperModal_fadeIn 0.2s ease-out" }}
      >
        {/* Dim overlay */}
        <div className="fixed inset-0 bg-jumper-overlay" />

        {/* Modal card */}
        <div
          className="relative z-[10000] flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-jumper-border bg-jumper-card shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          style={{ animation: "jumperModal_fadeIn 0.2s ease-out" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-jumper-border px-5 py-3">
            <h2 className="text-sm font-semibold text-jumper-fg">{title}</h2>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-jumper-muted transition-colors hover:bg-jumper-card-hover hover:text-jumper-fg"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="flex flex-col" style={{ maxHeight: "70vh" }}>
            {/* Chain + Search */}
            <div className="flex flex-col gap-3 px-4 pt-4">
              {/* Chain selector */}
              <div className="jumper-chain-select-row">
                <label className="jumper-hint" htmlFor="jumper-chain-select">Chain</label>
                <select
                  id="jumper-chain-select"
                  value={selectedChainId}
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
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {filteredTokens.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
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
            <div className="border-t border-jumper-border/60 px-4 py-2.5">
              <p className="jumper-footer-hint">Paste a contract address to auto-resolve</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

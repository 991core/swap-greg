"use client";

import { useCallback, useState } from "react";
import type { ExtendedChain } from "@lifi/sdk";
import { useAccount, useSwitchChain } from "wagmi";

const CHAIN_ICONS: Record<number, string> = {
  1: "🔵",
  10: "🔴",
  56: "🟡",
  137: "🟣",
  8453: "🔵",
  42161: "🔵",
  43114: "🔴",
  250: "🟢",
  13371: "🟠",
  18686: "🟣",
};

interface SidebarProps {
  chains: ExtendedChain[];
  fromChainId: number;
  toChainId: number;
  onFromChainSelect: (chainId: number) => void;
  onToChainSelect: (chainId: number) => void;
}

export function SidebarNav({
  chains,
  fromChainId,
  toChainId,
  onFromChainSelect,
  onToChainSelect,
}: SidebarProps) {
  const { chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [expanded, setExpanded] = useState<"from" | "to" | null>(null);
  const [query, setQuery] = useState("");

  const handleChainClick = useCallback(
    async (chainId: number) => {
      if (walletChain !== chainId && switchChainAsync) {
        try {
          await switchChainAsync({ chainId });
        } catch {
          // ignore — wallet rejected
        }
      }
      setExpanded(null);
      setQuery("");
    },
    [walletChain, switchChainAsync],
  );

  const filtered = query
    ? chains.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || String(c.id).includes(query))
    : chains;

  // Sort: connected first, then by id
  const sorted = [...filtered].sort((a, b) => {
    if (a.id === walletChain) return -1;
    if (b.id === walletChain) return 1;
    return a.id - b.id;
  });

  return (
    <div className="jumper-sidebar">
      {/* Chain list */}
      <div className="jumper-sidebar-scroll">
        <button
          onClick={() => setExpanded((e) => (e === "from" ? null : "from"))}
          className="jumper-sidebar-group"
        >
          <span className="jumper-sidebar-label">From</span>
          <span className="jumper-sidebar-chevron">{expanded === "from" ? "▴" : "▾"}</span>
        </button>
        {expanded === "from" && (
          <div className="jumper-sidebar-options">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter chains…"
              className="jumper-sidebar-search"
            />
            {sorted.map((chain) => {
              const isActive = fromChainId === chain.id;
              const isWallet = walletChain === chain.id;
              return (
                <button
                  key={`from-${chain.id}`}
                  onClick={() => void handleChainClick(chain.id)}
                  className={`jumper-chain-row${isActive ? " jumper-chain-active" : ""}`}
                >
                  <span className="jumper-chain-row-icon">
                    {CHAIN_ICONS[chain.id] ?? "🔗"}
                  </span>
                  <span className="jumper-chain-row-name">{chain.name}</span>
                  <span className="jumper-chain-row-id">{chain.id}</span>
                  {isWallet && <span className="jumper-chain-wallet-label">Wallet</span>}
                  {isActive && <span className="jumper-chain-active-label">Active</span>}
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => setExpanded((e) => (e === "to" ? null : "to"))}
          className="jumper-sidebar-group"
        >
          <span className="jumper-sidebar-label">To</span>
          <span className="jumper-sidebar-chevron">{expanded === "to" ? "▴" : "▾"}</span>
        </button>
        {expanded === "to" && (
          <div className="jumper-sidebar-options">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter chains…"
              className="jumper-sidebar-search"
            />
            {sorted.map((chain) => {
              const isActive = toChainId === chain.id;
              const isWallet = walletChain === chain.id;
              return (
                <button
                  key={`to-${chain.id}`}
                  onClick={() => void handleChainClick(chain.id)}
                  className={`jumper-chain-row${isActive ? " jumper-chain-active" : ""}`}
                >
                  <span className="jumper-chain-row-icon">
                    {CHAIN_ICONS[chain.id] ?? "🔗"}
                  </span>
                  <span className="jumper-chain-row-name">{chain.name}</span>
                  <span className="jumper-chain-row-id">{chain.id}</span>
                  {isWallet && <span className="jumper-chain-wallet-label">Wallet</span>}
                  {isActive && <span className="jumper-chain-active-label">Active</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

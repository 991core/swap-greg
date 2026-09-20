"use client";
import { useEffect, useId, useRef, useState } from "react";
import { APP_CHAINS, CHAIN_LABELS } from "@/lib/chains";
import { ChainIcon } from "./ChainIcon";

type Props = { chainId: number; onChange: (chainId: number) => void; label: string;
  chains?: ReadonlyArray<{ id: number; name: string }>; disabled?: boolean };
export function ChainSelect({ chainId, onChange, label, chains = APP_CHAINS, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const name = (id: number) => CHAIN_LABELS[id] ?? chains.find(chain => chain.id === id)?.name ?? String(id);
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    options.current[Math.max(0, chains.findIndex(chain => chain.id === chainId))]?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, chainId, chains]);
  return <div className="jumper-chain-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }}>
    <button ref={trigger} type="button" className="jumper-chain-trigger" role="combobox" aria-label={`${label}: ${name(chainId)}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}><ChainIcon chainId={chainId} size={20} /><span>{name(chainId)}</span><span className="jumper-chevron" aria-hidden="true">⌄</span></button>
    {open && <div id={id} className="jumper-chain-menu" role="listbox" aria-label={label} onKeyDown={event => {
      const current = options.current.indexOf(document.activeElement as HTMLButtonElement);
      const target = event.key === "ArrowDown" ? (current + 1) % chains.length : event.key === "ArrowUp" ? (current - 1 + chains.length) % chains.length : event.key === "Home" ? 0 : event.key === "End" ? chains.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); options.current[target]?.focus(); }
    }}>
      {chains.map((chain, index) => <button key={chain.id} ref={node => { options.current[index] = node; }} type="button"
        role="option" aria-selected={chain.id === chainId} tabIndex={chain.id === chainId ? 0 : -1}
        onClick={() => { onChange(chain.id); close(true); }}><ChainIcon chainId={chain.id} /><span>{name(chain.id)}</span><span aria-hidden="true">{chain.id === chainId ? "✓" : ""}</span></button>)}
    </div>}
  </div>;
}

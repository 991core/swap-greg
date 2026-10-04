"use client";
import { useEffect, useId, useRef, useState } from "react";
import { APP_CHAINS, CHAIN_LABELS } from "@/lib/chains";
import { useI18n } from "@/lib/i18n";
import { ChainIcon } from "./ChainIcon";

type Props = { chainId: number; onChange: (chainId: number) => void; label: string;
  chains?: ReadonlyArray<{ id: number; name: string }>; disabled?: boolean };
export function ChainSelect({ chainId, onChange, label, chains = APP_CHAINS, disabled = false }: Props) {
  const { translate } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const name = (id: number) => CHAIN_LABELS[id] ?? chains.find(chain => chain.id === id)?.name ?? String(id);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = chains.filter(chain => normalize(`${name(chain.id)} ${chain.name} ${chain.id}`).includes(normalize(query.trim())));
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus(); }
  function choose(id: number) { onChange(id); close(true); }
  useEffect(() => {
    if (!open) return;
    setQuery("");
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="jumper-chain-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }}>
    <button ref={trigger} type="button" className="jumper-chain-trigger" aria-label={`${label}: ${name(chainId)}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}><ChainIcon chainId={chainId} size={20} /><span>{name(chainId)}</span><span className="jumper-chevron" aria-hidden="true">⌄</span></button>
    {open && <div id={id} className="jumper-chain-menu" role="dialog" aria-label={label}>
      <input ref={search} className="jumper-chain-search" type="search" role="combobox" aria-label={translate("chain_search")}
        aria-controls={`${id}-options`} aria-expanded="true" aria-autocomplete="list" placeholder={translate("chain_search")} value={query}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); options.current[event.key === "ArrowDown" ? 0 : filtered.length - 1]?.focus();
          } else if (event.key === "Enter" && filtered[0]) { event.preventDefault(); choose(filtered[0].id); }
        }} />
      <div id={`${id}-options`} role="listbox" aria-label={label} onKeyDown={event => {
        if (!filtered.length) return;
        const current = options.current.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === "ArrowDown" ? (current + 1) % filtered.length : event.key === "ArrowUp" ? (current - 1 + filtered.length) % filtered.length : event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : -1;
        if (target >= 0) { event.preventDefault(); options.current[target]?.focus(); }
      }}>
        {filtered.map((chain, index) => <button key={chain.id} ref={node => { options.current[index] = node; }} type="button"
          role="option" aria-selected={chain.id === chainId} tabIndex={index === 0 ? 0 : -1}
          onClick={() => choose(chain.id)}><ChainIcon chainId={chain.id} /><span>{name(chain.id)}</span><span aria-hidden="true">{chain.id === chainId ? "✓" : ""}</span></button>)}
      </div>
      {!filtered.length && <p className="jumper-hint" role="status">{translate("chain_no_results")}</p>}
    </div>}
  </div>;
}

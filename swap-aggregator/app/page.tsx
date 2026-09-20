"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit/components";
import { SwapCard } from "@/components/SwapCard";
import { useI18n, LANGUAGES, type Lang } from "@/lib/i18n";

export default function Home() {
  const { translate, lang, setLang } = useI18n();
  return (
    <div className="jumper-app">
      <header className="jumper-header">
        <div className="jumper-brand">
          <span className="jumper-logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><path d="M7 8v16M25 8v16M7 16h18M3 8h8M21 8h8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path d="m12 7 4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="jumper-name">Hermes</span>
          <span className="jumper-tag">Cross-chain</span>
        </div>
        <div className="jumper-header-right">
          <div className="jumper-lang-switcher" role="group" aria-label={lang === "fr" ? "Langue" : "Language"}>
            {Object.entries(LANGUAGES).map(([code, label]) => (
              <button key={code} type="button" className="jumper-lang-btn" aria-label={label}
                aria-pressed={lang === code} onClick={() => setLang(code as Lang)}>{code.toUpperCase()}</button>
            ))}
          </div>
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      </header>
      <main className="jumper-main">
        <div className="jumper-welcome">
          <h1 className="jumper-hero-title">{translate("hero_title")}</h1>
          <p className="jumper-hero-subtitle">{translate("hero_subtitle")}</p>
        </div>
        <div className="jumper-widget-wrapper">
          <div className="jumper-widget-card"><SwapCard /></div>
        </div>
      </main>
      <footer className="jumper-footer">Hermes <span aria-hidden="true">·</span> LI.FI + Rango</footer>
    </div>
  );
}

"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit/components";
import { SwapCard } from "@/components/SwapCard";
import { useI18n, LANGUAGES, type Lang } from "@/lib/i18n";

export default function Home() {
  const { translate, lang, setLang } = useI18n();
  return <ConnectButton.Custom>{({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => (
    <div className="jumper-app">
      <header className="jumper-header">
        <a className="jumper-brand" href="#main" aria-label="Hermes">
          <svg className="jumper-logo" viewBox="0 0 64 40" fill="none" aria-hidden="true">
            <path d="M2 9h27l-4 6H8zm7 11h14l-4 6h-4zM35 4h9l-5 13h10l5-13h9L50 36h-9l5-12H36l-5 12h-9z" fill="currentColor" />
          </svg>
          <span className="jumper-name">HERMES</span>
        </a>
        <div className="jumper-header-right">
          <div id="hermes-currency-slot" />
          <div className="jumper-lang-switcher" role="group" aria-label={lang === "fr" ? "Langue" : "Language"}>
            {Object.entries(LANGUAGES).map(([code, name]) => <button key={code} type="button" className="jumper-lang-btn"
              aria-label={name} aria-pressed={lang === code} onClick={() => setLang(code as Lang)}>{code.toUpperCase()}</button>)}
          </div>
          <button type="button" className="jumper-wallet-button" disabled={!mounted}
            onClick={!account ? openConnectModal : chain?.unsupported ? openChainModal : openAccountModal}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 6h-5v4h5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
            <span>{!mounted || !account ? translate("cta_connect_wallet") : chain?.unsupported ? translate("wallet_network") : account.displayName}</span>
            {account && <span aria-hidden="true">⌄</span>}
          </button>
        </div>
      </header>
      <main id="main" className="jumper-main">
        <h1 className="jumper-sr-only">Hermes · {translate("swap_title")}</h1>
        <div className="jumper-widget-wrapper"><div className="jumper-widget-card"><SwapCard onConnect={mounted ? openConnectModal : undefined} /></div></div>
      </main>
      <footer className="jumper-footer"><span>Hermes · Cross-chain swaps</span><span>LI.FI + Rango</span></footer>
    </div>
  )}</ConnectButton.Custom>;
}

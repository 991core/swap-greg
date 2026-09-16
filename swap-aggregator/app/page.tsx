"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { SwapCard } from "@/components/SwapCard";
import { useI18n, LANGUAGES, type Lang } from "@/lib/i18n";
import { useState } from "react";

export default function Home() {
  const { translate, lang, setLang } = useI18n();
  const [activeNav, setActiveNav] = useState("swap");

  const navItems = [
    { id: "swap", label: translate("nav_swap"), icon: "⇅" },
  ];

  return (
    <div className="jumper-app">
      {/* Header */}
      <header className="jumper-header">
        <div className="jumper-brand">
          <span className="jumper-logo">⚡</span>
          <span className="jumper-name">SwapAggregator</span>
          <span className="jumper-tag">Aggregator</span>
        </div>

        <nav className="jumper-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`jumper-nav-btn ${activeNav === item.id ? "active" : ""}`}
              onClick={() => setActiveNav(item.id)}
            >
              <span className="jumper-nav-icon">{item.icon}</span>
              <span className="jumper-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="jumper-header-right">
          <div className="jumper-lang-switcher">
            {Object.entries(LANGUAGES).map(([code, label]) => (
              <button
                key={code}
                className={`jumper-lang-btn ${lang === code ? "active" : ""}`}
                onClick={() => setLang(code as Lang)}
              >
                {label}
              </button>
            ))}
          </div>

          <ConnectButton />
        </div>
      </header>

      {/* Main */}
      <main className="jumper-main">
        {/* Welcome / Hero */}
        {activeNav === "swap" && (
          <div className="jumper-welcome">
            <div className="jumper-glow"></div>
            <h1 className="jumper-hero-title">{translate("hero_title")}</h1>
            <p className="jumper-hero-subtitle">{translate("hero_subtitle")}</p>
          </div>
        )}

        {/* Widget wrapper */}
        {activeNav === "swap" && (
          <div className="jumper-widget-wrapper">
            <div className="jumper-widget-card">
              <SwapCard />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="jumper-footer">
        © 2025 SwapAggregator · Powered by LI.FI, Rango & Socket
      </footer>
    </div>
  );
}

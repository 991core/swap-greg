"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "fr";

export const LANGUAGES: Record<Lang, string> = {
  en: "English",
  fr: "Français",
};

function detectBrowserLang(): Lang {
  if (typeof navigator !== "undefined" && navigator.language) {
    const code = navigator.language.slice(0, 2).toLowerCase();
    if (code === "fr") return "fr";
  }
  return "en";
}

type TranslationKey =
  | "hero_tagline"
  | "boot_loading"
  | "boot_no_chains"
  | "boot_no_tokens"
  | "boot_failed"
  | "from_label"
  | "to_label"
  | "connect_wallet_cta"
  | "searching_routes"
  | "executing"
  | "no_routes"
  | "swap_cta"
  | "connect_to_continue"
  | "swap_failed"
  | "routes_fetch_failed"
  | "lifi_error"
  | "route_no_payload"
  | "swap_exec_error"
  | "swap_cta"
  | "route_list_title"
  | "cta_swap"
  | "cta_connect_wallet"
  | "cta_searching"
  | "cta_executing"
  | "cta_no_route"
  | "send_label"
  | "receive_label"
  | "max_label"
  | "invert_label"
  | "received_value_prefix"
  | "currency_label"
  | "currency_toggle"
  | "providers_label"
  | "route_list_title"
  | "routes_available"
  | "route_estimated_time"
  | "route_estimated_value"
  | "route_source"
  | "modal_title"
  | "owned_tokens_title"
  | "tokens_title"
  | "modal_close"
  | "chains_label"
  | "chains_no_chains"
  | "wallet_balance"
  | "search_placeholder"
  | "no_tokens_for_chain"
  | "contract_resolved"
  | "search_result"
  | "metadata_description"
  | "nav_swap"
  | "hero_title"
  | "hero_subtitle";

const translations: Record<Lang, Record<TranslationKey, string>> = {
  en: {
    hero_tagline: "Top 20 market cap · transparent routes · fees included in net amount.",
    boot_loading: "Loading chains and top 20…",
    boot_no_chains: "LI.FI is not returning any supported chains. Try again later.",
    boot_no_tokens: "No top-20 token found via LI.FI on the configured chains.",
    boot_failed: "Unable to load chains and tokens from LI.FI.",
    from_label: "You send",
    to_label: "You receive",
    connect_wallet_cta: "Connect your wallet",
    searching_routes: "Searching routes…",
    executing: "Executing…",
    no_routes: "No routes",
    cta_swap: "Swap",
    cta_connect_wallet: "Connect your wallet",
    cta_searching: "Searching routes…",
    cta_executing: "Executing…",
    cta_no_route: "Select a route",
    connect_to_continue: "Connect a wallet to continue.",
    swap_failed: "Swap execution failed. Check your wallet, network, and funds. Detail: {detail}",
    swap_cta: "Swap",
    route_list_title: "Best routes",
    routes_fetch_failed: "Failed to load swap routes.",
    lifi_error: "LI.FI error: {message}",
    route_no_payload: "This route cannot be executed because it has no LI.FI payload.",
    swap_exec_error: "An error occurred while executing the swap.",
    send_label: "You send",
    receive_label: "You receive",
    max_label: "Max",
    invert_label: "Invert",
    received_value_prefix: "Value received:",
    currency_label: "Currency",
    currency_toggle: "Switch to {to}",
    providers_label: "Providers",
    routes_available: "Available routes",
    route_estimated_time: "Estimated time {duration}",
    route_estimated_value: "Estimated value",
    route_source: "Source",
    modal_title: "Select a token",
    owned_tokens_title: "Tokens owned",
    tokens_title: "Tokens",
    modal_close: "Close",
    chains_label: "Chains",
    chains_no_chains: "No chains available via LI.FI.",
    wallet_balance: "Wallet balance: {count} active",
    search_placeholder: "Search a token…",
    no_tokens_for_chain: "No tokens available for this selection.",
    contract_resolved: "Resolved by contract address",
    search_result: "External search result",
    metadata_description:
      "Swap and bridge cross-chain with transparent fees. Top 20 market cap.",
    nav_swap: "Swap",
    hero_title: "Cross-chain swaps, made simple",
    hero_subtitle: "Compare routes from top DEXs in one click.",
  },
  fr: {
    hero_tagline:
      "Top 20 market cap · routes transparentes · frais inclus dans le montant net.",
    boot_loading: "Chargement des chaînes et du top 20…",
    boot_no_chains: "LI.FI ne renvoie aucune chaîne supportée. Réessaie plus tard.",
    boot_no_tokens: "Aucun token du top 20 trouvé via LI.FI sur les chaînes configurées.",
    boot_failed: "Impossible de charger chaînes et tokens depuis LI.FI.",
    from_label: "Vous envoyez",
    to_label: "Vous recevez",
    connect_wallet_cta: "Connecte ton wallet",
    searching_routes: "Recherche de routes…",
    executing: "Exécution…",
    no_routes: "Aucune route",
    cta_swap: "Swap",
    cta_connect_wallet: "Connecte ton wallet",
    cta_searching: "Recherche de routes…",
    cta_executing: "Exécution…",
    cta_no_route: "Sélectionne une route",
    connect_to_continue: "Connecte un wallet pour continuer.",
    swap_failed:
      "L'exécution du swap a échoué. Vérifie le wallet, le réseau et les fonds. Détail : {detail}",
    swap_cta: "Swap",
    route_list_title: "Meilleures routes",
    routes_fetch_failed: "Échec du chargement des routes de swap.",
    lifi_error: "Erreur LI.FI : {message}",
    route_no_payload:
      "Cette route ne peut pas être exécutée car elle n'a pas de payload LI.FI associé.",
    swap_exec_error: "Une erreur est survenue lors de l'exécution du swap.",
    send_label: "Vous envoyez",
    receive_label: "Vous recevez",
    max_label: "Max",
    invert_label: "Inverser",
    received_value_prefix: "Valeur reçue :",
    currency_label: "Devise",
    currency_toggle: "Passer en {to}",
    providers_label: "Fournisseurs",
    routes_available: "Routes disponibles",
    route_estimated_time: "Temps estimé {duration}",
    route_estimated_value: "Valeur estimée",
    route_source: "Source",
    modal_title: "Sélectionner un token",
    owned_tokens_title: "Tokens possédés",
    tokens_title: "Tokens",
    modal_close: "Fermer",
    chains_label: "Chaînes",
    chains_no_chains: "Aucune chaîne disponible via LI.FI.",
    wallet_balance: "Solde du portefeuille : {count} actif(s)",
    search_placeholder: "Rechercher un token…",
    no_tokens_for_chain: "Aucun token disponible pour cette sélection.",
    contract_resolved: "Résolu par adresse de contrat",
    search_result: "Résultat de recherche externe",
    metadata_description:
      "Swap et bridge cross-chain avec frais transparents. Top 20 market cap.",
    nav_swap: "Swap",
    hero_title: "Swaps cross-chain, simplifiés",
    hero_subtitle: "Comparez les routes des principaux DEX en un clic.",
  },
};

export function t(key: TranslationKey, lang: Lang): string {
  return translations[lang][key];
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  translate: (key: TranslationKey, params?: Record<string, string>) => string;
  detectBrowserLang: () => Lang;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = typeof localStorage !== "undefined" && localStorage.getItem("hermes-lang");
    if (saved === "en" || saved === "fr") {
      setLangState(saved);
    } else {
      setLangState(detectBrowserLang());
    }
  }, []);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hermes-lang", newLang);
    }
  };

  const translate = (key: TranslationKey, params?: Record<string, string>) => {
    let result = t(key, lang);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, v);
      });
    }
    return result;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, translate, detectBrowserLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

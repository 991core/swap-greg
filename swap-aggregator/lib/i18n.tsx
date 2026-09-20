"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

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
  | "hero_subtitle"
  | "provider_soon"
  | "amount_invalid"
  | "insufficient_balance"
  | "insufficient_gas"
  | "balance_unavailable"
  | "quotes_refresh_in" | "quotes_refreshing" | "quotes_retry_in" | "quotes_suspended" | "quotes_waiting"
  | "refresh_quotes"
  | "quote_changed"
  | "same_token"
  | "platform_fee"
  | "network_fee"
  | "minimum_received"
  | "slippage_label"
  | "fee_included"
  | "fee_additional"
  | "fx_unavailable"
  | "fx_reference"
  | "swap_success"
  | "wallet_history"
  | "lookup_failed"
  | "custom_token_warning"
  | "confirm_token"
  | "native_gas_hint"
  | "source_token"
  | "destination_token"
  | "no_routes_hint"
  | "execution_progress"
  | "popular_tokens" | "token_search_results" | "tokens_searching" | "tokens_more" | "tokens_refine"
  | "token_verified" | "token_unverified" | "token_flagged" | "native_asset" | "token_catalog" | "tokens_browse"
  | "token_review" | "view_contract" | "token_acknowledge" | "token_back" | "token_retry" | "token_route_hint"
  | "invalid_search" | "invalid_address" | "rate_limited" | "tokens_unavailable"
  | "token_blocked" | "token_metadata_changed" | "token_confirmation_required"
;

const translations: Record<Lang, Record<TranslationKey, string>> = {
  en: {
    popular_tokens: "Popular tokens on this network",
    token_search_results: "LI.FI search results",
    tokens_searching: "Searching LI.FI…",
    tokens_more: "Show more tokens",
    tokens_refine: "First 200 results shown. Refine the name or paste the full contract address.",
    token_verified: "Verified status from LI.FI",
    token_catalog: "Hermes curated token",
    tokens_browse: "Browse more tokens on LI.FI",
    token_unverified: "Unverified · confirmation required",
    token_flagged: "Flagged by LI.FI · blocked",
    native_asset: "Native asset",
    token_review: "Review this token",
    view_contract: "View contract in explorer",
    token_acknowledge: "I have checked this address on the selected network and understand the token risks.",
    token_back: "Back",
    token_retry: "Try again",
    token_route_hint: "A listed token does not guarantee a route or its safety. Availability depends on the pair and amount.",
    invalid_search: "Choose a supported network and a search of at most 100 characters.",
    invalid_address: "Enter a complete EVM address: 0x followed by 40 hexadecimal characters.",
    rate_limited: "Too many token searches. Please try again in a minute.",
    tokens_unavailable: "LI.FI token verification is unavailable. Please try again before swapping.",
    token_blocked: "LI.FI has flagged a selected token. This swap is blocked.",
    token_metadata_changed: "Token metadata changed. Select the tokens again and request a new quote.",
    token_confirmation_required: "Select the unverified token again to review its address and confirm the risks.",
    provider_soon: "Soon",
    amount_invalid: "Enter a valid amount using one decimal separator (dot or comma).",
    insufficient_balance: "Insufficient token balance. Quotes remain available.",
    insufficient_gas: "Not enough native currency for the estimated network fees.",
    balance_unavailable: "Waiting for the balance on the source network.",
    quotes_refresh_in: "Auto-refresh in {seconds}s",
    quotes_refreshing: "Refreshing quotes…",
    quotes_retry_in: "Next attempt in {seconds}s",
    quotes_suspended: "Auto-refresh paused during the transaction",
    quotes_waiting: "Auto-refresh will resume when connected",
    refresh_quotes: "Refresh quotes",
    quote_changed: "The wallet or swap details changed. Request a new quote.",
    same_token: "Choose a different destination token or network.",
    platform_fee: "Hermes fee (included in quote)",
    network_fee: "Estimated network fees (additional)",
    minimum_received: "Minimum received",
    slippage_label: "Slippage tolerance",
    fee_included: "Included",
    fee_additional: "Additional",
    fx_unavailable: "EUR conversion unavailable. Amounts remain in USD.",
    fx_reference: "Indicative ECB rate dated {date}.",
    swap_success: "Route completed. Check your wallet for the received tokens.",
    wallet_history: "If a transaction was submitted, check its status in your wallet before starting again.",
    lookup_failed: "Token metadata could not be verified on this network.",
    custom_token_warning: "LI.FI does not provide a verified status for this token. Anyone can copy a name or symbol. Check its contract address; you could lose your funds or be unable to sell it.",
    confirm_token: "Select {symbol}",
    native_gas_hint: "Keep some native currency to pay network fees.",
    source_token: "Select source token",
    destination_token: "Select destination token",
    no_routes_hint: "No routes for this pair and amount. Try another pair or refresh.",
    execution_progress: "Transaction progress",
    hero_tagline: "LI.FI tokens · transparent routes · fees included in net amount.",
    boot_loading: "Loading supported networks…",
    boot_no_chains: "LI.FI is not returning any supported chains. Try again later.",
    boot_no_tokens: "No token found via LI.FI on the configured networks.",
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
    route_list_title: "Available routes",
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
    search_placeholder: "Name, symbol or contract address",
    no_tokens_for_chain: "No tokens available for this selection.",
    contract_resolved: "Resolved by contract address",
    search_result: "External search result",
    metadata_description:
      "Find LI.FI tokens by name or address and compare cross-chain routes with transparent fees.",
    nav_swap: "Swap",
    hero_title: "Cross-chain swaps, made simple",
    hero_subtitle: "Compare routes from top DEXs in one click.",
  },
  fr: {
    popular_tokens: "Tokens populaires sur ce réseau",
    token_search_results: "Résultats de recherche LI.FI",
    tokens_searching: "Recherche sur LI.FI…",
    tokens_more: "Afficher plus de tokens",
    tokens_refine: "Les 200 premiers résultats sont affichés. Précise le nom ou colle l’adresse complète du contrat.",
    token_verified: "Statut vérifié fourni par LI.FI",
    token_catalog: "Token du catalogue Hermes",
    tokens_browse: "Parcourir plus de tokens sur LI.FI",
    token_unverified: "Non vérifié · confirmation requise",
    token_flagged: "Signalé par LI.FI · bloqué",
    native_asset: "Actif natif",
    token_review: "Vérifier ce token",
    view_contract: "Voir le contrat dans l’explorateur",
    token_acknowledge: "J’ai vérifié cette adresse sur le réseau sélectionné et je comprends les risques liés au token.",
    token_back: "Retour",
    token_retry: "Réessayer",
    token_route_hint: "Un token trouvé ne garantit ni une route ni sa sécurité. La disponibilité dépend de la paire et du montant.",
    invalid_search: "Choisis un réseau pris en charge et une recherche de 100 caractères maximum.",
    invalid_address: "Saisis une adresse EVM complète : 0x suivi de 40 caractères hexadécimaux.",
    rate_limited: "Trop de recherches de tokens. Réessaie dans une minute.",
    tokens_unavailable: "La vérification des tokens LI.FI est indisponible. Réessaie avant de lancer le swap.",
    token_blocked: "LI.FI signale un risque sur un token sélectionné. Ce swap est bloqué.",
    token_metadata_changed: "Les métadonnées d’un token ont changé. Sélectionne à nouveau les tokens et demande une nouvelle cotation.",
    token_confirmation_required: "Sélectionne à nouveau le token non vérifié pour contrôler son adresse et confirmer les risques.",
    provider_soon: "Bientôt",
    amount_invalid: "Saisis un montant valide avec un seul séparateur décimal (point ou virgule).",
    insufficient_balance: "Solde du token insuffisant. Les cotations restent disponibles.",
    insufficient_gas: "Solde natif insuffisant pour les frais réseau estimés.",
    balance_unavailable: "En attente du solde sur le réseau source.",
    quotes_refresh_in: "Actualisation automatique dans {seconds}s",
    quotes_refreshing: "Actualisation des cotations…",
    quotes_retry_in: "Nouvelle tentative dans {seconds}s",
    quotes_suspended: "Actualisation suspendue pendant la transaction",
    quotes_waiting: "L’actualisation reprendra avec la connexion",
    refresh_quotes: "Actualiser les cotations",
    quote_changed: "Le wallet ou les paramètres ont changé. Demande une nouvelle cotation.",
    same_token: "Choisis un autre token ou réseau de destination.",
    platform_fee: "Frais Hermes (inclus dans le devis)",
    network_fee: "Frais réseau estimés (en supplément)",
    minimum_received: "Minimum reçu",
    slippage_label: "Tolérance de slippage",
    fee_included: "Inclus",
    fee_additional: "En supplément",
    fx_unavailable: "Conversion EUR indisponible. Les montants restent en USD.",
    fx_reference: "Taux indicatif BCE du {date}.",
    swap_success: "Route terminée. Vérifie les tokens reçus dans ton wallet.",
    wallet_history: "Si une transaction a été envoyée, vérifie son état dans ton wallet avant de recommencer.",
    lookup_failed: "Les métadonnées du token n’ont pas pu être vérifiées sur ce réseau.",
    custom_token_warning: "LI.FI ne fournit pas de statut vérifié pour ce token. N’importe qui peut copier un nom ou un symbole. Contrôle l’adresse du contrat : tu pourrais perdre tes fonds ou ne pas pouvoir le revendre.",
    confirm_token: "Sélectionner {symbol}",
    native_gas_hint: "Conserve une partie du solde natif pour payer les frais réseau.",
    source_token: "Choisir le token source",
    destination_token: "Choisir le token de destination",
    no_routes_hint: "Aucune route pour cette paire et ce montant. Change la paire ou actualise.",
    execution_progress: "Suivi de la transaction",
    hero_tagline:
      "Tokens LI.FI · routes transparentes · frais inclus dans le montant net.",
    boot_loading: "Chargement des réseaux pris en charge…",
    boot_no_chains: "LI.FI ne renvoie aucune chaîne supportée. Réessaie plus tard.",
    boot_no_tokens: "Aucun token trouvé via LI.FI sur les réseaux configurés.",
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
    route_list_title: "Routes disponibles",
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
    search_placeholder: "Nom, symbole ou adresse du contrat",
    no_tokens_for_chain: "Aucun token disponible pour cette sélection.",
    contract_resolved: "Résolu par adresse de contrat",
    search_result: "Résultat de recherche externe",
    metadata_description:
      "Recherche de tokens LI.FI par nom ou adresse et comparaison de routes cross-chain avec frais transparents.",
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
    let saved: string | null = null;
    try { saved = localStorage.getItem("hermes-lang"); } catch { /* Use browser language. */ }
    if (saved === "en" || saved === "fr") {
      setLangState(saved);
    } else {
      setLangState(detectBrowserLang());
    }
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    if (typeof localStorage !== "undefined") {
      try { localStorage.setItem("hermes-lang", newLang); } catch { /* Storage may be disabled. */ }
    }
  };

  const translate = useCallback((key: TranslationKey, params?: Record<string, string>) => {
    let result = t(key, lang);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, v);
      });
    }
    return result;
  }, [lang]);

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

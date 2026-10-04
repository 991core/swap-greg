"use client";

import type { RouteExtended } from "@lifi/sdk";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { RouteList } from "./RouteList";
import TokenSelectModal from "./TokenSelectModal";
import { QuoteCountdown } from "./QuoteCountdown";
import { ChainSelect } from "./ChainSelect";
import { CurrencySwitch } from "./CurrencySwitch";
import { quoteAmount } from "@/lib/presentation";
import { APP_CHAINS, APP_CHAIN_IDS } from "@/lib/chains";
import { getPopularTokens } from "@/lib/tokens/catalog";
import { type AppToken, formatTokenAmount, parseTokenAmount } from "@/lib/lifi";
import { balancePercentage } from "@/lib/amounts";
import { formatCurrencyValue, fetchTokenPriceUsd, fetchUsdEurRate, getPriceLookupKey, type FxRate } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";
import { useSwapQuotes } from "@/lib/routing/useSwapQuotes";
import { canExecuteQuote, sourceGasAmount } from "@/lib/routing/quote";
import { normalizeLifiRoute } from "@/lib/routing/normalize";
import { executeSwapQuote, SwapValidationError } from "@/lib/routing/execute";
import { PLATFORM_FEE, SLIPPAGE } from "@/lib/routing/config";
import { TokenIcon } from "./TokenIcon";
import { ProviderBadge } from "./ProviderBadge";
import type { ProviderSelection } from "@/lib/types/normalized-route";
import type { RouteSelectionParams } from "@/lib/routing/orchestrator";
import type { RangoExecution, RangoPending, RangoProgress } from "@/lib/aggregators/rango/types";
import { PENDING_RANGO_KEY, readPendingRango, trackRangoTransaction } from "@/lib/aggregators/rango/tracking";
import { transactionLink } from "@/lib/aggregators/rango/explorer";

import { findTokenOnChain } from "@/lib/token-continuity";
import { fetchOneClickTokens } from "@/lib/aggregators/oneclick/client";
import { PENDING_ONECLICK_KEY, type PendingOneClick } from "@/lib/aggregators/oneclick/types";
import { readPendingOneClick, updatePendingOneClick, isActiveOneClick } from "@/lib/aggregators/oneclick/tracking";
import { isObservedTokenFlagged, subscribeTokenVerdicts, tokenVerdictsSnapshot, serverTokenVerdictsSnapshot } from "@/lib/tokens/verdicts";
import { preloadPopularTokens } from "@/lib/tokens/popular";
import { marketUniverseSnapshot } from "@/lib/tokens/market-universe";
import { RELEASE_MODE, canExecuteNewSwap } from "@/lib/release-mode";
import { exportIntentJournal, intentNeedsReconciliation, migrateLegacyIntents, readIntentJournal, reconcileSourceHash, updateIntentTracking, type IntentRecord } from "@/lib/intent/journal";
import { trackIntentRecord } from "@/lib/intent/tracking";
type Side = "from" | "to";
function TokenSelector({ token, onClick }: { token: AppToken | null; onClick: () => void }) {
  const { translate } = useI18n();
  return <button type="button" className="jumper-token-select" onClick={onClick}>
    <TokenIcon token={token} />
    <span className="jumper-token-info"><span className="jumper-token-symbol">{token?.symbol ?? translate("modal_title")}</span><span className="jumper-token-name">{token?.name}</span></span>
    <span className="jumper-chevron" aria-hidden="true">⌄</span>
  </button>;
}

export function SwapCard({ onConnect }: { onConnect?: () => void } = {}) {
  const { address, isConnected } = useAccount();
  const { translate, lang } = useI18n();
  useSyncExternalStore(subscribeTokenVerdicts, tokenVerdictsSnapshot, serverTokenVerdictsSnapshot);
  const [fromChainId, setFromChainId] = useState(8453);
  const [toChainId, setToChainId] = useState(1);
  const [fromToken, setFromToken] = useState<AppToken | null>(() => getPopularTokens(8453)[0]);
  const [toToken, setToToken] = useState<AppToken | null>(() => getPopularTokens(1)[0]);
  const [amount, setAmount] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const executionLock = useRef(false);
  const [execution, setExecution] = useState<RouteExtended | null>(null);
  const [providers, setProviders] = useState<ProviderSelection>({ lifi: true, rango: true, socket: false, oneclick: true });
  const [rangoProgress, setRangoProgress] = useState<RangoProgress | null>(null);
  const [pendingRango, setPendingRango] = useState<RangoPending | null>(null);
  const [pendingOneClick, setPendingOneClick] = useState<PendingOneClick | null>(null);
  const [oneClickTokens, setOneClickTokens] = useState<Record<number, AppToken[]>>({});
  const activeOneClick = isActiveOneClick(pendingOneClick);
  const [success, setSuccess] = useState(false);
  const [intents, setIntents] = useState<IntentRecord[]>([]);
  const [journalReady, setJournalReady] = useState(false);
  const [recoveryHash, setRecoveryHash] = useState<Record<string, string>>({});
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalSide, setModalSide] = useState<Side | null>(null);
  const [priceLookup, setPriceLookup] = useState<Record<string, number>>({});
  const [currencySlot, setCurrencySlot] = useState<HTMLElement | null>(null);
  const [currencyPreference, setCurrencyPreference] = useState<"USD" | "EUR">("USD");
  const [fx, setFx] = useState<FxRate | null>(null);
  const currency = currencyPreference === "EUR" && fx ? "EUR" : "USD";
  const currencyValue = (value: number | null) => formatCurrencyValue(value, currency, fx?.rate, lang);
  const refreshJournal = useCallback(() => {
    try { migrateLegacyIntents(); setIntents(readIntentJournal()); setJournalReady(true); }
    catch { setJournalReady(false); }
  }, []);
  const journalBlocked = !journalReady || intents.some(intent => (intent.wallet === null || intent.wallet.toLowerCase() === address?.toLowerCase()) && intentNeedsReconciliation(intent));

  const isNative = Boolean(fromToken && /^0x0{40}$/i.test(fromToken.address));
  const nativeBalance = useBalance({ address, chainId: fromChainId, query: { enabled: Boolean(address && fromToken), refetchInterval: 15_000 } });
  const erc20Balance = useReadContract({ address: fromToken?.address as Address | undefined, chainId: fromChainId, abi: erc20Abi,
    functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fromToken && !isNative), refetchInterval: 15_000 } });
  const sourceBalance = isNative ? nativeBalance.data?.value : erc20Balance.data;
  const parsed = fromToken ? parseTokenAmount(amount, fromToken.decimals) : null;
  const sameToken = Boolean(fromToken && toToken && fromChainId === toChainId && fromToken.address.toLowerCase() === toToken.address.toLowerCase());
  const blockedSelection = isObservedTokenFlagged(fromToken) || isObservedTokenFlagged(toToken);
  const params: RouteSelectionParams | null = fromToken && toToken && parsed && parsed !== "0" && !sameToken && !blockedSelection && (providers.lifi || providers.rango || providers.oneclick)
    ? { fromChainId, toChainId, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address, fromAmount: parsed, fromAddress: isConnected && address ? address : "", providers, fromToken, toToken, fromTokenDecimals: fromToken.decimals, toTokenDecimals: toToken.decimals } : null;
  const quotes = useSwapQuotes(params, !swapping && !pendingRango && !activeOneClick);
  const selectedRoute = quotes.routes.find((route) => route.id === selectedId) ?? null;
  const insufficientBalance = Boolean(parsed && sourceBalance !== undefined && BigInt(parsed) > sourceBalance);
  const insufficientGas = Boolean(selectedRoute && nativeBalance.data && (nativeBalance.data.value < sourceGasAmount(selectedRoute) + (isNative && parsed ? BigInt(parsed) : BigInt(0)) || nativeBalance.data.value === BigInt(0)));
  const balanceReady = sourceBalance !== undefined && nativeBalance.data !== undefined;
  const canSwap = canExecuteNewSwap() && !journalBlocked && isConnected && !swapping && !pendingRango && !activeOneClick && !quotes.loading && !quotes.expired && balanceReady && !insufficientBalance && !insufficientGas && canExecuteQuote(selectedRoute, params);
  const receivePreview = selectedRoute && toToken ? quoteAmount(selectedRoute.toAmount, toToken.decimals).short : "";
  const price = (token: AppToken | null) => token ? priceLookup[getPriceLookupKey(token)] ?? 0 : 0;
  const inputValue = parsed && fromToken && price(fromToken) > 0 ? Number(formatTokenAmount(parsed, fromToken.decimals, fromToken.decimals)) * price(fromToken) : null;
  const outputValue = receivePreview && price(toToken) > 0 ? Number(receivePreview) * price(toToken) : null;

  useEffect(() => {
    if (quotes.loading) setSelectedId(null);
  }, [quotes.loading]);
  useEffect(() => {
    refreshJournal();
    const onStorage = () => refreshJournal();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshJournal]);
  useEffect(() => {
    setCurrencySlot(document.getElementById("hermes-currency-slot"));
    try { setPendingRango(readPendingRango(localStorage.getItem(PENDING_RANGO_KEY))); } catch { /* Storage can be disabled. */ }
    try { if (localStorage.getItem("hermes-currency") === "EUR") setCurrencyPreference("EUR"); } catch { /* Default to USD. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void preloadPopularTokens(APP_CHAIN_IDS, controller.signal);
    let lastRefresh = Date.now();
    const timer = setInterval(() => {
      if (!document.hidden && navigator.onLine && (marketUniverseSnapshot().result?.enriching || Date.now() - lastRefresh >= 60_000)) {
        lastRefresh = Date.now();
        void preloadPopularTokens(APP_CHAIN_IDS, controller.signal);
      }
    }, 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  function changeCurrency(value: "USD" | "EUR") {
    setCurrencyPreference(value);
    try { localStorage.setItem("hermes-currency", value); } catch { /* Keep the in-memory preference. */ }
  }
  function savePending(pending: RangoPending | null) {
    try { if (pending) localStorage.setItem(PENDING_RANGO_KEY, JSON.stringify(pending)); else localStorage.removeItem(PENDING_RANGO_KEY); }
    catch {
      if (pending && !pending.txHash) throw new Error("Cannot save the Rango recovery record. No transaction was requested.");
      // Preserve the in-memory lock if broadcast already returned a hash.
      if (!pending) throw new Error("Cannot clear the Rango recovery record.");
    }
    setPendingRango(pending);
  }
  async function finishRango(result: RangoExecution) {
    if (result.status === "pending") savePending(result);
    else {
      if (result.journalId) await updateIntentTracking(result.journalId, result.status === "success" ? "delivered" : result.outcome ?? "intervention_required", result.evidence ?? { reason: "provider_status_unverified" });
      if (result.status === "success") savePending(null);
      else savePending(result);
      setSuccess(result.status === "success");
      setRangoProgress({ stage: result.status === "success" ? "complete" : "failed", txHash: result.txHash, txLink: result.txHash ? transactionLink(result.chainId, result.txHash) : undefined });
      if (result.status === "failed") setError(result.message ?? translate("swap_exec_error"));
    }
    refreshJournal();
  }
  async function resumeRango() {
    if (!pendingRango || executionLock.current) return;
    executionLock.current = true; setSwapping(true); setError(null);
    try { await finishRango(await trackRangoTransaction(pendingRango)); }
    finally { executionLock.current = false; setSwapping(false); quotes.refresh(); void nativeBalance.refetch(); if (!isNative) void erc20Balance.refetch(); }
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const updates = await Promise.all([fromToken, toToken].filter((t): t is AppToken => Boolean(t)).map(async (token) => [getPriceLookupKey(token), await fetchTokenPriceUsd(token)] as const));
      if (!cancelled) setPriceLookup(Object.fromEntries(updates.filter((pair) => pair[1] != null)) as Record<string, number>);
    };
    void load(); const timer = setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [fromToken, toToken]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => { const rate = await fetchUsdEurRate(); if (!cancelled) setFx(rate); };
    void load(); const timer = setInterval(() => void load(), 300_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  function saveOneClick(pending: PendingOneClick) {
    const serialized = JSON.stringify(pending);
    try { localStorage.setItem(PENDING_ONECLICK_KEY, serialized); }
    catch {
      // Before asking the wallet we require a durable recovery record. Once a
      // hash exists, losing storage must still retain the funded record in memory.
      if (!pending.hash) throw new Error("Cannot save the 1Click recovery record. No deposit was requested.");
    }
    setPendingOneClick(previous => JSON.stringify(previous) === serialized ? previous : pending);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchOneClickTokens(controller.signal).then(setOneClickTokens).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    try {
      const stored = readPendingOneClick(localStorage.getItem(PENDING_ONECLICK_KEY));
      // Changing/disconnecting the account cannot discard an unresolved deposit.
      setPendingOneClick(previous => isActiveOneClick(previous) ? previous : stored);
    } catch { setPendingOneClick(previous => isActiveOneClick(previous) ? previous : null); }
  }, [address]);
  useEffect(() => {
    if (!pendingOneClick || !activeOneClick) return;
    let cancelled = false;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/oneclick/status?depositAddress=${encodeURIComponent(pendingOneClick.depositAddress)}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const result: unknown = await response.json();
        if (!cancelled) {
          const updated = updatePendingOneClick(pendingOneClick, result);
          if (updated.status === "SUCCESS" && updated.version === 1 && updated.journalId && updated.delivery) {
            await updateIntentTracking(updated.journalId, "delivered", updated.delivery);
          }
          saveOneClick(updated); refreshJournal();
        }
      } catch { /* Retain the transfer record and retry tracking. */ }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pendingOneClick, activeOneClick, refreshJournal]);

  function handleSelect(side: Side, chainId: number, token: AppToken) {
    if (executionLock.current) return;
    setError(null); setSuccess(false); setSelectedId(null);
    if (side === "from") { setFromChainId(chainId); setFromToken(token); }
    else { setToChainId(chainId); setToToken(token); }
  }
  function changeChain(side: Side, chainId: number) {
    if (executionLock.current || chainId === (side === "from" ? fromChainId : toChainId)) return;
    const token = findTokenOnChain(side === "from" ? fromToken : toToken, chainId, getPopularTokens(chainId));
    if (side === "from") { setFromChainId(chainId); setFromToken(token); if (!token) setAmount(""); }
    else { setToChainId(chainId); setToToken(token); }
    setError(null); setSuccess(false); setSelectedId(null);
    if (!token) setModalSide(side);
  }
  function invert() {
    if (executionLock.current) return;
    setFromChainId(toChainId); setToChainId(fromChainId); setFromToken(toToken); setToToken(fromToken);
    setSelectedId(null); setError(null); setSuccess(false);
  }
  async function handleSwap() {
    if (executionLock.current || !canSwap || !selectedRoute || !params) return;
    executionLock.current = true; setSwapping(true); setError(null); setSuccess(false); setExecution(null); setRangoProgress(null);
    const route = selectedRoute;
    try {
      const completed = await executeSwapQuote(route, params, (updated) => {
        setExecution(updated);
        quotes.updateRoute(normalizeLifiRoute(updated, params, route.expiresAt));
      }, { fromToken: fromToken!, toToken: toToken! }, (progress) => {
        setRangoProgress(progress); if (progress.pending !== undefined) savePending(progress.pending);
      }, { onPending: saveOneClick, confirm: (quote) => window.confirm(translate("oneclick_confirm", {
        amount: formatTokenAmount(quote.amountIn, fromToken!.decimals), from: fromToken!.symbol,
        minimum: formatTokenAmount(quote.minAmountOut, toToken!.decimals, toToken!.decimals), to: toToken!.symbol,
      })) });
      if (!completed || ("provider" in completed && completed.provider === "oneclick")) return;
      if ("provider" in completed) await finishRango(completed);
      else { setExecution(completed); setSuccess(completed.hermesDelivery?.state === "delivered"); }
    } catch (cause) {
      setError(cause instanceof SwapValidationError ? translate(cause.key) : cause instanceof Error ? cause.message : translate("swap_exec_error"));
    } finally {
      quotes.refresh(); setSelectedId(null); executionLock.current = false; setSwapping(false);
      refreshJournal(); void nativeBalance.refetch(); if (!isNative) void erc20Balance.refetch();
    }
  }

  function exportRecords() {
    try {
      const blob = new Blob([exportIntentJournal()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `hermes-transfers-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(translate("journal_reconcile_failed")); }
  }
  async function reconcileAction(intentId: string, actionId: string) {
    const hash = recoveryHash[actionId];
    if (!hash || !/^0x[\da-f]{64}$/i.test(hash)) { setError(translate("journal_reconcile_failed")); return; }
    try { await reconcileSourceHash(intentId, actionId, hash as `0x${string}`); refreshJournal(); setError(null); }
    catch { setError(translate("journal_reconcile_failed")); }
  }
  async function trackRecord(intent: IntentRecord) {
    if (trackingId) return;
    setTrackingId(intent.id);
    try {
      const result = await trackIntentRecord(intent);
      await updateIntentTracking(intent.id, result.status, result.evidence, undefined, result.providerState);
      if (result.status === "delivered" && pendingRango?.journalId === intent.id) savePending(null);
      if (result.providerState && intent.provider === "oneclick") {
        const restored = readPendingOneClick(JSON.stringify(result.providerState));
        if (restored) setPendingOneClick(restored);
      }
      refreshJournal(); setError(null);
    } catch { setError(translate("journal_reconcile_failed")); }
    finally { setTrackingId(null); }
  }

  const actions = execution?.steps.flatMap((step) => step.execution?.actions ?? []) ?? [];
  const label = !canExecuteNewSwap() ? translate("quotes_only") : !isConnected ? translate("cta_connect_wallet") : activeOneClick ? translate("oneclick_status", { status: pendingOneClick!.status }) : pendingRango ? translate("rango_submitted") : swapping ? translate("cta_executing") : quotes.loading ? translate("cta_searching") : translate("cta_swap");
  return <>
    {currencySlot && createPortal(<CurrencySwitch value={currency} onChange={changeCurrency} eurAvailable={Boolean(fx)} />, currencySlot)}
    <div className="jumper-swap-widget">
    <div className="jumper-swap-main">
      <div className="jumper-swap-toolbar"><div className="jumper-swap-title"><h2>{translate("swap_title")}</h2><div className="jumper-providers"><span className="jumper-hint">{translate("providers_label")}</span>
        {(["lifi", "rango", "oneclick"] as const).map((provider) => <button key={provider} type="button" className={`jumper-prov${providers[provider] ? " active" : ""}`} aria-pressed={providers[provider]} aria-label={provider === "lifi" ? "LI.FI" : provider === "oneclick" ? "1Click" : "Rango"} disabled={swapping || Boolean(pendingRango) || activeOneClick} onClick={() => { setProviders((old) => ({ ...old, [provider]: !old[provider] })); setSelectedId(null); }}><ProviderBadge provider={provider} />{provider === "rango" && <span className="jumper-beta">Beta</span>}<span aria-hidden="true">{providers[provider] ? "✓" : "+"}</span></button>)}
      </div></div>{!currencySlot && <CurrencySwitch value={currency} onChange={changeCurrency} eurAvailable={Boolean(fx)} />}</div>
      <fieldset disabled={swapping} className="jumper-form">
        <div className="jumper-panel">
          <div className="jumper-panel-header"><label htmlFor="swap-amount">{translate("send_label")}</label>
            <ChainSelect chainId={fromChainId} onChange={(id) => changeChain("from", id)} label={translate("source_network")} />
          </div>
          <div className="jumper-panel-input"><input id="swap-amount" className="jumper-amount-input" type="text" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); setSuccess(false); }} />
            <TokenSelector token={fromToken} onClick={() => setModalSide("from")} /></div>
          <div className="jumper-panel-foot"><span>{currencyValue(inputValue) ?? "—"}</span>{sourceBalance !== undefined && fromToken && <span className="jumper-balance-pill">{translate("balance_label")}: {quoteAmount(sourceBalance.toString(), fromToken.decimals).short} {fromToken.symbol}</span>}</div>
          {fromToken && sourceBalance !== undefined && <div className="jumper-quick-row">{(isNative ? [25, 50, 75] : [25, 50, 75, 100]).map((pct) => <button key={pct} type="button" className="jumper-pct-btn" onClick={() => setAmount(balancePercentage(sourceBalance, pct, fromToken.decimals))}>{pct}%</button>)}</div>}
          {isNative && <p className="jumper-hint">{translate("native_gas_hint")}</p>}
        </div>
        <button type="button" className="jumper-swap-invert" onClick={invert} aria-label={translate("invert_label")}>⇅</button>
        <div className="jumper-panel">
          <div className="jumper-panel-header"><label htmlFor="receive-amount">{translate("receive_label")}</label><ChainSelect chainId={toChainId} onChange={(id) => changeChain("to", id)} label={translate("destination_network")} /></div>
          <div className="jumper-panel-input"><input id="receive-amount" className="jumper-amount-input" readOnly value={receivePreview} placeholder="—" />
            <TokenSelector token={toToken} onClick={() => setModalSide("to")} /></div>
          <p className="jumper-hint">{currencyValue(outputValue) ?? "—"}</p>
        </div>
      </fieldset>
      {!providers.lifi && !providers.rango && !providers.oneclick && <p className="jumper-warning">{translate("choose_provider")}</p>}

      <div className="jumper-swap-footer">
      <details className="jumper-settings"><summary><span aria-hidden="true">⚙</span><span>{translate("slippage_short")} {(SLIPPAGE * 100).toLocaleString(lang)}%</span><span className="jumper-settings-divider">·</span><span>{translate("hermes_fee_short")} {(PLATFORM_FEE * 100).toLocaleString(lang)}%</span><span className="jumper-settings-chevron" aria-hidden="true">⌄</span></summary>
      <dl className="jumper-summary"><div><dt>{translate("platform_fee")}</dt><dd>{(PLATFORM_FEE * 100).toLocaleString(lang)}%</dd></div><div><dt>{translate("slippage_label")}</dt><dd>{SLIPPAGE * 100}%</dd></div></dl><p className="jumper-hint">{translate("route_sort_hint")} {translate("route_estimates")}</p></details>
      {currency === "EUR" && fx && <p className="jumper-hint">{translate("fx_reference", { date: fx.date })}</p>}
      <button type="button" className="jumper-cta" disabled={!canExecuteNewSwap() || (isConnected ? !canSwap : !onConnect)} onClick={() => isConnected ? void handleSwap() : onConnect?.()}>{label}</button>
      <div aria-live="polite">
        {amount.trim() && parsed == null && <p className="jumper-error">{translate("amount_invalid")}</p>}
        {sameToken && <p className="jumper-hint">{translate("same_token")}</p>}
        {insufficientBalance && <p className="jumper-warning">{translate("insufficient_balance")}</p>}
        {!insufficientBalance && insufficientGas && <p className="jumper-warning">{translate("insufficient_gas")}</p>}
        {isConnected && params && !balanceReady && <p className="jumper-hint">{translate("balance_unavailable")}</p>}
        {!isConnected && <p className="jumper-hint">{translate("quote_without_wallet")}</p>}
        {RELEASE_MODE !== "enabled" && <p className="jumper-hint">{translate("quotes_only")}</p>}
        {RELEASE_MODE === "enabled" && isConnected && params && !selectedRoute && !quotes.loading && quotes.routes.length > 0 && <p className="jumper-hint">{translate("choose_route")}</p>}
        {(blockedSelection || error) && <p className="jumper-error" role="alert">{blockedSelection ? translate("token_blocked") : error}</p>}
        {success && <p className="jumper-success" role="status">{translate("swap_success")}</p>}
        {execution && !success && <p className="jumper-warning" role="status">{translate("swap_pending_proof")}</p>}
        {error && (execution || rangoProgress?.txHash) && <p className="jumper-warning">{translate("wallet_history")}</p>}
      </div>
      {actions.length > 0 && <div className="jumper-progress"><p>{translate("execution_progress")}</p>{actions.map((action, index) => <div key={index}><span>{action.type} · {action.status}</span>{action.txLink && /^https:\/\//.test(action.txLink) && <a href={action.txLink} target="_blank" rel="noopener noreferrer">{action.txHash?.slice(0, 12) ?? "↗"} ↗</a>}</div>)}</div>}
      {rangoProgress && <div className="jumper-progress" role="status"><p>Rango · {translate(`rango_${rangoProgress.stage}`)}</p>{rangoProgress.txLink && <a href={rangoProgress.txLink} target="_blank" rel="noopener noreferrer">{rangoProgress.txHash?.slice(0, 12)} ↗</a>}</div>}
      {pendingRango && <div className="jumper-warning" role="status"><p>{translate(pendingRango.txHash ? "rango_pending" : "rango_unknown")}</p>{pendingRango.txHash && <a href={transactionLink(pendingRango.chainId, pendingRango.txHash)} target="_blank" rel="noopener noreferrer">{pendingRango.txHash.slice(0, 12)} ↗</a>}<button type="button" className="jumper-refresh" disabled={swapping || !pendingRango.txHash} onClick={() => void resumeRango()}>{translate("rango_resume")}</button></div>}
      {pendingOneClick && <p className="jumper-hint" role="status">
        {translate("oneclick_status", { status: pendingOneClick.status })}{" "}
        {pendingOneClick.hash && <a href={transactionLink(pendingOneClick.fromChainId, pendingOneClick.hash)} target="_blank" rel="noopener noreferrer">{translate("oneclick_source_tx")}</a>}{" "}
        {pendingOneClick.destinationUrl?.startsWith("https://") && <a href={pendingOneClick.destinationUrl} target="_blank" rel="noopener noreferrer">{translate("oneclick_explorer")}</a>}
      </p>}
      {(intents.length > 0 || !journalReady) && <section className="jumper-progress" aria-label={translate("journal_title")}>
        <h3>{translate("journal_title")}</h3>
        {journalBlocked && <p className="jumper-warning">{translate("journal_blocked")}</p>}
        {intents.map(intent => <div key={intent.id}>
          <p>{intent.provider.toUpperCase()} · {intent.status.replaceAll("_", " ")} · {new Date(intent.createdAt).toLocaleString(lang)}</p>
          {intent.actions.some(action => ["swap", "deposit"].includes(action.kind) && action.hash) && intentNeedsReconciliation(intent) &&
            <button type="button" className="jumper-refresh" disabled={trackingId !== null} onClick={() => void trackRecord(intent)}>{translate("rango_resume")}</button>}
          {intent.actions.map(action => <div key={action.id}>
            <p>{action.kind} · {action.status} {action.hash && <code>{action.hash}</code>}</p>
            {["emitting", "ambiguous"].includes(action.status) && <div>
              <label htmlFor={`recovery-${action.id}`}>{translate("journal_hash")}</label>
              <input id={`recovery-${action.id}`} value={recoveryHash[action.id] ?? ""} onChange={event => setRecoveryHash(old => ({ ...old, [action.id]: event.target.value }))} autoComplete="off" spellCheck={false} />
              <button type="button" className="jumper-refresh" onClick={() => void reconcileAction(intent.id, action.id)}>{translate("journal_reconcile")}</button>
            </div>}
          </div>)}
        </div>)}
        <button type="button" className="jumper-refresh" onClick={exportRecords}>{translate("journal_export")}</button>
      </section>}
      {providers.rango && <p className="jumper-test-notice">{translate("rango_test_notice")}</p>}
      </div>
    </div>
    <aside className="jumper-routes-panel" aria-label={translate("route_list_title")}>
      <div className="jumper-routes-heading"><h2>{translate("routes_short")} {quotes.routes.length > 0 && <span className="jumper-route-count">{quotes.routes.length}</span>}</h2>
        <div className="jumper-routes-tools">{params && <QuoteCountdown compact expiresAt={quotes.expiresAt} retryAt={quotes.retryAt} loading={quotes.loading} waiting={quotes.waiting} suspended={swapping || Boolean(pendingRango) || activeOneClick} />}
        {params && <button type="button" className="jumper-refresh-icon" aria-label={translate("refresh_quotes")} title={translate("refresh_quotes")} disabled={swapping || Boolean(pendingRango) || activeOneClick || quotes.loading} onClick={quotes.refresh}>↻</button>}</div>
      </div>
      {quotes.error && <p className="jumper-warning" role="status">{translate(quotes.error as "route_search_failed")}</p>}
      {quotes.partial && <p className="jumper-warning" role="status">{translate((quotes.partialReason ?? "route_search_partial") as "route_search_partial")}</p>}
      {!quotes.routes.length && !quotes.loading && !quotes.error && !quotes.partial && <div className="jumper-routes-empty"><span aria-hidden="true">⇄</span><p>{translate(params ? "no_routes_hint" : "routes_empty_description")}</p></div>}
      {quotes.loading && <div role="status" className="jumper-route-loading"><span>{translate(quotes.routes.length ? "route_waiting_others" : "searching_routes")}</span>{!quotes.routes.length && <div className="jumper-route-skeleton" aria-hidden="true"><i /><i /><i /></div>}</div>}
      <RouteList routes={quotes.routes} selectedId={selectedRoute?.id ?? null} onSelect={(route) => setSelectedId(route.id)} toDecimals={toToken?.decimals ?? 18} toSymbol={toToken?.symbol ?? ""} currency={currency} eurRate={fx?.rate ?? null} priceUsd={price(toToken)} disabled={swapping || Boolean(pendingRango) || activeOneClick || quotes.loading || quotes.expired} />
    </aside>
    </div>
    <TokenSelectModal open={modalSide !== null && !swapping} onClose={() => setModalSide(null)} chains={APP_CHAINS} extraTokens={oneClickTokens} selectedChainId={modalSide === "to" ? toChainId : fromChainId} selectedToken={modalSide === "to" ? toToken : fromToken} onSelect={(chainId, token) => handleSelect(modalSide ?? "from", chainId, token)} title={translate(modalSide === "to" ? "destination_token" : "source_token")} />
  </>;
}

"use client";

import type { RouteExtended } from "@lifi/sdk";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { RouteList } from "./RouteList";
import TokenSelectModal from "./TokenSelectModal";
import { QuoteCountdown } from "./QuoteCountdown";
import { ChainSelect } from "./ChainSelect";
import { CurrencySwitch } from "./CurrencySwitch";
import { quoteAmount } from "@/lib/presentation";
import { APP_CHAINS } from "@/lib/chains";
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
  const [fromChainId, setFromChainId] = useState(8453);
  const [toChainId, setToChainId] = useState(1);
  const [fromToken, setFromToken] = useState<AppToken | null>(() => getPopularTokens(8453)[0]);
  const [toToken, setToToken] = useState<AppToken | null>(() => getPopularTokens(1)[0]);
  const [amount, setAmount] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const executionLock = useRef(false);
  const [execution, setExecution] = useState<RouteExtended | null>(null);
  const [providers, setProviders] = useState<ProviderSelection>({ lifi: true, rango: true, socket: false });
  const [rangoProgress, setRangoProgress] = useState<RangoProgress | null>(null);
  const [pendingRango, setPendingRango] = useState<RangoPending | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalSide, setModalSide] = useState<Side | null>(null);
  const [priceLookup, setPriceLookup] = useState<Record<string, number>>({});
  const [currencySlot, setCurrencySlot] = useState<HTMLElement | null>(null);
  const [currencyPreference, setCurrencyPreference] = useState<"USD" | "EUR">("USD");
  const [fx, setFx] = useState<FxRate | null>(null);
  const currency = currencyPreference === "EUR" && fx ? "EUR" : "USD";
  const currencyValue = (value: number | null) => formatCurrencyValue(value, currency, fx?.rate, lang);

  const isNative = Boolean(fromToken && /^0x0{40}$/i.test(fromToken.address));
  const nativeBalance = useBalance({ address, chainId: fromChainId, query: { enabled: Boolean(address && fromToken), refetchInterval: 15_000 } });
  const erc20Balance = useReadContract({ address: fromToken?.address as Address | undefined, chainId: fromChainId, abi: erc20Abi,
    functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fromToken && !isNative), refetchInterval: 15_000 } });
  const sourceBalance = isNative ? nativeBalance.data?.value : erc20Balance.data;
  const parsed = fromToken ? parseTokenAmount(amount, fromToken.decimals) : null;
  const sameToken = Boolean(fromToken && toToken && fromChainId === toChainId && fromToken.address.toLowerCase() === toToken.address.toLowerCase());
  const params: RouteSelectionParams | null = isConnected && address && fromToken && toToken && parsed && parsed !== "0" && !sameToken && (providers.lifi || providers.rango)
    ? { fromChainId, toChainId, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address, fromAmount: parsed, fromAddress: address, providers } : null;
  const quotes = useSwapQuotes(params, !swapping && !pendingRango);
  const selectedRoute = quotes.routes.find((route) => route.id === selectedId) ?? quotes.routes[0] ?? null;
  const insufficientBalance = Boolean(parsed && sourceBalance !== undefined && BigInt(parsed) > sourceBalance);
  const insufficientGas = Boolean(selectedRoute && nativeBalance.data && (nativeBalance.data.value < sourceGasAmount(selectedRoute) + (isNative && parsed ? BigInt(parsed) : BigInt(0)) || nativeBalance.data.value === BigInt(0)));
  const balanceReady = sourceBalance !== undefined && nativeBalance.data !== undefined;
  const canSwap = isConnected && !swapping && !pendingRango && !quotes.loading && !quotes.expired && balanceReady && !insufficientBalance && !insufficientGas && canExecuteQuote(selectedRoute, params);
  const receivePreview = selectedRoute && toToken ? quoteAmount(selectedRoute.toAmount, toToken.decimals).short : "";
  const price = (token: AppToken | null) => token ? priceLookup[getPriceLookupKey(token)] ?? Number(token.priceUSD ?? 0) : 0;
  const inputValue = parsed && fromToken && price(fromToken) > 0 ? Number(formatTokenAmount(parsed, fromToken.decimals, fromToken.decimals)) * price(fromToken) : null;
  const outputValue = receivePreview && price(toToken) > 0 ? Number(receivePreview) * price(toToken) : null;

  useEffect(() => {
    setCurrencySlot(document.getElementById("hermes-currency-slot"));
    try { setPendingRango(readPendingRango(localStorage.getItem(PENDING_RANGO_KEY))); } catch { /* Storage can be disabled. */ }
    try { if (localStorage.getItem("hermes-currency") === "EUR") setCurrencyPreference("EUR"); } catch { /* Default to USD. */ }
  }, []);
  function changeCurrency(value: "USD" | "EUR") {
    setCurrencyPreference(value);
    try { localStorage.setItem("hermes-currency", value); } catch { /* Keep the in-memory preference. */ }
  }
  function savePending(pending: RangoPending | null) {
    setPendingRango(pending);
    try { if (pending) localStorage.setItem(PENDING_RANGO_KEY, JSON.stringify(pending)); else localStorage.removeItem(PENDING_RANGO_KEY); } catch { /* Keep the in-memory transaction link. */ }
  }
  function finishRango(result: RangoExecution) {
    if (result.status === "pending") savePending(result);
    else {
      savePending(null); setSuccess(result.status === "success");
      setRangoProgress({ stage: result.status === "success" ? "complete" : "failed", txHash: result.txHash, txLink: transactionLink(result.chainId, result.txHash) });
      if (result.status === "failed") setError(result.message ?? translate("swap_exec_error"));
    }
  }
  async function resumeRango() {
    if (!pendingRango || executionLock.current) return;
    executionLock.current = true; setSwapping(true); setError(null);
    try { finishRango(await trackRangoTransaction(pendingRango)); }
    finally { executionLock.current = false; setSwapping(false); quotes.refresh(); void nativeBalance.refetch(); if (!isNative) void erc20Balance.refetch(); }
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const updates = await Promise.all([fromToken, toToken].filter((t): t is AppToken => Boolean(t)).map(async (token) => [getPriceLookupKey(token), await fetchTokenPriceUsd(token)] as const));
      if (!cancelled) setPriceLookup((old) => ({ ...old, ...Object.fromEntries(updates.filter((pair) => pair[1] != null)) } as Record<string, number>));
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

  function handleSelect(side: Side, chainId: number, token: AppToken) {
    if (executionLock.current) return;
    setError(null); setSuccess(false);
    if (side === "from") { setFromChainId(chainId); setFromToken(token); setAmount(""); }
    else { setToChainId(chainId); setToToken(token); }
  }
  function changeChain(side: Side, chainId: number) {
    if (chainId === (side === "from" ? fromChainId : toChainId)) return;
    const token = getPopularTokens(chainId)[0];
    if (token) handleSelect(side, chainId, token);
    setSelectedId(null);
  }
  function invert() {
    if (executionLock.current) return;
    setFromChainId(toChainId); setToChainId(fromChainId); setFromToken(toToken); setToToken(fromToken); setAmount(""); setError(null); setSuccess(false);
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
        setRangoProgress(progress); if (progress.pending) savePending(progress.pending);
      });
      if ("provider" in completed) finishRango(completed);
      else { setExecution(completed); setSuccess(completed.steps.every((step) => step.execution?.status === "DONE")); }
    } catch (cause) {
      setError(cause instanceof SwapValidationError ? translate(cause.key) : cause instanceof Error ? cause.message : translate("swap_exec_error"));
    } finally {
      quotes.refresh(); setSelectedId(null); executionLock.current = false; setSwapping(false);
      void nativeBalance.refetch(); if (!isNative) void erc20Balance.refetch();
    }
  }

  const actions = execution?.steps.flatMap((step) => step.execution?.actions ?? []) ?? [];
  const label = !isConnected ? translate("cta_connect_wallet") : pendingRango ? translate("rango_submitted") : swapping ? translate("cta_executing") : quotes.loading ? translate("cta_searching") : translate("cta_swap");
  return <>
    {currencySlot && createPortal(<CurrencySwitch value={currency} onChange={changeCurrency} eurAvailable={Boolean(fx)} />, currencySlot)}
    <div className="jumper-swap-widget">
      <div className="jumper-swap-toolbar"><div className="jumper-swap-title"><h2>{translate("swap_title")}</h2><div className="jumper-providers"><span className="jumper-hint">{translate("providers_label")}</span>
        {(["lifi", "rango"] as const).map((provider) => <button key={provider} type="button" className={`jumper-prov${providers[provider] ? " active" : ""}`} aria-pressed={providers[provider]} aria-label={provider === "lifi" ? "LI.FI" : "Rango"} disabled={swapping || Boolean(pendingRango)} onClick={() => { setProviders((old) => ({ ...old, [provider]: !old[provider] })); setSelectedId(null); }}><ProviderBadge provider={provider} />{provider === "rango" && <span className="jumper-beta">Beta</span>}<span aria-hidden="true">{providers[provider] ? "✓" : "+"}</span></button>)}
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
      {!providers.lifi && !providers.rango && <p className="jumper-warning">{translate("choose_provider")}</p>}
    <aside className="jumper-routes-panel" aria-label={translate("route_list_title")}>
      <div className="jumper-routes-heading"><h2>{translate("routes_short")} {quotes.routes.length > 0 && <span className="jumper-route-count">{quotes.routes.length}</span>}</h2>
        <div className="jumper-routes-tools">{params && <QuoteCountdown compact expiresAt={quotes.expiresAt} retryAt={quotes.retryAt} loading={quotes.loading} waiting={quotes.waiting} suspended={swapping || Boolean(pendingRango)} />}
        {params && <button type="button" className="jumper-refresh-icon" aria-label={translate("refresh_quotes")} title={translate("refresh_quotes")} disabled={swapping || Boolean(pendingRango) || quotes.loading} onClick={quotes.refresh}>↻</button>}</div>
      </div>
      {!quotes.routes.length && !quotes.loading && <div className="jumper-routes-empty"><span aria-hidden="true">⇄</span><p>{translate(params ? "no_routes_hint" : "routes_empty_description")}</p></div>}
      {quotes.loading && <div role="status" className="jumper-route-loading"><span>{translate(quotes.routes.length ? "route_waiting_others" : "searching_routes")}</span>{!quotes.routes.length && <div className="jumper-route-skeleton" aria-hidden="true"><i /><i /><i /></div>}</div>}
      {quotes.warnings.map((warning) => <p key={warning.provider} className="jumper-warning">{translate("provider_unavailable", { provider: warning.provider === "lifi" ? "LI.FI" : "Rango" })}</p>)}
      <RouteList routes={quotes.routes} selectedId={selectedRoute?.id ?? null} onSelect={(route) => setSelectedId(route.id)} toDecimals={toToken?.decimals ?? 18} toSymbol={toToken?.symbol ?? ""} currency={currency} eurRate={fx?.rate ?? null} priceUsd={price(toToken)} disabled={swapping || Boolean(pendingRango) || quotes.loading || quotes.expired} />
    </aside>
      <div className="jumper-swap-footer">
      <details className="jumper-settings"><summary><span aria-hidden="true">⚙</span><span>{translate("slippage_short")} {(SLIPPAGE * 100).toLocaleString(lang)}%</span><span className="jumper-settings-divider">·</span><span>{translate("hermes_fee_short")} {(PLATFORM_FEE * 100).toLocaleString(lang)}%</span><span className="jumper-settings-chevron" aria-hidden="true">⌄</span></summary>
      <dl className="jumper-summary"><div><dt>{translate("platform_fee")}</dt><dd>{(PLATFORM_FEE * 100).toLocaleString(lang)}%</dd></div><div><dt>{translate("slippage_label")}</dt><dd>{SLIPPAGE * 100}%</dd></div></dl><p className="jumper-hint">{translate("route_sort_hint")} {translate("route_estimates")}</p></details>
      {currency === "EUR" && fx && <p className="jumper-hint">{translate("fx_reference", { date: fx.date })}</p>}
      <button type="button" className="jumper-cta" disabled={isConnected ? !canSwap : !onConnect} onClick={() => isConnected ? void handleSwap() : onConnect?.()}>{label}</button>
      <div aria-live="polite">
        {amount.trim() && parsed == null && <p className="jumper-error">{translate("amount_invalid")}</p>}
        {sameToken && <p className="jumper-hint">{translate("same_token")}</p>}
        {insufficientBalance && <p className="jumper-warning">{translate("insufficient_balance")}</p>}
        {!insufficientBalance && insufficientGas && <p className="jumper-warning">{translate("insufficient_gas")}</p>}
        {isConnected && params && !balanceReady && <p className="jumper-hint">{translate("balance_unavailable")}</p>}
        {!isConnected && <p className="jumper-hint">{translate("connect_to_continue")}</p>}
        {(quotes.error || error) && <p className="jumper-error" role="alert">{error || quotes.error}</p>}
        {success && <p className="jumper-success" role="status">{translate("swap_success")}</p>}
        {error && (execution || rangoProgress?.txHash) && <p className="jumper-warning">{translate("wallet_history")}</p>}
      </div>
      {actions.length > 0 && <div className="jumper-progress"><p>{translate("execution_progress")}</p>{actions.map((action, index) => <div key={index}><span>{action.type} · {action.status}</span>{action.txLink && /^https:\/\//.test(action.txLink) && <a href={action.txLink} target="_blank" rel="noopener noreferrer">{action.txHash?.slice(0, 12) ?? "↗"} ↗</a>}</div>)}</div>}
      {rangoProgress && <div className="jumper-progress" role="status"><p>Rango · {translate(`rango_${rangoProgress.stage}`)}</p>{rangoProgress.txLink && <a href={rangoProgress.txLink} target="_blank" rel="noopener noreferrer">{rangoProgress.txHash?.slice(0, 12)} ↗</a>}</div>}
      {pendingRango && <div className="jumper-warning" role="status"><p>{translate("rango_pending")}</p><a href={transactionLink(pendingRango.chainId, pendingRango.txHash)} target="_blank" rel="noopener noreferrer">{pendingRango.txHash.slice(0, 12)} ↗</a><button type="button" className="jumper-refresh" disabled={swapping} onClick={() => void resumeRango()}>{translate("rango_resume")}</button></div>}
      {providers.rango && <p className="jumper-test-notice">{translate("rango_test_notice")}</p>}
      </div>
    </div>
    <TokenSelectModal open={modalSide !== null && !swapping} onClose={() => setModalSide(null)} chains={APP_CHAINS} selectedChainId={modalSide === "to" ? toChainId : fromChainId} selectedToken={modalSide === "to" ? toToken : fromToken} onSelect={(chainId, token) => handleSelect(modalSide ?? "from", chainId, token)} title={translate(modalSide === "to" ? "destination_token" : "source_token")} />
  </>;
}

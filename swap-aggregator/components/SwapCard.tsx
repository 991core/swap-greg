"use client";

import type { ExtendedChain, RouteExtended } from "@lifi/sdk";
import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { RouteList } from "./RouteList";
import TokenSelectModal from "./TokenSelectModal";
import { CHAIN_LABELS } from "@/lib/chains";
import { type AppToken, type SwapParams, fetchSupportedChains, buildKnownFallbackTokens, formatTokenAmount, parseTokenAmount } from "@/lib/lifi";
import { balancePercentage } from "@/lib/amounts";
import { formatCurrencyValue, fetchTokenPriceUsd, fetchUsdEurRate, getPriceLookupKey, type FxRate } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";
import { useSwapQuotes } from "@/lib/routing/useSwapQuotes";
import { canExecuteQuote, sourceGasAmount } from "@/lib/routing/quote";
import { normalizeLifiRoute } from "@/lib/routing/normalize";
import { executeSwapQuote, SwapValidationError } from "@/lib/routing/execute";
import { PLATFORM_FEE, SLIPPAGE } from "@/lib/routing/config";

type Side = "from" | "to";
function TokenSelector({ token, chainId, onClick }: { token: AppToken | null; chainId: number; onClick: () => void }) {
  const { translate } = useI18n();
  return <button type="button" className="jumper-token-select" onClick={onClick}>
    {token?.logoURI ? <img className="jumper-token-logo" src={token.logoURI} alt="" /> : <span className="jumper-token-logo placeholder">{(token?.symbol ?? "?").slice(0, 2)}</span>}
    <span className="jumper-token-info"><span className="jumper-token-symbol">{token?.symbol ?? translate("modal_title")}</span><span className="jumper-chain-badge">{CHAIN_LABELS[chainId]}</span></span>
    <span aria-hidden>▾</span>
  </button>;
}

export function SwapCard() {
  const { address, isConnected } = useAccount();
  const { translate, lang } = useI18n();
  const [chains, setChains] = useState<ExtendedChain[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<number, AppToken[]>>({});
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<"boot_no_chains" | "boot_failed" | null>(null);
  const [fromChainId, setFromChainId] = useState(8453);
  const [toChainId, setToChainId] = useState(1);
  const [fromToken, setFromToken] = useState<AppToken | null>(null);
  const [toToken, setToToken] = useState<AppToken | null>(null);
  const [amount, setAmount] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const executionLock = useRef(false);
  const [execution, setExecution] = useState<RouteExtended | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalSide, setModalSide] = useState<Side | null>(null);
  const [priceLookup, setPriceLookup] = useState<Record<string, number>>({});
  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const [fx, setFx] = useState<FxRate | null>(null);
  const currencyValue = (value: number | null) => formatCurrencyValue(value, currency, fx?.rate, lang);

  const isNative = Boolean(fromToken && /^0x0{40}$/i.test(fromToken.address));
  const nativeBalance = useBalance({ address, chainId: fromChainId, query: { enabled: Boolean(address && fromToken), refetchInterval: 15_000 } });
  const erc20Balance = useReadContract({ address: fromToken?.address as Address | undefined, chainId: fromChainId, abi: erc20Abi,
    functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: Boolean(address && fromToken && !isNative), refetchInterval: 15_000 } });
  const sourceBalance = isNative ? nativeBalance.data?.value : erc20Balance.data;
  const parsed = fromToken ? parseTokenAmount(amount, fromToken.decimals) : null;
  const sameToken = Boolean(fromToken && toToken && fromChainId === toChainId && fromToken.address.toLowerCase() === toToken.address.toLowerCase());
  const params: SwapParams | null = isConnected && address && fromToken && toToken && parsed && parsed !== "0" && !sameToken
    ? { fromChainId, toChainId, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address, fromAmount: parsed, fromAddress: address } : null;
  const quotes = useSwapQuotes(params, !swapping);
  const selectedRoute = quotes.routes.find((route) => route.id === selectedId) ?? quotes.routes[0] ?? null;
  const insufficientBalance = Boolean(parsed && sourceBalance !== undefined && BigInt(parsed) > sourceBalance);
  const insufficientGas = Boolean(selectedRoute && nativeBalance.data && (nativeBalance.data.value < sourceGasAmount(selectedRoute) + (isNative && parsed ? BigInt(parsed) : BigInt(0)) || nativeBalance.data.value === BigInt(0)));
  const balanceReady = sourceBalance !== undefined && nativeBalance.data !== undefined;
  const canSwap = isConnected && !swapping && !quotes.loading && !quotes.expired && balanceReady && !insufficientBalance && !insufficientGas && canExecuteQuote(selectedRoute, params);
  const receivePreview = selectedRoute && toToken ? formatTokenAmount(selectedRoute.toAmount, toToken.decimals) : "";
  const price = (token: AppToken | null) => token ? priceLookup[getPriceLookupKey(token)] ?? Number(token.priceUSD ?? 0) : 0;
  const inputValue = parsed && fromToken && price(fromToken) > 0 ? Number(formatTokenAmount(parsed, fromToken.decimals, fromToken.decimals)) * price(fromToken) : null;
  const outputValue = receivePreview && price(toToken) > 0 ? Number(receivePreview) * price(toToken) : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supported = await fetchSupportedChains();
        if (cancelled) return;
        if (!supported.length) { setBootError("boot_no_chains"); return; }
        const tokens = Object.fromEntries(supported.map((c) => [c.id, buildKnownFallbackTokens(c.id)]));
        setChains(supported); setTokensByChain(tokens);
        const source = supported.find((c) => c.id === 8453)?.id ?? supported[0].id;
        const destination = supported.find((c) => c.id === 1)?.id ?? supported.at(-1)!.id;
        const defaultToken = (id: number) => tokens[id]?.find((t) => /^0x0{40}$/i.test(t.address)) ?? tokens[id]?.[0] ?? null;
        setFromChainId(source); setToChainId(destination);
        setFromToken(defaultToken(source)); setToToken(defaultToken(destination));
      } catch { if (!cancelled) setBootError("boot_failed"); }
      finally { if (!cancelled) setBootLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

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
    const load = async () => { const rate = await fetchUsdEurRate(); if (!cancelled) { setFx(rate); if (!rate) setCurrency("USD"); } };
    void load(); const timer = setInterval(() => void load(), 300_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  function handleSelect(side: Side, chainId: number, token: AppToken) {
    if (executionLock.current) return;
    setError(null); setSuccess(false);
    if (side === "from") { setFromChainId(chainId); setFromToken(token); setAmount(""); }
    else { setToChainId(chainId); setToToken(token); }
  }
  function invert() {
    if (executionLock.current) return;
    setFromChainId(toChainId); setToChainId(fromChainId); setFromToken(toToken); setToToken(fromToken); setAmount(""); setError(null); setSuccess(false);
  }
  async function handleSwap() {
    if (executionLock.current || !canSwap || !selectedRoute || !params) return;
    executionLock.current = true; setSwapping(true); setError(null); setSuccess(false); setExecution(null);
    const route = selectedRoute;
    try {
      const completed = await executeSwapQuote(route, params, (updated) => {
        setExecution(updated);
        quotes.updateRoute(normalizeLifiRoute(updated, params, route.expiresAt));
      }, { fromToken: fromToken!, toToken: toToken! });
      setExecution(completed); setSuccess(completed.steps.every((step) => step.execution?.status === "DONE"));
    } catch (cause) {
      setError(cause instanceof SwapValidationError ? translate(cause.key) : cause instanceof Error ? cause.message : translate("swap_exec_error"));
    } finally {
      quotes.refresh(); setSelectedId(null); executionLock.current = false; setSwapping(false);
      void nativeBalance.refetch(); if (!isNative) void erc20Balance.refetch();
    }
  }

  if (bootLoading) return <div className="jumper-state" role="status"><div className="jumper-skeleton" /><p>{translate("boot_loading")}</p></div>;
  if (bootError) return <p className="jumper-error" role="alert">{translate(bootError)}</p>;
  const actions = execution?.steps.flatMap((step) => step.execution?.actions ?? []) ?? [];
  const label = !isConnected ? translate("cta_connect_wallet") : swapping ? translate("cta_executing") : quotes.loading ? translate("cta_searching") : translate("cta_swap");
  return <>
    <div className="jumper-swap-widget">
      <fieldset disabled={swapping} className="jumper-form">
        <div className="jumper-panel">
          <div className="jumper-panel-header"><label htmlFor="swap-amount">{translate("send_label")}</label>
            {sourceBalance !== undefined && fromToken && <span className="jumper-balance-pill">{formatTokenAmount(sourceBalance.toString(), fromToken.decimals)} {fromToken.symbol}</span>}
          </div>
          <div className="jumper-panel-input"><input id="swap-amount" className="jumper-amount-input" type="text" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); setSuccess(false); }} />
            <TokenSelector token={fromToken} chainId={fromChainId} onClick={() => setModalSide("from")} /></div>
          <p className="jumper-hint">{currencyValue(inputValue) ?? "—"}</p>
          {fromToken && sourceBalance !== undefined && <div className="jumper-quick-row">{(isNative ? [25, 50, 75] : [25, 50, 75, 100]).map((pct) => <button key={pct} type="button" className="jumper-pct-btn" onClick={() => setAmount(balancePercentage(sourceBalance, pct, fromToken.decimals))}>{pct}%</button>)}</div>}
          {isNative && <p className="jumper-hint">{translate("native_gas_hint")}</p>}
        </div>
        <button type="button" className="jumper-swap-invert" onClick={invert} aria-label={translate("invert_label")}>⇅</button>
        <div className="jumper-panel">
          <label htmlFor="receive-amount" className="jumper-panel-label">{translate("receive_label")}</label>
          <div className="jumper-panel-input"><input id="receive-amount" className="jumper-amount-input" readOnly value={receivePreview} placeholder="—" />
            <TokenSelector token={toToken} chainId={toChainId} onClick={() => setModalSide("to")} /></div>
          <p className="jumper-hint">{currencyValue(outputValue) ?? "—"}</p>
        </div>
      </fieldset>
      <div className="jumper-providers"><span className="jumper-hint">{translate("providers_label")}</span><span className="jumper-prov active">LI.FI</span>{["Rango", "Socket"].map((provider) => <button key={provider} type="button" className="jumper-prov" disabled>{provider} · {translate("provider_soon")}</button>)}</div>
      <dl className="jumper-summary"><div><dt>{translate("platform_fee")}</dt><dd>{(PLATFORM_FEE * 100).toLocaleString(lang)}%</dd></div><div><dt>{translate("slippage_label")}</dt><dd>{SLIPPAGE * 100}%</dd></div></dl>
      <div className="jumper-currency-row"><span>{translate("currency_label")}</span><select aria-label={translate("currency_label")} value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "EUR")}><option value="USD">USD</option><option value="EUR" disabled={!fx}>EUR</option></select></div>
      {currency === "EUR" && fx && <p className="jumper-hint">{translate("fx_reference", { date: fx.date })}</p>}
      {!fx && <p className="jumper-hint">{translate("fx_unavailable")}</p>}
      <button type="button" className="jumper-cta" disabled={!canSwap} onClick={() => void handleSwap()}>{label}</button>
      <div aria-live="polite">
        {amount.trim() && parsed == null && <p className="jumper-error">{translate("amount_invalid")}</p>}
        {sameToken && <p className="jumper-hint">{translate("same_token")}</p>}
        {insufficientBalance && <p className="jumper-warning">{translate("insufficient_balance")}</p>}
        {!insufficientBalance && insufficientGas && <p className="jumper-warning">{translate("insufficient_gas")}</p>}
        {isConnected && params && !balanceReady && <p className="jumper-hint">{translate("balance_unavailable")}</p>}
        {!isConnected && <p className="jumper-hint">{translate("connect_to_continue")}</p>}
        {(quotes.error || error) && <p className="jumper-error" role="alert">{error || quotes.error}</p>}
        {success && <p className="jumper-success" role="status">{translate("swap_success")}</p>}
        {error && execution && <p className="jumper-warning">{translate("wallet_history")}</p>}
      </div>
      {actions.length > 0 && <div className="jumper-progress"><p>{translate("execution_progress")}</p>{actions.map((action, index) => <div key={index}><span>{action.type} · {action.status}</span>{action.txLink && /^https:\/\//.test(action.txLink) && <a href={action.txLink} target="_blank" rel="noopener noreferrer">{action.txHash?.slice(0, 12) ?? "↗"} ↗</a>}</div>)}</div>}
    </div>
    <aside className="jumper-routes-panel" aria-live="polite">
      <RouteList routes={quotes.routes} selectedId={selectedRoute?.id ?? null} onSelect={(route) => setSelectedId(route.id)} toDecimals={toToken?.decimals ?? 18} toSymbol={toToken?.symbol ?? ""} currency={currency} eurRate={fx?.rate ?? null} priceUsd={price(toToken)} disabled={swapping || quotes.expired} />
      {params && !quotes.loading && !quotes.routes.length && !quotes.error && <p className="jumper-hint">{translate("no_routes_hint")}</p>}
      {quotes.expired && <p className="jumper-warning">{translate("quote_expired")}</p>}
      {params && <button type="button" className="jumper-refresh" disabled={swapping || quotes.loading} onClick={quotes.refresh}>{translate("refresh_quotes")}</button>}
    </aside>
    <TokenSelectModal open={modalSide !== null && !swapping} onClose={() => setModalSide(null)} chains={chains} tokensByChain={tokensByChain} selectedChainId={modalSide === "to" ? toChainId : fromChainId} selectedToken={modalSide === "to" ? toToken : fromToken} onSelect={(chainId, token) => handleSelect(modalSide ?? "from", chainId, token)} title={translate(modalSide === "to" ? "destination_token" : "source_token")} />
  </>;
}

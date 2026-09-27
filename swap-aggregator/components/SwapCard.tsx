"use client";

import type { ExtendedChain, Route } from "@lifi/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChainSelect } from "./ChainSelect";
import { CurrencySwitch } from "./CurrencySwitch";
import { TokenIcon } from "./TokenIcon";
import { ProviderBadge } from "./ProviderBadge";
import { useAccount, useBalance, useConfig, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { erc20Abi, formatUnits, isAddress, type Address } from "viem";
import { RouteList } from "@/components/RouteList";
import TokenSelectModal from "@/components/TokenSelectModal";

import {
  type AppToken,
  executeLifiRoute,
  fetchNormalizedRoutes,
  fetchSupportedChains,
  fetchTopTokensByChain,
  formatTokenAmount,
  parseTokenAmount,
  setLifiWalletClient,
} from "@/lib/lifi";
import { formatCurrencyValue, fetchTokenPriceUsd, getPriceLookupKey } from "@/lib/pricing";
import type { NormalizedRoute, ProviderName, ProviderSelection } from "@/lib/types/normalized-route";
import { fetchOneClickQuote, fetchOneClickTokens } from "@/lib/aggregators/oneclick/client";
import { useI18n } from "@/lib/i18n";

type Side = "from" | "to";
type PendingOneClick = { wallet: Address; fromChainId: number; depositAddress: Address; hash: `0x${string}`; status: string; destinationUrl?: string };
const PENDING_KEY = "hermes:oneclick:latest";
const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io/tx/", 8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/", 10: "https://optimistic.etherscan.io/tx/",
  137: "https://polygonscan.com/tx/", 100: "https://gnosisscan.io/tx/",
  56: "https://bscscan.com/tx/", 43114: "https://snowtrace.io/tx/",
};

function formatQuickAmount(raw: string, decimals: number) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "";
  const fixed = numeric.toFixed(Math.min(decimals, 6));
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

// ──────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────

function TokenSelector({ token, onClick }: { token: AppToken | null; onClick: () => void }) {
  const { translate } = useI18n();
  return <button type="button" className="jumper-token-select" onClick={onClick}>
    <TokenIcon token={token} />
    <span className="jumper-token-info"><span className="jumper-token-symbol">{token?.symbol ?? translate("modal_title")}</span><span className="jumper-token-name">{token?.name}</span></span>
    <span className="jumper-chevron" aria-hidden="true">⌄</span>
  </button>;
}

// ──────────────────────────────────────────────
// Main SwapCard
// ──────────────────────────────────────────────

export function SwapCard({ onConnect }: { onConnect?: () => void } = {}) {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useConfig();
  const { translate } = useI18n();

  const [chains, setChains] = useState<ExtendedChain[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<number, AppToken[]>>({});
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const [fromChainId, setFromChainId] = useState(8453);
  const [toChainId, setToChainId] = useState(1);
  const [fromToken, setFromToken] = useState<AppToken | null>(null);
  const [toToken, setToToken] = useState<AppToken | null>(null);
  const [amount, setAmount] = useState("");

  const [routes, setRoutes] = useState<NormalizedRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<NormalizedRoute | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [priceLookup, setPriceLookup] = useState<Record<string, number>>({});
  const [currencySlot, setCurrencySlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setCurrencySlot(document.getElementById("hermes-currency-slot")); }, []);
  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const [providers, setProviders] = useState<ProviderSelection>({ lifi: true, socket: false, rango: true, oneclick: true });
  const [swapping, setSwapping] = useState(false);
  const [pendingOneClick, setPendingOneClick] = useState<PendingOneClick | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [modalSide, setModalSide] = useState<Side | null>(null);
  const requestId = useRef(0);

  const isNativeFromToken =
    fromToken !== null && (!fromToken.address || fromToken.address === "0x0000000000000000000000000000000000000000");
  const nativeBalance = useBalance({
    address,
    chainId: fromChainId,
    query: { enabled: Boolean(address) && Boolean(fromToken) && isNativeFromToken },
  });
  const erc20Balance = useReadContract({
    address: (fromToken?.address as Address | undefined) ?? undefined,
    chainId: fromChainId,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && Boolean(fromToken) && !isNativeFromToken },
  });

  useEffect(() => {
    setLifiWalletClient(walletClient ?? null);
  }, [walletClient]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as PendingOneClick | null;
      if (stored && address?.toLowerCase() === stored.wallet?.toLowerCase() &&
          isAddress(stored.depositAddress) && /^0x[0-9a-fA-F]{64}$/.test(stored.hash)) {
        setPendingOneClick(stored);
      } else {
        setPendingOneClick(null);
      }
    } catch { setPendingOneClick(null); }
  }, [address]);

  useEffect(() => {
    if (!pendingOneClick || ["SUCCESS", "REFUNDED", "FAILED"].includes(pendingOneClick.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/oneclick/status?depositAddress=${encodeURIComponent(pendingOneClick.depositAddress)}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const result = await response.json() as { status?: string; destinationUrl?: string };
        if (!result.status || cancelled) return;
        setPendingOneClick((previous) => {
          if (!previous || previous.depositAddress !== pendingOneClick.depositAddress) return previous;
          const updated = { ...previous, status: result.status!, destinationUrl: result.destinationUrl };
          localStorage.setItem(PENDING_KEY, JSON.stringify(updated));
          return updated;
        });
      } catch { /* Retain the deposit record and retry on the next poll. */ }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pendingOneClick?.depositAddress, pendingOneClick?.status]);

  useEffect(() => {
    let cancelled = false;
    async function loadPrices() {
      const tokensToFetch = [fromToken, toToken].filter(Boolean) as AppToken[];
      if (tokensToFetch.length === 0) return;
      const nextPrices: Record<string, number> = {};
      for (const token of tokensToFetch) {
        const price = await fetchTokenPriceUsd(token);
        if (!cancelled && price != null) {
          nextPrices[getPriceLookupKey(token)] = price;
        }
      }
      if (!cancelled) setPriceLookup((current) => ({ ...current, ...nextPrices }));
    }
    void loadPrices();
    return () => { cancelled = true; };
  }, [fromToken?.address, fromToken?.chainId, fromToken?.symbol, toToken?.address, toToken?.chainId, toToken?.symbol]);

  // ── boot data ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      setBootError(null);
      try {
        const supported = await fetchSupportedChains();
        if (cancelled) return;
        if (supported.length === 0) {
          setBootError(translate("boot_no_chains"));
          setBootLoading(false);
          return;
        }
        setChains(supported);
        const ids = supported.map((c) => c.id);
        const tokens = await fetchTopTokensByChain(ids);
        if (cancelled) return;

        let mergedTokens = { ...tokens };
        try {
          const oneClickTokens = await fetchOneClickTokens();
          if (cancelled) return;
          for (const chainId of ids) {
            const known = mergedTokens[chainId] ?? [];
            const extra = (oneClickTokens[chainId] ?? []).filter((token) =>
              !known.some((item) => item.address.toLowerCase() === token.address.toLowerCase()),
            );
            mergedTokens[chainId] = [...known, ...extra];
          }
        } catch { /* LI.FI tokens remain available if 1Click is offline. */ }
        if (Object.keys(tokens).length === 0) {
          const fallbackChain1: AppToken[] = [
            { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", chainId: 1, decimals: 18, logoURI: "https://ethereum-optimism.github.io/data/ETH/eth-logo.svg", name: "Wrapped Ether", symbol: "WETH", topSymbol: "WETH", priceUSD: "3000" },
            { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", chainId: 1, decimals: 6, logoURI: "https://ethereum-optimism.github.io/data/USDC/usdc-logo.png", name: "USD Coin", symbol: "USDC", topSymbol: "USDC", priceUSD: "1" },
          ];
          const fallbackChain8453: AppToken[] = [
            { address: "0x4200000000000000000000000000000000000006", chainId: 8453, decimals: 18, logoURI: "https://ethereum-optimism.github.io/data/ETH/eth-logo.svg", name: "Wrapped Ether", symbol: "WETH", topSymbol: "WETH", priceUSD: "3000" },
            { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453, decimals: 6, logoURI: "https://ethereum-optimism.github.io/data/USDC/usdc-logo.png", name: "USD Coin", symbol: "USDC", topSymbol: "USDC", priceUSD: "1" },
          ];
          mergedTokens[1] = fallbackChain1;
          mergedTokens[8453] = fallbackChain8453;
        }
        setTokensByChain(mergedTokens);
      } catch {
        if (!cancelled) setBootError(translate("boot_failed"));
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (fromToken || Object.keys(tokensByChain).length === 0) return;
    const baseTokens = tokensByChain[fromChainId] ?? [];
    const defaultToken = baseTokens.find(
      (t) => t.topSymbol === "ETH" || t.symbol?.toUpperCase() === "ETH" || t.symbol?.toUpperCase() === "WETH",
    );
    if (defaultToken) setFromToken(defaultToken);
  }, [fromToken, fromChainId, tokensByChain]);

  // ── fetch routes ─────────────────────────
  const loadRoutes = useCallback(async () => {
    if (!fromToken || !toToken || !isConnected || !address) {
      setRoutes([]);
      setSelectedRoute(null);
      return;
    }
    const parsed = parseTokenAmount(amount, fromToken.decimals);
    if (!parsed || parsed === "0") {
      setRoutes([]);
      setSelectedRoute(null);
      return;
    }

    const id = ++requestId.current;
    setLoadingRoutes(true);
    setError(null);
    setRoutes([]);
    setSelectedRoute(null);

    try {
      const nextRoutes = await fetchNormalizedRoutes({
        fromChainId, toChainId,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
        fromAmount: parsed,
        fromAddress: address,
        fromTokenDecimals: fromToken.decimals,
        toTokenDecimals: toToken.decimals,
        providers,
      });
      if (id !== requestId.current) return;
      setRoutes(nextRoutes);
      setSelectedRoute(nextRoutes[0] ?? null);
    } catch (error) {
      if (id !== requestId.current) return;
      const message = error instanceof Error ? error.message : translate("routes_fetch_failed");
      setError(message);
    } finally {
      if (id === requestId.current) setLoadingRoutes(false);
    }
  }, [address, isConnected, amount, fromChainId, providers, toChainId, fromToken, toToken, translate]);

  useEffect(() => {
    if (!fromToken || !toToken) { setRoutes([]); setSelectedRoute(null); return; }
    const t = setTimeout(() => { void loadRoutes(); }, 500);
    return () => clearTimeout(t);
  }, [isConnected, fromToken, toToken, loadRoutes]);

  // ── derived values ───────────────────────
  const receivePreview = useMemo(() => {
    if (!selectedRoute || !toToken) return null;
    return formatTokenAmount(selectedRoute.toAmount, toToken.decimals);
  }, [selectedRoute, toToken]);

  const sourceBalance = useMemo(() => {
    if (!fromToken) return null;
    if (isNativeFromToken && nativeBalance.data) return formatUnits(nativeBalance.data.value, nativeBalance.data.decimals ?? 18);
    if (erc20Balance.data && typeof erc20Balance.data === "bigint") return formatUnits(erc20Balance.data, fromToken.decimals ?? 18);
    return null;
  }, [erc20Balance.data, fromToken, isNativeFromToken, nativeBalance.data]);

  const sourceBalanceLabel = useMemo(() => {
    if (!fromToken || !sourceBalance) return null;
    const formatted = formatQuickAmount(sourceBalance, fromToken.decimals ?? 18);
    return `${formatted} ${fromToken.symbol}`;
  }, [fromToken, sourceBalance]);

  const fromTokenUsdValue = useMemo(() => {
    if (!fromToken || !amount) return null;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
    const tokenPrice = priceLookup[getPriceLookupKey(fromToken)] ?? Number(fromToken.priceUSD ?? "0");
    if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) return null;
    return numericAmount * tokenPrice;
  }, [amount, fromToken, priceLookup]);

  const receiveUsdValue = useMemo(() => {
    if (!toToken || !receivePreview) return null;
    const numericAmount = Number(receivePreview);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
    const tokenPrice = priceLookup[getPriceLookupKey(toToken)] ?? Number(toToken.priceUSD ?? "0");
    if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) return null;
    return numericAmount * tokenPrice;
  }, [receivePreview, toToken, priceLookup]);

  function applyQuickAmount(percent: number) {
    if (!fromToken || !sourceBalance) return;
    const balanceValue = Number(sourceBalance);
    if (!Number.isFinite(balanceValue) || balanceValue <= 0) return;
    setAmount(formatQuickAmount(String(balanceValue * (percent / 100)), fromToken.decimals ?? 18));
  }

  function invert() {
    const nextAmount = receivePreview ?? amount;
    setFromChainId(toChainId); setToChainId(fromChainId);
    setFromToken(toToken); setToToken(fromToken);
    setAmount(nextAmount);
    setRoutes([]); setSelectedRoute(null); setError(null);
  }

  function toggleProvider(provider: ProviderName) {
    setProviders((c) => ({ ...c, [provider]: !c[provider] }));
  }

  function handleSelect(side: Side, chainId: number, token: AppToken) {
    if (side === "from") { setFromChainId(chainId); setFromToken(token); }
    else { setToChainId(chainId); setToToken(token); }
  }

  async function handleSwap() {
    if (!selectedRoute || !walletClient || !fromToken) return;
    if (selectedRoute.provider !== "lifi" && selectedRoute.provider !== "oneclick") return;
    setSwapping(true); setError(null);
    try {
      if (walletChainId !== fromChainId && switchChainAsync) {
        await switchChainAsync({ chainId: fromChainId });
      }
      if (selectedRoute.provider === "oneclick") {
        if (!address || !toToken || !isAddress(fromToken.address)) throw new Error("Connect an EVM wallet and select an ERC20 token.");
        const params = {
          fromChainId, toChainId, fromTokenAddress: fromToken.address, toTokenAddress: toToken.address,
          fromAmount: selectedRoute.fromAmount, fromAddress: address,
          fromTokenDecimals: fromToken.decimals, toTokenDecimals: toToken.decimals,
        };
        const currentAmount = parseTokenAmount(amount, fromToken.decimals);
        if (currentAmount !== selectedRoute.fromAmount ||
            fromToken.address.toLowerCase() !== selectedRoute.fromTokenAddress.toLowerCase() ||
            toToken.address.toLowerCase() !== selectedRoute.toTokenAddress.toLowerCase()) {
          throw new Error("The selected route changed. Refresh the quote before swapping.");
        }
        const quote = await fetchOneClickQuote(params, false);
        if (!quote.depositAddress || !isAddress(quote.depositAddress) || quote.amountIn !== selectedRoute.fromAmount ||
            !quote.deadline || Date.parse(quote.deadline) <= Date.now() + 30_000) {
          throw new Error("The executable 1Click quote is invalid or expired.");
        }
        const minimum = formatTokenAmount(quote.minAmountOut, toToken.decimals);
        if (!window.confirm(translate("oneclick_confirm", {
          amount: formatTokenAmount(quote.amountIn, fromToken.decimals),
          from: fromToken.symbol, minimum, to: toToken.symbol,
        }))) return;
        const hash = await writeContract(wagmiConfig, {
          account: address,
          chainId: fromChainId,
          address: fromToken.address as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [quote.depositAddress, BigInt(quote.amountIn)],
        });
        const pending: PendingOneClick = { wallet: address, fromChainId, depositAddress: quote.depositAddress, hash, status: "PENDING_DEPOSIT" };
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        setPendingOneClick(pending);
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: fromChainId });
        if (receipt.status !== "success") throw new Error("The token transfer reverted on the source chain.");
        return;
      }
      const rawRoute = selectedRoute.raw as Route | null;
      if (!rawRoute) throw new Error(translate("route_no_payload"));
      await executeLifiRoute(rawRoute, {
        updateRouteHook: (updated) => {
          setSelectedRoute((prev) => prev ? { ...prev, raw: updated, toAmount: updated.toAmount ?? prev.toAmount, durationSeconds: updated.steps?.reduce((a, s) => a + (s.estimate?.executionDuration ?? 0), 0) ?? prev.durationSeconds } : prev);
          setRoutes((prev) => prev.map((r) => r.id === prev[0]?.id ? { ...r, raw: updated, toAmount: updated.toAmount ?? r.toAmount } : r));
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : translate("swap_exec_error");
      setError(message);
    } finally { setSwapping(false); }
  }

  // ── States ───────────────────────────────
  if (bootLoading) {
    return (
      <div className="jumper-state">
        <div className="jumper-skeleton" style={{ height: 300 }} />
        <p className="jumper-hint">{translate("boot_loading")}</p>
      </div>
    );
  }

  if (bootError && !fromToken) {
    return (
      <div className="jumper-state">
        <p className="jumper-error">{bootError}</p>
      </div>
    );
  }

  const activeOneClick = pendingOneClick && !["SUCCESS", "REFUNDED", "FAILED"].includes(pendingOneClick.status);
  const ctaDisabled = !isConnected || !selectedRoute || swapping || loadingRoutes || !fromToken || !toToken ||
    (activeOneClick && selectedRoute.provider === "oneclick") ||
    (selectedRoute.provider !== "lifi" && selectedRoute.provider !== "oneclick");
  let ctaLabel = translate("cta_swap");
  if (!isConnected) ctaLabel = translate("cta_connect_wallet");
  else if (loadingRoutes) ctaLabel = translate("cta_searching");
  else if (swapping) ctaLabel = translate("cta_executing");
  else if (!selectedRoute) ctaLabel = translate("cta_no_route");
  else if (activeOneClick && selectedRoute.provider === "oneclick") ctaLabel = translate("oneclick_status", { status: pendingOneClick.status });
  else if (ctaDisabled && selectedRoute.provider !== "lifi" && selectedRoute.provider !== "oneclick") ctaLabel = translate("oneclick_unavailable_route");

  function changeChain(side: Side, chainId: number) {
    const token = tokensByChain[chainId]?.[0] ?? null;
    if (side === "from") { setFromChainId(chainId); setFromToken(token); setAmount(""); }
    else { setToChainId(chainId); setToToken(token); }
    setRoutes([]); setSelectedRoute(null);
  }

  return <>
    {currencySlot && createPortal(<CurrencySwitch value={currency} onChange={setCurrency} eurAvailable />, currencySlot)}
    <div className="jumper-swap-widget">
      <div className="jumper-swap-toolbar">
        <div className="jumper-swap-title"><h2>{translate("swap_title")}</h2>
          <div className="jumper-providers"><span className="jumper-hint">{translate("providers_label")}</span>
            {(["lifi", "oneclick", "rango", "socket"] as ProviderName[]).map((provider) => (
              <button key={provider} type="button" className={`jumper-prov${providers[provider] ? " active" : ""}`} aria-pressed={providers[provider]} disabled={swapping} onClick={() => toggleProvider(provider)}>
                <ProviderBadge provider={provider} /><span aria-hidden="true">{providers[provider] ? "✓" : "+"}</span>
              </button>
            ))}
          </div>
        </div>
        {!currencySlot && <CurrencySwitch value={currency} onChange={setCurrency} eurAvailable />}
      </div>
      <fieldset disabled={swapping} className="jumper-form">
        <div className="jumper-panel">
          <div className="jumper-panel-header"><label htmlFor="swap-amount">{translate("send_label")}</label>
            <ChainSelect chainId={fromChainId} chains={chains} onChange={(id) => changeChain("from", id)} label={translate("source_network")} />
          </div>
          <div className="jumper-panel-input"><input id="swap-amount" className="jumper-amount-input" type="text" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <TokenSelector token={fromToken} onClick={() => setModalSide("from")} /></div>
          <div className="jumper-panel-foot"><span>{formatCurrencyValue(fromTokenUsdValue, currency) ?? "—"}</span>
            {sourceBalanceLabel && <span className="jumper-balance-pill">{translate("balance_label")}: {sourceBalanceLabel}</span>}</div>
          {fromToken && sourceBalance && <div className="jumper-quick-row">{[25, 50, 75, 100].map((pct) => <button key={pct} type="button" className="jumper-pct-btn" onClick={() => applyQuickAmount(pct)}>{pct}%</button>)}</div>}
        </div>
        <button type="button" className="jumper-swap-invert" onClick={invert} aria-label={translate("invert_label")}>⇅</button>
        <div className="jumper-panel">
          <div className="jumper-panel-header"><label htmlFor="receive-amount">{translate("receive_label")}</label>
            <ChainSelect chainId={toChainId} chains={chains} onChange={(id) => changeChain("to", id)} label={translate("destination_network")} /></div>
          <div className="jumper-panel-input"><input id="receive-amount" className="jumper-amount-input" readOnly value={receivePreview ?? ""} placeholder="—" />
            <TokenSelector token={toToken} onClick={() => setModalSide("to")} /></div>
          <p className="jumper-hint">{formatCurrencyValue(receiveUsdValue, currency) ?? "—"}</p>
        </div>
      </fieldset>
      {!Object.values(providers).some(Boolean) && <p className="jumper-warning">{translate("choose_provider")}</p>}
      <aside className="jumper-routes-panel" aria-label={translate("route_list_title")}>
        <div className="jumper-routes-heading"><h2>{translate("routes_short")} {routes.length > 0 && <span className="jumper-route-count">{routes.length}</span>}</h2>
          {isConnected && fromToken && toToken && amount && <button type="button" className="jumper-refresh-icon" aria-label={translate("refresh_quotes")} disabled={swapping || loadingRoutes} onClick={() => void loadRoutes()}>↻</button>}
        </div>
        {!routes.length && !loadingRoutes && <div className="jumper-routes-empty"><span aria-hidden="true">⇄</span><p>{translate(isConnected && amount && fromToken && toToken ? "no_routes_hint" : "routes_empty_description")}</p></div>}
        {loadingRoutes && <div role="status" className="jumper-route-loading"><span>{translate("searching_routes")}</span><div className="jumper-route-skeleton" aria-hidden="true"><i /><i /><i /></div></div>}
        <RouteList routes={routes} selectedId={selectedRoute?.id ?? null} onSelect={setSelectedRoute} toDecimals={toToken?.decimals ?? 18} toSymbol={toToken?.symbol ?? ""} currency={currency}
          priceUsd={toToken ? (priceLookup[getPriceLookupKey(toToken)] ?? Number(toToken.priceUSD ?? "0")) : null} disabled={swapping || loadingRoutes} />
      </aside>
      <div className="jumper-swap-footer">
        <details className="jumper-settings"><summary><span aria-hidden="true">⚙</span><span>{translate("hermes_fee_short")} {Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_PERCENT ?? "0")}%</span><span className="jumper-settings-chevron" aria-hidden="true">⌄</span></summary>
          <p className="jumper-hint">{translate("route_sort_hint")} {translate("route_estimates")}</p>
        </details>
        <button type="button" className="jumper-cta" disabled={isConnected ? Boolean(ctaDisabled) : !onConnect} onClick={() => isConnected ? void handleSwap() : onConnect?.()}>{ctaLabel}</button>
        {selectedRoute?.provider === "oneclick" && toToken && (
          <p className="jumper-hint">{translate("oneclick_minimum", {
            amount: formatTokenAmount((selectedRoute.raw as { minAmountOut: string }).minAmountOut, toToken.decimals),
            token: toToken.symbol,
          })}</p>
        )}
        {pendingOneClick && (
          <p className="jumper-hint" role="status">
            {translate("oneclick_status", { status: pendingOneClick.status })}{" "}
            <span title={pendingOneClick.depositAddress}>{pendingOneClick.depositAddress.slice(0, 10)}…</span>{" "}
            {EXPLORERS[pendingOneClick.fromChainId] ? (
              <a href={`${EXPLORERS[pendingOneClick.fromChainId]}${pendingOneClick.hash}`} target="_blank" rel="noopener noreferrer">
                {translate("oneclick_source_tx")}
              </a>
            ) : <span title={pendingOneClick.hash}>{pendingOneClick.hash.slice(0, 10)}…</span>}{" "}
            {pendingOneClick.destinationUrl?.startsWith("https://") && (
              <a href={pendingOneClick.destinationUrl} target="_blank" rel="noopener noreferrer">{translate("oneclick_explorer")}</a>
            )}
          </p>
        )}


        <div aria-live="polite">
          {!isConnected && <p className="jumper-hint">{translate("connect_to_continue")}</p>}
          {error && <p className="jumper-error">{error}</p>}
          {bootError && fromToken && <p className="jumper-hint">{bootError}</p>}
        </div>
      </div>
    </div>
    <TokenSelectModal open={modalSide !== null && !swapping} onClose={() => setModalSide(null)} chains={chains} tokensByChain={tokensByChain}
      selectedChainId={modalSide === "to" ? toChainId : fromChainId} selectedToken={modalSide === "to" ? toToken : fromToken}
      onSelect={(chainId, token) => handleSelect(modalSide ?? "from", chainId, token)} title={translate(modalSide === "from" ? "source_token" : "destination_token")} />
  </>;
}

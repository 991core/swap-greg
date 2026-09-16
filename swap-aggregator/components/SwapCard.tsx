"use client";

import type { ExtendedChain, Route } from "@lifi/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { RouteList } from "@/components/RouteList";
import TokenSelectModal from "@/components/TokenSelectModal";
import { CHAIN_LABELS } from "@/lib/chains";
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
import { useI18n } from "@/lib/i18n";

type Side = "from" | "to";

function formatQuickAmount(raw: string, decimals: number) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "";
  const fixed = numeric.toFixed(Math.min(decimals, 6));
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

// ──────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────

function ChainBadge({ chainId }: { chainId: number }) {
  return (
    <span className="jumper-chain-badge">
      {CHAIN_LABELS[chainId] ?? `Chain ${chainId}`}
    </span>
  );
}

function TokenSelector({
  token,
  chainId,
  onClick,
  onChainClick,
}: {
  token: AppToken | null;
  chainId: number;
  onClick: () => void;
  onChainClick: () => void;
}) {
  return (
    <button type="button" className="jumper-token-select" onClick={onClick}>
      {token?.logoURI ? (
        <img className="jumper-token-logo" src={token.logoURI} alt="" />
      ) : (
        <span className="jumper-token-logo placeholder">
          {(token?.symbol ?? "?").slice(0, 2)}
        </span>
      )}
      <span className="jumper-token-info">
        <span className="jumper-token-symbol">{token?.symbol ?? "Select"}</span>
        <span className="jumper-token-meta">
          <ChainBadge chainId={chainId} />
        </span>
      </span>
      <span className="jumper-chevron">▾</span>
    </button>
  );
}

// ──────────────────────────────────────────────
// Main SwapCard
// ──────────────────────────────────────────────

export function SwapCard() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
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
  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const [providers, setProviders] = useState<ProviderSelection>({ lifi: true, socket: false, rango: true });
  const [swapping, setSwapping] = useState(false);
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
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && Boolean(fromToken) && !isNativeFromToken },
  });

  useEffect(() => {
    setLifiWalletClient(walletClient ?? null);
  }, [walletClient]);

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
    const baseTokens = tokensByChain[8453] ?? [];
    const defaultToken = baseTokens.find(
      (t) => t.topSymbol === "ETH" || t.symbol?.toUpperCase() === "ETH" || t.symbol?.toUpperCase() === "WETH",
    );
    if (defaultToken) setFromToken(defaultToken);
  }, [fromToken, tokensByChain]);

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
        providers,
      });
      if (id !== requestId.current) return;
      setRoutes(nextRoutes);
      setSelectedRoute(nextRoutes[0] ?? null);
    } catch (error) {
      if (id !== requestId.current) return;
      const message = error instanceof Error ? error.message : translate("routes_fetch_failed");
      setError(translate("lifi_error", { message }));
    } finally {
      if (id === requestId.current) setLoadingRoutes(false);
    }
  }, [address, amount, fromChainId, providers, toChainId, fromToken, toToken, translate]);

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
    const rawRoute = selectedRoute.raw as Route | null;
    if (!rawRoute) { setError(translate("route_no_payload")); return; }
    setSwapping(true); setError(null);
    try {
      if (walletChainId !== fromChainId && switchChainAsync) {
        await switchChainAsync({ chainId: fromChainId });
      }
      await executeLifiRoute(rawRoute, {
        updateRouteHook: (updated) => {
          setSelectedRoute((prev) => prev ? { ...prev, raw: updated, toAmount: updated.toAmount ?? prev.toAmount, durationSeconds: updated.steps?.reduce((a, s) => a + (s.estimate?.executionDuration ?? 0), 0) ?? prev.durationSeconds } : prev);
          setRoutes((prev) => prev.map((r) => r.id === prev[0]?.id ? { ...r, raw: updated, toAmount: updated.toAmount ?? r.toAmount } : r));
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : translate("swap_exec_error");
      setError(translate("lifi_error", { message }));
    } finally { setSwapping(false); }
  }

  // ── States ───────────────────────────────
  if (bootLoading) {
    return (
      <div className="jumper-widget-card">
        <div className="jumper-skeleton" style={{ height: 300 }} />
        <p className="jumper-hint">{translate("boot_loading")}</p>
      </div>
    );
  }

  if (bootError && !fromToken) {
    return (
      <div className="jumper-widget-card">
        <p className="jumper-error">{bootError}</p>
      </div>
    );
  }

  const ctaDisabled = !isConnected || !selectedRoute || swapping || loadingRoutes || !fromToken || !toToken;
  let ctaLabel = translate("cta_swap");
  if (!isConnected) ctaLabel = translate("cta_connect_wallet");
  else if (loadingRoutes) ctaLabel = translate("cta_searching");
  else if (swapping) ctaLabel = translate("cta_executing");
  else if (!selectedRoute) ctaLabel = translate("cta_no_route");

  return (
    <>
      {/* ── Main swap form ── */}
      <div className="jumper-swap-widget">

        {/* Send panel */}
        <div className="jumper-panel">
          <div className="jumper-panel-header">
            <span className="jumper-panel-label">{translate("send_label")}</span>
            {sourceBalanceLabel && (
              <span className="jumper-balance-pill">
                <span className="jumper-balance-value">{sourceBalanceLabel}</span>
                {fromTokenUsdValue != null && (
                  <span className="jumper-balance-usd">≈ {formatCurrencyValue(fromTokenUsdValue, currency)}</span>
                )}
              </span>
            )}
          </div>

          <div className="jumper-panel-input">
            <input
              className="jumper-amount-input"
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="jumper-panel-picker">
              <TokenSelector
                token={fromToken}
                chainId={fromChainId}
                onClick={() => setModalSide("from")}
                onChainClick={() => setModalSide("from")}
              />
            </div>
          </div>

          {/* Quick percentage buttons */}
          {fromToken && sourceBalance && (
            <div className="jumper-quick-row">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" className="jumper-pct-btn" onClick={() => applyQuickAmount(pct)}>
                  {pct}%
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Swap invert */}
        <div className="jumper-swap-invert-wrap">
          <button type="button" className="jumper-swap-invert" onClick={invert} aria-label={translate("invert_label")}>
            <span className="jumper-swap-invert-icon">⇅</span>
          </button>
        </div>

        {/* Receive panel */}
        <div className="jumper-panel">
          <div className="jumper-panel-header">
            <span className="jumper-panel-label">{translate("receive_label")}</span>
            {receiveUsdValue != null && (
              <span className="jumper-panel-subtitle">
                {translate("received_value_prefix")} {formatCurrencyValue(receiveUsdValue, currency)}
              </span>
            )}
          </div>

          <div className="jumper-panel-input">
            <input
              className="jumper-amount-input jumper-amount-receive"
              type="text"
              disabled
              value={receivePreview ?? ""}
              placeholder="—"
            />
            <div className="jumper-panel-picker">
              <TokenSelector
                token={toToken}
                chainId={toChainId}
                onClick={() => setModalSide("to")}
                onChainClick={() => setModalSide("to")}
              />
            </div>
          </div>
        </div>

        {/* Provider toggles */}
        <div className="jumper-providers">
          <span className="jumper-providers-label">{translate("providers_label")}</span>
          <div className="jumper-providers-row">
            {(["lifi", "rango", "socket"] as ProviderName[]).map((p) => {
              const label = p === "lifi" ? "LI.FI" : p === "rango" ? "Rango" : "Socket";
              return (
                <button key={p} type="button" className={providers[p] ? "jumper-prov active" : "jumper-prov"} onClick={() => toggleProvider(p)}>
                  <span className={`jumper-prov-dot ${providers[p] ? "on" : ""}`} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Currency toggle */}
        <div className="jumper-currency-row">
          <span className="jumper-hint">
            {translate("currency_label")}: {currency}
          </span>
          <button
            type="button"
            className="jumper-currency-btn"
            onClick={() => setCurrency((c) => (c === "USD" ? "EUR" : "USD"))}
          >
            {currency === "USD" ? translate("currency_toggle", { from: "USD", to: "EUR" }) : translate("currency_toggle", { from: "EUR", to: "USD" })}
          </button>
        </div>

        {/* CTA */}
        <button
          type="button"
          className={`jumper-cta ${ctaDisabled ? "jumper-cta-disabled" : "jumper-cta-active"}`}
          disabled={ctaDisabled}
          onClick={() => void handleSwap()}
        >
          {swapping ? (
            <>
              <span className="jumper-spinner" />
              {ctaLabel}
            </>
          ) : (
            ctaLabel
          )}
        </button>

        {!isConnected && <p className="jumper-hint jumper-hint-warn">Connecte un wallet pour continuer.</p>}
        {error && <p className="jumper-error">{error}</p>}
        {bootError && fromToken && <p className="jumper-hint">{bootError}</p>}
      </div>

      {/* ── Route list sidebar ── */}
      <div className="jumper-routes-panel">
        <RouteList
          routes={routes}
          selectedId={selectedRoute?.id ?? null}
          onSelect={setSelectedRoute}
          toDecimals={toToken?.decimals ?? 18}
          toSymbol={toToken?.symbol ?? ""}
          currency={currency}
          priceUsd={toToken ? (priceLookup[getPriceLookupKey(toToken)] ?? Number(toToken.priceUSD ?? "0")) : null}
        />
      </div>

      {/* ── Token select modal ── */}
      <TokenSelectModal
        open={modalSide !== null}
        onClose={() => setModalSide(null)}
        chains={chains}
        tokensByChain={tokensByChain}
        selectedChainId={modalSide === "to" ? toChainId : fromChainId}
        selectedToken={modalSide === "to" ? toToken : fromToken}
        onSelect={(chainId, token) => handleSelect(modalSide ?? "from", chainId, token)}
        title={modalSide === "from" ? "Select source token" : "Select destination token"}
      />
    </>
  );
}

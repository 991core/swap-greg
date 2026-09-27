"use client";

import type { Route } from "@lifi/sdk";
import type { NormalizedRoute } from "@/lib/types/normalized-route";
import { formatTokenAmount, formatDuration } from "@/lib/lifi";
import { formatCurrencyValue } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";
import { CHAIN_LABELS } from "@/lib/chains";
import { ProviderBadge } from "./ProviderBadge";

type Props = {
  routes: NormalizedRoute[];
  selectedId: string | null;
  onSelect: (route: NormalizedRoute) => void;
  toDecimals: number;
  toSymbol: string;
  currency?: "USD" | "EUR";
  priceUsd?: number | null;
  disabled?: boolean;
};

export function RouteList({ routes, selectedId, onSelect, toDecimals, toSymbol, currency = "USD", priceUsd = null, disabled = false }: Props) {
  const { translate } = useI18n();
  if (!routes.length) return null;
  return <div className="jumper-routes-list" role="group" aria-label={translate("route_list_title")}>
    {routes.map((route) => {
      const exact = formatTokenAmount(route.toAmount, toDecimals, toDecimals);
      const short = formatTokenAmount(route.toAmount, toDecimals);
      const value = priceUsd ? formatCurrencyValue(Number(exact) * priceUsd, currency) : null;
      const lifi = route.provider === "lifi" ? route.raw as Route | undefined : undefined;
      const minimumRaw = route.provider === "oneclick"
        ? (route.raw as { minAmountOut?: string } | undefined)?.minAmountOut
        : lifi?.toAmountMin;
      const minimum = minimumRaw ? formatTokenAmount(minimumRaw, toDecimals, toDecimals) : null;
      const gasCosts = lifi?.steps.flatMap(step => step.estimate?.gasCosts ?? []);
      const gasUsd = gasCosts?.length && gasCosts.every(cost => cost.amountUSD != null)
        ? gasCosts.reduce((sum, cost) => sum + Number(cost.amountUSD), 0) : null;
      const gas = formatCurrencyValue(gasUsd, currency);
      return <article key={route.id} className={`jumper-route-card${selectedId === route.id ? " jumper-route-selected" : ""}`}>
        <label className="jumper-route-choice">
          <input type="radio" name="swap-route" aria-label={`${route.provider} · ${exact} ${toSymbol} · ${route.toolLabel}`} checked={selectedId === route.id} onChange={() => onSelect(route)} disabled={disabled} />
          <span className="jumper-route-provider-row"><ProviderBadge provider={route.provider} /><span className="jumper-route-tool" title={route.toolLabel}>· {route.toolLabel}</span></span>
          <span className="jumper-route-output" title={`${exact} ${toSymbol}`}><strong>{short !== exact ? "≈ " : ""}{short}</strong><span>{toSymbol}</span></span>
          <span className="jumper-route-metrics">
            <span title={translate("network_fee")}><span>{translate("route_gas")}</span> <strong>{gas ?? "—"}</strong></span>
            <span title={translate("route_duration")}><span aria-hidden="true">◷</span><span className="jumper-sr-only">{translate("route_duration")}</span> <strong>{formatDuration(route.durationSeconds)}</strong></span>
          </span>
          {minimum && <span className="jumper-route-minimum"><span>{translate("minimum_received")}</span><strong>{minimum} {toSymbol}</strong></span>}
        </label>
        <details className="jumper-route-details">
          <summary title={translate("route_details")}><span className="jumper-sr-only">{translate("route_details")}</span><span aria-hidden="true">⌄</span></summary>
          <div className="jumper-route-detail-body">
            {value && <p className="jumper-route-value">≈ {value}</p>}
            <p className="jumper-network-path">{CHAIN_LABELS[route.fromChainId]} → {CHAIN_LABELS[route.toChainId]}</p>
            <dl className="jumper-route-breakdown"><div><dt>{translate("route_amount_exact")}</dt><dd>{exact} {toSymbol}</dd></div><div><dt>{translate("network_fee")}</dt><dd>{gas ?? "—"}</dd></div></dl>
            <div className="jumper-route-identities"><p><span>{CHAIN_LABELS[route.fromChainId]}</span><code>{route.fromTokenAddress}</code></p><p><span>{toSymbol} · {CHAIN_LABELS[route.toChainId]}</span><code>{route.toTokenAddress}</code></p></div>
          </div>
        </details>
      </article>;
    })}
  </div>;
}

"use client";
import type { NormalizedRoute } from "@/lib/types/normalized-route";
import { formatTokenAmount, formatDuration } from "@/lib/lifi";
import { formatCurrencyValue } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";

type Props = { routes: NormalizedRoute[]; selectedId: string | null; onSelect: (route: NormalizedRoute) => void; toDecimals: number; toSymbol: string; currency?: "USD" | "EUR"; eurRate?: number | null; priceUsd?: number | null; disabled?: boolean };
export function RouteList({ routes, selectedId, onSelect, toDecimals, toSymbol, currency = "USD", eurRate = null, priceUsd = null, disabled = false }: Props) {
  const { translate, lang } = useI18n();
  if (!routes.length) return null;
  return <div className="jumper-routes-widget"><h2 className="jumper-routes-title">{translate("route_list_title")}</h2><div className="jumper-routes-list">
    {routes.map((route) => {
      const net = formatTokenAmount(route.toAmount, toDecimals, Math.min(toDecimals, 10));
      const value = priceUsd ? formatCurrencyValue(Number(net) * priceUsd, currency, eurRate, lang) : null;
      const gas = route.gasCostUSD != null ? formatCurrencyValue(Number(route.gasCostUSD), currency, eurRate, lang) : null;
      return <label key={route.id} className={`jumper-route-card${selectedId === route.id ? " jumper-route-selected" : ""}`}>
        <input type="radio" name="swap-route" checked={selectedId === route.id} onChange={() => onSelect(route)} disabled={disabled} />
        <span className="jumper-route-content"><span className="jumper-route-top"><strong>{net} {toSymbol}</strong>{value && <span className="jumper-hint">≈ {value}</span>}</span>
          <span className="jumper-route-tool">LI.FI · {route.toolLabel}</span>
          <span className="jumper-hint">{translate("route_estimated_time", { duration: formatDuration(route.durationSeconds) })}</span>
          <span className="jumper-hint">{translate("minimum_received")}: {formatTokenAmount(route.toAmountMin, toDecimals, toDecimals)} {toSymbol}</span>
          <span className="jumper-hint">{translate("network_fee")}: {gas ?? "—"}</span>
          {route.raw.steps.flatMap((step) => step.estimate.feeCosts ?? []).map((fee, i) => <span key={i} className="jumper-hint">{fee.name}: {formatTokenAmount(fee.amount, fee.token.decimals)} {fee.token.symbol} · {translate(fee.included ? "fee_included" : "fee_additional")}</span>)}
        </span>
      </label>;
    })}
  </div></div>;
}

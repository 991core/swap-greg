"use client";
import type { NormalizedRoute } from "@/lib/types/normalized-route";
import { formatTokenAmount, formatDuration } from "@/lib/lifi";
import { useI18n } from "@/lib/i18n";
import { quoteAmount, quoteFiat } from "@/lib/presentation";
import { routeFees, routeTokens } from "@/lib/routing/details";
import { CHAIN_LABELS } from "@/lib/chains";
import { TokenIcon } from "./TokenIcon";
import { ProviderBadge } from "./ProviderBadge";

type Props = { routes: NormalizedRoute[]; selectedId: string | null; onSelect: (route: NormalizedRoute) => void; toDecimals: number; toSymbol: string; currency?: "USD" | "EUR"; eurRate?: number | null; priceUsd?: number | null; disabled?: boolean };
export function RouteList({ routes, selectedId, onSelect, toDecimals, toSymbol, currency = "USD", eurRate = null, priceUsd = null, disabled = false }: Props) {
  const { translate, lang } = useI18n();
  if (!routes.length) return null;
  return <div className="jumper-routes-list" role="group" aria-label={translate("route_list_title")}>
    {routes.map((route, index) => {
      const tokens = routeTokens(route);
      const net = quoteAmount(route.toAmount, toDecimals);
      const value = priceUsd ? quoteFiat(Number(net.exact) * priceUsd, currency, eurRate, lang) : null;
      const gas = route.gasCostUSD != null ? quoteFiat(Number(route.gasCostUSD), currency, eurRate, lang) : null;
      const minimum = formatTokenAmount(route.toAmountMin, toDecimals, toDecimals);
      const fees = routeFees(route);
      const extraFees = fees.some(fee => !fee.included && BigInt(fee.amount) > BigInt(0));
      const selected = selectedId === route.id;
      return <article key={route.id} className={`jumper-route-card${selected ? " jumper-route-selected" : ""}`}>
        <label className="jumper-route-choice">
          <span className="jumper-route-provider-row">
            <ProviderBadge provider={route.provider} />
            {index === 0 && <span className="jumper-route-best">{translate("highest_output")}</span>}
            <input type="radio" name="swap-route" aria-label={`${route.provider === "lifi" ? "LI.FI" : "Rango"} · ${net.exact} ${toSymbol} · ${route.toolLabel}`}
              checked={selected} onChange={() => onSelect(route)} disabled={disabled} />
          </span>
          <span className="jumper-route-output" title={`${net.exact} ${toSymbol}`}>
            <strong>{net.rounded ? "≈ " : ""}{net.short}</strong><span>{toSymbol}</span>
          </span>
          <span className="jumper-route-value">{value ? (value.startsWith("<") ? value : `≈ ${value}`) : translate("receive_label")}</span>
          <span className="jumper-route-tool">{route.toolLabel}</span>
          <span className="jumper-route-metrics">
            <span><span>{translate("route_duration")}</span><strong>{formatDuration(route.durationSeconds)}</strong></span>
            <span><span>{translate("route_gas")}</span><strong>{gas ?? "—"}</strong></span>
          </span>
          <span className="jumper-route-minimum"><span>{translate("minimum_received")}</span><strong>{minimum} {toSymbol}</strong></span>
          {extraFees && <span className="jumper-route-extra">{translate("route_extra_fees")}</span>}
        </label>
        <details className="jumper-route-details">
          <summary>{translate("route_details")}<span aria-hidden="true">⌄</span></summary>
          <div className="jumper-route-detail-body">
            <div className="jumper-route-path"><TokenIcon token={tokens.fromToken} /><span>{tokens.fromToken.symbol}<small>{CHAIN_LABELS[route.fromChainId]}</small></span><span aria-hidden="true">→</span><TokenIcon token={tokens.toToken} /><span>{tokens.toToken.symbol}<small>{CHAIN_LABELS[route.toChainId]}</small></span></div>
            <dl className="jumper-route-breakdown">
              <div><dt>{translate("route_amount_exact")}</dt><dd>{net.exact} {toSymbol}</dd></div>
              <div><dt>{translate("network_fee")}</dt><dd>{gas ?? "—"}</dd></div>
              {fees.map((fee, i) => <div key={i}><dt>{fee.name}<small>{translate(fee.included ? "fee_included" : "fee_additional")}</small></dt><dd>{formatTokenAmount(fee.amount, fee.token.decimals, fee.token.decimals)} {fee.token.symbol}</dd></div>)}
            </dl>
            <div className="jumper-route-identities">
              <p><span>{tokens.fromToken.symbol} · {CHAIN_LABELS[route.fromChainId]}</span><code>{tokens.fromToken.address}</code></p>
              <p><span>{tokens.toToken.symbol} · {CHAIN_LABELS[route.toChainId]}</span><code>{tokens.toToken.address}</code></p>
              <p><span>{translate("route_recipient")}</span><code>{route.fromAddress}</code></p>
            </div>
          </div>
        </details>
      </article>;
    })}
  </div>;
}

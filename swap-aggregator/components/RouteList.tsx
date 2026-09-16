"use client";

import type { NormalizedRoute } from "@/lib/types/normalized-route";
import { formatTokenAmount, formatDuration } from "@/lib/lifi";
import { parseUnits } from "viem";
import { formatCurrencyValue } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";

type Props = {
  routes: NormalizedRoute[];
  selectedId: string | null;
  onSelect: (route: NormalizedRoute) => void;
  toDecimals: number;
  toSymbol: string;
  currency?: "USD" | "EUR";
  priceUsd?: number | null;
};

function routeRouteValue(route: NormalizedRoute, toDecimals: number, priceUsd: number, currency: string): number {
  if (priceUsd == null || priceUsd <= 0) return 0;
  const receivedAmount = route.toAmount ?? "0";
  if (!receivedAmount || receivedAmount === "0") return 0;
  try {
    const humanAmount = Number(formatTokenAmount(receivedAmount, toDecimals));
    return humanAmount > 0 ? humanAmount * priceUsd : 0;
  } catch {
    return 0;
  }
}

function routeValueLabel(route: NormalizedRoute, toDecimals: number, priceUsd: number | null, currency: "USD" | "EUR"): string | null {
  if (priceUsd == null) return null;
  const v = routeRouteValue(route, toDecimals, priceUsd, currency);
  if (v <= 0) return null;
  return formatCurrencyValue(v, currency);
}

export function RouteList({
  routes,
  selectedId,
  onSelect,
  toDecimals,
  toSymbol,
  currency = "USD",
  priceUsd = null,
}: Props) {
  const { translate } = useI18n();

  if (routes.length === 0) return null;

  return (
    <div className="jumper-routes-widget">
      {/* Title */}
      <div className="jumper-routes-title">{translate("route_list_title")}</div>

      {/* Routes */}
      <div className="jumper-routes-list">
        {routes.map((route) => {
          const id = route.id;
          const selected = id === selectedId;
          const net = formatTokenAmount(route.toAmount, toDecimals);
          const duration = formatDuration(route.durationSeconds);
          const tools = route.toolLabel;
          const usdLabel = routeValueLabel(route, toDecimals, priceUsd, currency);

          return (
            <label key={id} className={`jumper-route-card${selected ? " jumper-route-selected" : ""}`}>
              {/* Radio dot */}
              <div className="jumper-radio-dot" />
              <input
                type="radio"
                name="jumper-route"
                checked={selected}
                onChange={() => onSelect(route)}
              />

              {/* Content */}
              <div className="jumper-route-content">
                {/* Top row: amount + value */}
                <div className="jumper-route-top">
                  <span className="jumper-route-amount">
                    {net} {toSymbol}
                  </span>
                  {usdLabel && (
                    <span className="jumper-route-usd">≈ {usdLabel}</span>
                  )}
                </div>

                {/* Bottom row: duration + provider */}
                <div className="jumper-route-bottom">
                  <span className="jumper-route-duration">
                    ⏱ {translate("route_estimated_time", { duration })}
                  </span>
                  <span className="jumper-route-tool">{tools}</span>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

"use client";
import { useId } from "react";
import { useI18n } from "@/lib/i18n";

export function CurrencySwitch({ value, onChange, eurAvailable }: { value: "USD" | "EUR"; onChange: (currency: "USD" | "EUR") => void; eurAvailable: boolean }) {
  const { translate } = useI18n();
  const hint = useId();
  return <div className="jumper-currency-control">
    <div className="jumper-currency-switch" role="group" aria-label={translate("currency_label")}>
      {(["USD", "EUR"] as const).map(currency => <button key={currency} type="button" aria-pressed={value === currency}
        disabled={currency === "EUR" && !eurAvailable} aria-describedby={currency === "EUR" && !eurAvailable ? hint : undefined}
        title={currency === "EUR" && !eurAvailable ? translate("fx_unavailable") : translate("currency_toggle", { to: currency })}
        onClick={() => onChange(currency)}><span aria-hidden="true">{currency === "EUR" ? "€" : "$"}</span> {currency}</button>)}
    </div>
    {!eurAvailable && <span id={hint} className="jumper-sr-only">{translate("fx_unavailable")}</span>}
  </div>;
}

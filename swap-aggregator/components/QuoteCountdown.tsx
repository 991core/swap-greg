"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { QUOTE_TTL_MS, QUOTE_RETRY_MS } from "@/lib/routing/config";

type Props = { expiresAt: number | null; retryAt: number | null; loading: boolean; waiting: boolean; suspended: boolean };
export function QuoteCountdown({ expiresAt, retryAt, loading, waiting, suspended }: Props) {
  const { translate } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (suspended || loading || waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, retryAt, loading, waiting, suspended]);
  const deadline = retryAt ?? expiresAt;
  const remaining = deadline === null ? 0 : Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const progress = Math.max(0, Math.min(1, remaining / (retryAt ? QUOTE_RETRY_MS : QUOTE_TTL_MS)));
  const spinning = !suspended && !waiting && (loading || (deadline !== null && seconds === 0));
  const label = translate(suspended ? "quotes_suspended" : waiting ? "quotes_waiting" : spinning ? "quotes_refreshing" : retryAt ? "quotes_retry_in" : "quotes_refresh_in", { seconds: String(seconds) });
  return <div className={"jumper-quote-clock" + (spinning ? " is-refreshing" : "")} role="timer" aria-live="off" aria-label={label}>
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="jumper-clock-track" cx="20" cy="20" r="16" />
      <circle className="jumper-clock-progress" cx="20" cy="20" r="16" pathLength="100" strokeDasharray="100" strokeDashoffset={spinning ? 70 : 100 * (1 - progress)} />
      {!spinning && <text x="20" y="24" textAnchor="middle">{suspended || waiting ? "–" : seconds}</text>}
    </svg><span>{label}</span>
  </div>;
}

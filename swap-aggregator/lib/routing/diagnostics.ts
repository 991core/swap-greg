import type { ProviderName } from "../types/normalized-route";

type QuoteDiagnosticContext = {
  event: "provider_failed" | "refresh_failed";
  provider?: ProviderName;
  fromChainId: number;
  toChainId: number;
};

/** Technical console only. Never log upstream messages, URLs or wallet payloads. */
export function logQuoteFailure(error: unknown, context: QuoteDiagnosticContext): void {
  const details = error && typeof error === "object" ? error as { name?: unknown; status?: unknown; cause?: unknown } : {};
  const cause = details.cause && typeof details.cause === "object" ? details.cause as { status?: unknown } : {};
  const rawStatus = details.status ?? cause.status;
  const status = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined;
  const knownReasons: Record<string, string> = {
    "Pair not supported by 1Click": "unsupported_pair",
    "1Click platform fees are not configured": "provider_configuration",
    "Invalid 1Click quote": "invalid_quote",
    "Invalid 1Click quote response": "invalid_quote",
    "Quote expired during refresh.": "expired_quote",
    "No selected provider is available. Retrying automatically.": "all_providers_failed",
  };
  const knownReason = error instanceof Error && Object.hasOwn(knownReasons, error.message) ? knownReasons[error.message] : undefined;
  const reason = knownReason ?? (status ? "http_error" : ["AbortError", "TimeoutError"].includes(String(details.name)) ? "timeout_or_abort" :
    details.name === "SyntaxError" ? "invalid_response" : details.name === "TypeError" ? "network_or_runtime_error" : "provider_error");
  console.warn("[Hermes quotes]", {
    event: context.event, ...(context.provider ? { provider: context.provider } : {}),
    fromChainId: context.fromChainId, toChainId: context.toChainId, reason,
    ...(status !== undefined ? { status } : {}),
  });
}

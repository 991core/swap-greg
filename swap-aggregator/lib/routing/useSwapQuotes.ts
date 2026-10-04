"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedRoute } from "../types/normalized-route";
import { getRoutesForSelection, type RouteSelectionParams } from "./orchestrator";
import { logQuoteFailure } from "./diagnostics";
import { quoteKey } from "./quote";
import { QUOTE_RETRY_MS } from "./config";

type QuoteState = {
  key: string | null; routes: NormalizedRoute[]; loading: boolean; error: string | null;
  expired: boolean; expiresAt: number | null; retryAt: number | null; waiting: boolean; partial: boolean; partialReason: string | null;
};
const empty: QuoteState = { key: null, routes: [], loading: false, error: null, expired: false, expiresAt: null, retryAt: null, waiting: false, partial: false, partialReason: null };

function publicQuoteError(error: unknown): "route_rate_limited" | "route_configuration_failed" | "route_search_failed" {
  const value = error && typeof error === "object" ? error as { failure?: unknown; status?: unknown; cause?: { status?: unknown }; message?: unknown } : {};
  if (value.failure === "quota") return "route_rate_limited";
  if (value.failure === "configuration") return "route_configuration_failed";
  if (value.status === 429 || value.cause?.status === 429) return "route_rate_limited";
  if (typeof value.message === "string" && /configuration|not configured/i.test(value.message)) return "route_configuration_failed";
  return "route_search_failed";
}

export function useSwapQuotes(params: RouteSelectionParams | null, enabled = true) {
  const key = params ? quoteKey(params) + JSON.stringify([params.providers?.lifi ?? true, params.providers?.rango ?? true, params.providers?.socket ?? false, params.providers?.oneclick ?? false]) : null;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [state, setState] = useState<QuoteState>(empty);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => { setState(empty); setRevision((v) => v + 1); }, []);

  useEffect(() => {
    if (!enabled) return;
    const request = paramsRef.current;
    setState({ ...empty, key, loading: Boolean(request) });
    if (!request) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let dueAt = Date.now() + 500;
    const available = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
    const schedule = (at: number) => {
      dueAt = at;
      clearTimeout(timer);
      timer = setTimeout(() => void load(), Math.max(0, at - Date.now()));
    };
    const load = async () => {
      if (controller.signal.aborted || inFlight) return;
      if (!available()) {
        setState((old) => ({ ...old, loading: false, waiting: true,
          expired: old.expiresAt !== null && old.expiresAt <= Date.now() }));
        return;
      }
      inFlight = true;
      setState((old) => ({ ...old, loading: true, error: null, retryAt: null, waiting: false,
        expired: old.expiresAt !== null && old.expiresAt <= Date.now() }));
      try {
        let partial = false; let partialReason: string | null = null;
        const routes = await getRoutesForSelection(request, controller.signal, (warning) => {
          partial = true; partialReason = warning.message === "quota" ? "route_rate_limited" : warning.message === "configuration" ? "route_configuration_failed" : "route_search_partial";
        }, (received) => {
          if (controller.signal.aborted || !received.length) return;
          // Show fast providers immediately. Execution stays disabled until the
          // current search completes; no stale results can enter a new request.
          setState((old) => ({ ...old, key, routes: received, loading: true, expired: false,
            expiresAt: Math.min(...received.map((route) => route.expiresAt)) }));
        });
        if (controller.signal.aborted) return;
        const expiresAt = routes.length ? Math.min(...routes.map((route) => route.expiresAt)) : null;
        if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new Error("Quote expired during refresh.");
        const retryAt = expiresAt === null ? Date.now() + QUOTE_RETRY_MS : null;
        setState({ key, routes, loading: false, error: null, expired: false, expiresAt, retryAt, waiting: false, partial, partialReason });
        schedule(expiresAt ?? retryAt!);
      } catch (error) {
        if (controller.signal.aborted) return;
        logQuoteFailure(error, { event: "refresh_failed", fromChainId: request.fromChainId, toChainId: request.toChainId });
        const retryAt = Date.now() + QUOTE_RETRY_MS;
        setState((old) => ({ ...old, loading: false, expired: true, retryAt,
          error: publicQuoteError(error) }));
        schedule(retryAt);
      } finally { inFlight = false; }
    };
    const resume = () => {
      if (available() && Date.now() >= dueAt) void load();
    };
    schedule(dueAt);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      controller.abort(); clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [key, revision, enabled]);

  const updateRoute = useCallback((route: NormalizedRoute) => {
    setState((current) => ({ ...current, routes: current.routes.map((old) => old.id === route.id ? route : old) }));
  }, []);
  // This render-time check also disables the previous quote before effects/debounce run.
  const current = state.key === key ? state : { ...empty, loading: Boolean(key) };
  return { ...current, refresh, updateRoute };
}

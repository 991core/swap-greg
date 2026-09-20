"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute } from "../types/normalized-route";
import { getRoutesForSelection } from "./orchestrator";
import { quoteKey } from "./quote";
import { QUOTE_RETRY_MS } from "./config";

type QuoteState = {
  key: string | null; routes: NormalizedRoute[]; loading: boolean; error: string | null;
  expired: boolean; expiresAt: number | null; retryAt: number | null; waiting: boolean;
};
const empty: QuoteState = { key: null, routes: [], loading: false, error: null, expired: false, expiresAt: null, retryAt: null, waiting: false };

export function useSwapQuotes(params: SwapParams | null, enabled = true) {
  const key = params ? quoteKey(params) : null;
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
        const routes = await getRoutesForSelection(request, controller.signal);
        if (controller.signal.aborted) return;
        const expiresAt = routes.length ? Math.min(...routes.map((route) => route.expiresAt)) : null;
        if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new Error("Quote expired during refresh.");
        const retryAt = expiresAt === null ? Date.now() + QUOTE_RETRY_MS : null;
        setState({ key, routes, loading: false, error: null, expired: false, expiresAt, retryAt, waiting: false });
        schedule(expiresAt ?? retryAt!);
      } catch (error) {
        if (controller.signal.aborted) return;
        const retryAt = Date.now() + QUOTE_RETRY_MS;
        setState((old) => ({ ...old, loading: false, expired: true, retryAt,
          error: error instanceof Error ? error.message : String(error) }));
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

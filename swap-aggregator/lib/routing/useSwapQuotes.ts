"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SwapParams } from "../aggregators/lifi/routes";
import type { NormalizedRoute } from "../types/normalized-route";
import { getRoutesForSelection } from "./orchestrator";
import { quoteKey } from "./quote";

type QuoteState = { key: string | null; routes: NormalizedRoute[]; loading: boolean; error: string | null; expired: boolean };
const empty: QuoteState = { key: null, routes: [], loading: false, error: null, expired: false };

export function useSwapQuotes(params: SwapParams | null, enabled = true) {
  const key = params ? quoteKey(params) : null;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [state, setState] = useState<QuoteState>(empty);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => { setState(empty); setRevision((v) => v + 1); }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const request = paramsRef.current;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setState({ ...empty, key, loading: Boolean(request) });
    const debounce = setTimeout(async () => {
      if (!request) return;
      try {
        const routes = await getRoutesForSelection(request, controller.signal);
        if (controller.signal.aborted) return;
        setState({ key, routes, loading: false, error: null, expired: false });
        if (routes.length) expiry = setTimeout(() => {
          if (!controller.signal.aborted) setState((current) => ({ ...current, expired: true }));
        }, Math.max(0, Math.min(...routes.map((r) => r.expiresAt)) - Date.now()));
      } catch (error) {
        if (!controller.signal.aborted) setState({ ...empty, key, error: error instanceof Error ? error.message : String(error) });
      }
    }, 500);
    return () => { controller.abort(); clearTimeout(debounce); clearTimeout(expiry); };
  }, [key, revision, enabled]);

  const updateRoute = useCallback((route: NormalizedRoute) => {
    setState((current) => ({ ...current, routes: current.routes.map((old) => old.id === route.id ? route : old) }));
  }, []);
  // This render-time check also disables the previous quote before effects/debounce run.
  const current = state.key === key ? state : { ...empty, loading: Boolean(key) };
  return { ...current, refresh, updateRoute };
}

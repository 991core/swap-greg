import { assetKey, compareRawDescending, rawAmount, sumUsd, usdToRawCeil, validateAsset, validDecimal } from "./amounts.ts";
import type { Asset, CandidateRoute, Diagnostic, Quote, QuoteProvider, QuoteRequest, SearchOptions, SearchReport } from "./types.ts";

interface State { asset: Asset; amount: string; legs: Quote[]; visited: string[]; crossed: boolean }

function integerOption(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Search option outside ${min}–${max}`);
  return n;
}

function validateQuote(q: Quote, req: QuoteRequest, provider: string, now: number): void {
  validateAsset(q.from);
  validateAsset(q.to);
  if (q.provider !== provider || !q.id || assetKey(q.from) !== assetKey(req.from) ||
      assetKey(q.to) !== assetKey(req.to) || q.from.decimals !== req.from.decimals ||
      q.to.decimals !== req.to.decimals || rawAmount(q.amountIn) !== rawAmount(req.amount)) {
    throw new Error("Quote does not match the requested provider, assets, decimals or exact input");
  }
  rawAmount(q.amountOut);
  if (q.minimumOut !== null && rawAmount(q.minimumOut, true) > rawAmount(q.amountOut)) {
    throw new Error("Minimum output exceeds expected output");
  }
  if (!Number.isFinite(q.quotedAt) || !Number.isFinite(q.expiresAt) ||
      q.quotedAt > now || q.expiresAt <= now || q.expiresAt <= q.quotedAt) {
    throw new Error("Invalid or expired quote timestamps");
  }
  if (q.externalCostUsd !== null && !validDecimal(q.externalCostUsd)) throw new Error("Invalid external cost");
  if (!Array.isArray(q.missingCosts) || !Array.isArray(q.warnings)) throw new Error("Missing cost coverage metadata");
}

export async function searchRoutes(request: QuoteRequest, providers: QuoteProvider[], options: SearchOptions): Promise<SearchReport> {
  validateAsset(request.from);
  validateAsset(request.to);
  rawAmount(request.amount);
  if (!/^0x[\da-f]{40}$/i.test(request.wallet)) throw new Error("Expected an EVM wallet address");
  integerOption(request.slippageBps, 50, 0, 5000);
  if (assetKey(request.from) === assetKey(request.to)) throw new Error("Source and destination are identical");
  if (providers.length === 0 || new Set(providers.map((p) => p.id)).size !== providers.length) {
    throw new Error("Choose at least one provider with a unique id");
  }
  const now = options.now ?? Date.now;
  const startedAt = now();
  const maxLegs = integerOption(options.maxLegs, 3, 1, 4);
  const maxRequests = integerOption(options.maxRequests, 60, providers.length, 500);
  const concurrency = integerOption(options.concurrency, 4, 1, 16);
  const beam = integerOption(options.beamWidthPerAsset, 2, 1, 8);
  const maxQuotes = integerOption(options.maxQuotesPerRequest, 4, 1, 20);
  const timeout = integerOption(options.timeoutMs, 45000, 100, 120000);
  const requestTimeout = integerOption(options.requestTimeoutMs, 12000, 50, 30000);
  const maxAge = integerOption(options.maxQuoteAgeMs, 60000, 1, 120000);
  const maxSkew = integerOption(options.maxQuoteSkewMs, 30000, 1, 120000);
  const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
  const assets = new Map<string, Asset>();
  for (const asset of [request.to, request.from, ...options.pivots]) {
    validateAsset(asset);
    if (asset.chainId !== request.from.chainId && asset.chainId !== request.to.chainId) continue;
    const key = assetKey(asset);
    if (assets.has(key) && assets.get(key)!.decimals !== asset.decimals) throw new Error("Conflicting decimals for an asset");
    if (!assets.has(key)) assets.set(key, asset);
  }
  if (assets.size > 20) throw new Error("Limit research to at most 20 distinct candidate assets");
  const diagnostics: Diagnostic[] = [];
  const stopReasons = new Set<string>();
  const cache = new Map<string, Promise<Quote[]>>();
  let requestsMade = 0;
  let cacheHits = 0;

  async function quote(provider: QuoteProvider, req: QuoteRequest): Promise<Quote[]> {
    const key = JSON.stringify([provider.id, assetKey(req.from), assetKey(req.to), req.amount, req.wallet, req.slippageBps]);
    if (cache.has(key)) { cacheHits++; return cache.get(key)!; }
    if (signal.aborted || now() - startedAt >= timeout) { stopReasons.add("deadline"); return []; }
    if (requestsMade >= maxRequests) { stopReasons.add("request_budget"); return []; }
    requestsMade++;
    const run = (async () => {
      const info = { provider: provider.id, from: assetKey(req.from), to: assetKey(req.to), amount: req.amount };
      const callSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeout)]);
      let onAbort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Quote request timed out or was cancelled"));
          if (callSignal.aborted) onAbort();
          else callSignal.addEventListener("abort", onAbort, { once: true });
        });
        const replies = await Promise.race([provider.quote(req, { signal: callSignal, now }), cancelled]);
        if (!Array.isArray(replies)) throw new Error("Provider did not return a quote array");
        const accepted: Quote[] = [];
        for (const q of replies) {
          try { validateQuote(q, req, provider.id, now()); accepted.push(q); }
          catch (e) { diagnostics.push({ ...info, status: "invalid_quote", detail: String(e) }); }
        }
        diagnostics.push({ ...info, status: accepted.length ? "ok" : "no_route", detail: `${accepted.length} valid quote(s)` });
        if (accepted.length > maxQuotes) stopReasons.add("quotes_per_request");
        return accepted.slice(0, maxQuotes);
      } catch (e) {
        diagnostics.push({ ...info, status: "error", detail: String(e).slice(0, 400) });
        return [];
      } finally {
        if (onAbort) callSignal.removeEventListener("abort", onAbort);
      }
    })();
    cache.set(key, run);
    return run;
  }

  const completed: State[] = [];
  const reached = new Set<string>();
  let frontier: State[] = [{ asset: request.from, amount: request.amount, legs: [], visited: [assetKey(request.from)], crossed: false }];
  for (let depth = 0; depth < maxLegs && frontier.length; depth++) {
    const tasks: Array<() => Promise<State[]>> = [];
    const byAsset = new Map<string, State[]>();
    for (const state of frontier) {
      const key = assetKey(state.asset);
      byAsset.set(key, [...(byAsset.get(key) ?? []), state]);
    }
    // Complete paths from EVERY pivot before spending calls on further detours.
    // Rotate across assets before trying the second retained amount for an asset.
    const lanes = [...byAsset.values()];
    const ranks = Math.max(...lanes.map((lane) => lane.length));
    for (const destination of assets.values()) {
      for (let rank = 0; rank < ranks; rank++) {
        for (const provider of providers) for (const lane of lanes) {
          const state = lane[rank];
          if (!state) continue;
          if (state.visited.includes(assetKey(destination))) continue;
          if (depth === maxLegs - 1 && assetKey(destination) !== assetKey(request.to)) continue;
          const cross = state.asset.chainId !== destination.chainId;
          if (cross && (state.crossed || destination.chainId !== request.to.chainId)) continue;
          if (!provider.supports(state.asset, destination)) continue;
          tasks.push(async () => (await quote(provider, { ...request, from: state.asset, to: destination, amount: state.amount }))
            .map((q) => ({ asset: destination, amount: q.amountOut, legs: [...state.legs, q], visited: [...state.visited, assetKey(destination)], crossed: state.crossed || cross })));
        }
      }
    }
    const slots: State[][] = new Array(tasks.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length) { const i = cursor++; slots[i] = await tasks[i](); }
    }));
    const groups = new Map<string, State[]>();
    for (const state of slots.flat()) {
      reached.add(assetKey(state.asset));
      if (assetKey(state.asset) === assetKey(request.to)) { completed.push(state); continue; }
      const key = assetKey(state.asset);
      groups.set(key, [...(groups.get(key) ?? []), state]);
    }
    frontier = [];
    for (const states of groups.values()) {
      // Heuristic, not a proof of optimality: preserve best output and lowest known cost.
      states.sort((a, b) => compareRawDescending(a.amount, b.amount));
      const selected = states.slice(0, beam);
      if (states.length > beam) {
        stopReasons.add("beam_pruning");
        const known = states.filter((s) => s.legs.every((q) => q.externalCostUsd !== null && q.missingCosts.length === 0));
        known.sort((a, b) => {
          const ca = usdToRawCeil(sumUsd(a.legs.map((q) => q.externalCostUsd!)), "1", 18);
          const cb = usdToRawCeil(sumUsd(b.legs.map((q) => q.externalCostUsd!)), "1", 18);
          return ca === cb ? compareRawDescending(a.amount, b.amount) : ca < cb ? -1 : 1;
        });
        if (beam > 1 && known[0] && !selected.includes(known[0])) selected[beam - 1] = known[0];
      }
      frontier.push(...selected);
    }
    if (signal.aborted) { stopReasons.add("deadline"); break; }
  }

  const finishedAt = now();
  const valuation = options.valuation;
  const valuationValid = valuation && validDecimal(valuation.usdPerToken) &&
    Number.isFinite(valuation.observedAt) && Number.isFinite(valuation.expiresAt) &&
    valuation.observedAt <= finishedAt && valuation.expiresAt > finishedAt &&
    finishedAt - valuation.observedAt <= maxAge && /[1-9]/.test(valuation.usdPerToken);
  const routes = completed.map((state, i): CandidateRoute => {
    const times = state.legs.map((q) => q.quotedAt);
    const stale = state.legs.some((q) => q.expiresAt <= finishedAt || finishedAt - q.quotedAt > maxAge) || Math.max(...times) - Math.min(...times) > maxSkew;
    const costKnown = state.legs.every((q) => q.externalCostUsd !== null);
    const reported = costKnown ? sumUsd(state.legs.map((q) => q.externalCostUsd!)) : null;
    const complete = costKnown && state.legs.every((q) => q.missingCosts.length === 0);
    const net = reported !== null && valuationValid ? (BigInt(state.amount) - usdToRawCeil(reported, valuation!.usdPerToken, request.to.decimals)).toString() : null;
    return {
      id: `route-${i + 1}`, kind: state.legs.length === 1 ? "provider" : "composed", legs: state.legs,
      amountOut: state.amount, reportedExternalCostUsd: reported, netAfterReportedCosts: net,
      globalMinimumOut: null, conditionalLastLegMinimum: state.legs.at(-1)!.minimumOut,
      economics: stale ? "STALE" : !complete ? "INCOMPLETE_COSTS" : !valuationValid ? "NO_VALUATION" : "QUOTE_ESTIMATE",
      execution: "NOT_VALIDATED",
      warnings: [...new Set([...state.legs.flatMap((q) => [...q.warnings, ...q.missingCosts]),
        ...(state.legs.length > 1 ? ["Later legs require fresh quotes for the amount actually received; no global minimum is guaranteed."] : [])])],
    };
  });
  // Keep incomplete routes visible; never silently treat unknown gas as zero.
  routes.sort((a, b) => {
    if (a.economics === "QUOTE_ESTIMATE" && b.economics !== "QUOTE_ESTIMATE") return -1;
    if (a.economics !== "QUOTE_ESTIMATE" && b.economics === "QUOTE_ESTIMATE") return 1;
    return compareRawDescending(a.economics === "QUOTE_ESTIMATE" ? a.netAfterReportedCosts! : a.amountOut,
      b.economics === "QUOTE_ESTIMATE" ? b.netAfterReportedCosts! : b.amountOut);
  });
  const baseline = routes.find((r) => r.legs.length === 1 && r.legs[0].provider === "lifi" && r.economics === "QUOTE_ESTIMATE");
  const candidate = baseline && routes.find((r) => r.id !== baseline.id && r.economics === "QUOTE_ESTIMATE" &&
    Math.max(...r.legs.map((q) => q.quotedAt), baseline.legs[0].quotedAt) - Math.min(...r.legs.map((q) => q.quotedAt), baseline.legs[0].quotedAt) <= maxSkew);
  return {
    schemaVersion: 1, request, startedAt, finishedAt, routes, diagnostics, requestsMade, cacheHits,
    truncated: stopReasons.size > 0, stopReasons: [...stopReasons],
    pivotCoverage: [...assets.values()].filter((asset) => ![assetKey(request.from), assetKey(request.to)].includes(assetKey(asset)))
      .map((asset) => {
        const attempts = diagnostics.filter((d) => d.from === assetKey(asset) && d.to === assetKey(request.to) && d.status !== "invalid_quote");
        return { asset, reached: reached.has(assetKey(asset)), targetAttempts: attempts.length,
          targetSuccesses: attempts.filter((d) => d.status === "ok").length };
      }),
    comparison: baseline && candidate ? {
      status: "QUOTED_ONLY", baselineId: baseline.id, candidateId: candidate.id,
      gainRaw: (BigInt(candidate.netAfterReportedCosts!) - BigInt(baseline.netAfterReportedCosts!)).toString(),
      reason: "Estimated difference within the tested quote set; execution and repeatability remain unverified.",
    } : { status: "UNRESOLVED", baselineId: baseline?.id ?? null, candidateId: null, gainRaw: null,
      reason: "Need a fresh LI.FI baseline and an alternative with complete external costs and a common valuation." },
    assumptions: ["EVM exact-input quotes; at most one explicit cross-chain edge and no intermediate third chain.",
      "Gas is funded separately on every sending chain, including the destination swap; wallet balances are not checked.",
      "All legs use the same wallet and no added Hermes fee; this does not reproduce an app with configured fees.",
      "Beam search, pivot selection and API budgets can miss routes. No global optimum is claimed.",
      "Per-leg slippage settings are not a bound on whole-route slippage. Quotes are not transactions."],
  };
}

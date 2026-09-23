import test from "node:test";
import assert from "node:assert/strict";
import { assetKey, rawAmount, sumUsd, usdToRawCeil } from "../../lib/routing/research/amounts.ts";
import { searchRoutes } from "../../lib/routing/research/engine.ts";
import type { Asset, Quote, QuoteProvider, QuoteRequest, SearchOptions } from "../../lib/routing/research/types.ts";

const A: Asset = { chainId: 1, address: "0x" + "1".repeat(40), decimals: 6, symbol: "USDC" };
const X: Asset = { chainId: 100, address: "0x" + "2".repeat(40), decimals: 6, symbol: "USDC" };
const B: Asset = { chainId: 100, address: "0x" + "3".repeat(40), decimals: 18, symbol: "EURe" };
const S: Asset = { chainId: 1, address: "0x" + "4".repeat(40), decimals: 18, symbol: "WETH" };
const request: QuoteRequest = { from: A, to: B, amount: "100000000", wallet: "0x" + "5".repeat(40), slippageBps: 50 };
const time = 1000000;
const defaults: SearchOptions = { pivots: [X], now: () => time,
  valuation: { usdPerToken: "1", observedAt: time, expiresAt: time + 60000, source: "synthetic-test" } };
const units = (n: number) => (BigInt(n) * BigInt(10) ** BigInt(18)).toString();

function makeQuote(provider: string, req: QuoteRequest, amountOut: string, extra: Partial<Quote> = {}): Quote {
  return { id: `${provider}-${assetKey(req.from)}-${assetKey(req.to)}`, provider, from: req.from, to: req.to,
    amountIn: req.amount, amountOut, minimumOut: null, quotedAt: time, expiresAt: time + 60000,
    externalCostUsd: "0", missingCosts: [], durationSeconds: 10, warnings: [], ...extra };
}

function provider(id: string, get: (req: QuoteRequest) => Quote[] | Promise<Quote[]>): QuoteProvider {
  return { id, supports: () => true, quote: async (req) => get(req) };
}

function fixture(gas = "0.01", seen: string[] = []): QuoteProvider[] {
  return [provider("lifi", (req) => assetKey(req.from) === assetKey(A) && assetKey(req.to) === assetKey(B)
    ? [makeQuote("lifi", req, units(90), { externalCostUsd: "1" })] : []),
  provider("relay", (req) => assetKey(req.from) === assetKey(A) && assetKey(req.to) === assetKey(X)
    ? [makeQuote("relay", req, "99000000", { externalCostUsd: gas })] : []),
  provider("cow", (req) => {
    if (assetKey(req.from) !== assetKey(X) || assetKey(req.to) !== assetKey(B)) return [];
    seen.push(req.amount);
    return [makeQuote("cow", req, units(98), { minimumOut: units(97) })];
  })];
}

test("chains the exact preceding output and finds an estimated improvement", async () => {
  const seen: string[] = [];
  const result = await searchRoutes(request, fixture("0.01", seen), defaults);
  assert.deepEqual(seen, ["99000000"]);
  assert.equal(result.routes[0].kind, "composed");
  assert.equal(result.routes[0].netAfterReportedCosts, "97990000000000000000");
  assert.equal(result.comparison.gainRaw, "8990000000000000000");
  assert.equal(result.comparison.status, "QUOTED_ONLY");
  assert.equal(result.routes[0].globalMinimumOut, null);
  assert.equal(result.routes[0].conditionalLastLegMinimum, units(97));
  assert.equal(result.routes[0].execution, "NOT_VALIDATED");
});

test("counterexample: extra gas overturns the highest gross output", async () => {
  const result = await searchRoutes(request, fixture("10"), defaults);
  assert.equal(result.routes[0].legs[0].provider, "lifi");
  assert.equal(result.comparison.gainRaw, "-1000000000000000000");
});

test("unknown approval costs remain visible but cannot win an economic comparison", async () => {
  const p = fixture();
  p.push(provider("unverified", (req) => assetKey(req.to) === assetKey(B) ? [makeQuote("unverified", req, units(1000), { missingCosts: ["approval unknown"] })] : []));
  const result = await searchRoutes(request, p, defaults);
  assert.equal(result.routes[0].economics, "QUOTE_ESTIMATE");
  assert.ok(result.routes.some((r) => r.amountOut === units(1000) && r.economics === "INCOMPLETE_COSTS"));
  assert.notEqual(result.comparison.candidateId, result.routes.find((r) => r.amountOut === units(1000))!.id);
});

test("absence of external costs is not interpreted as zero", async () => {
  const result = await searchRoutes(request, [provider("lifi", (r) => [makeQuote("lifi", r, units(100), { externalCostUsd: null })])], { ...defaults, maxLegs: 1 });
  assert.equal(result.routes[0].netAfterReportedCosts, null);
  assert.equal(result.comparison.status, "UNRESOLVED");
});

test("same-symbol contracts cannot substitute for the exact requested token", async () => {
  const result = await searchRoutes(request, [provider("lifi", (r) => [makeQuote("lifi", r, units(100), { to: { ...B, address: X.address } })])], { ...defaults, maxLegs: 1 });
  assert.equal(result.routes.length, 0);
  assert.ok(result.diagnostics.some((d) => d.status === "invalid_quote"));
  await assert.rejects(searchRoutes(request, fixture(), { ...defaults, pivots: [{ ...X, decimals: 18 }, X] }), /Conflicting decimals/);
});

test("already expired replies are rejected", async () => {
  const result = await searchRoutes(request, [provider("lifi", (r) => [makeQuote("lifi", r, units(100), { expiresAt: time })])], { ...defaults, maxLegs: 1 });
  assert.equal(result.routes.length, 0);
});

test("a valid quote that expires during exploration is no longer ranked economically", async () => {
  let clock = time;
  const providers = fixture();
  providers[0] = provider("lifi", (r) => assetKey(r.to) === assetKey(B) && assetKey(r.from) === assetKey(A)
    ? [makeQuote("lifi", r, units(90), { expiresAt: time + 5 })] : []);
  providers[2] = provider("cow", (r) => {
    if (assetKey(r.from) !== assetKey(X) || assetKey(r.to) !== assetKey(B)) return [];
    clock = time + 10;
    return [makeQuote("cow", r, units(98), { quotedAt: clock })];
  });
  const result = await searchRoutes(request, providers, { ...defaults, now: () => clock });
  assert.ok(result.routes.some((r) => r.legs[0].provider === "lifi" && r.economics === "STALE"));
  assert.equal(result.comparison.status, "UNRESOLVED");
});

test("a provider failure preserves other providers and is not a zero-priced route", async () => {
  const result = await searchRoutes(request, [provider("lifi", async () => { throw new Error("HTTP 429"); }),
    provider("relay", (r) => [makeQuote("relay", r, units(100))])], { ...defaults, maxLegs: 1 });
  assert.equal(result.routes.length, 1);
  assert.equal(result.comparison.status, "UNRESOLVED");
  assert.ok(result.diagnostics.some((d) => d.status === "error" && d.detail.includes("429")));
});

test("request budget and concurrency are bounded, direct baseline is requested first", async () => {
  let active = 0, peak = 0, calls = 0;
  const destinations: string[] = [];
  const p = provider("lifi", async (r) => {
    calls++; active++; peak = Math.max(peak, active); destinations.push(assetKey(r.to));
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return [makeQuote("lifi", r, "1000000")];
  });
  const result = await searchRoutes(request, [p], { ...defaults, pivots: [X, S], maxRequests: 3, concurrency: 2 });
  assert.equal(destinations[0], assetKey(B));
  assert.equal(calls, 3);
  assert.ok(peak <= 2);
  assert.ok(result.stopReasons.includes("request_budget"));
});

test("same-chain, source-pivot and three-leg routes work without pair-specific rules", async () => {
  const p = provider("test", (r) => {
    const pair = `${assetKey(r.from)}>${assetKey(r.to)}`;
    return [`${assetKey(A)}>${assetKey(S)}`, `${assetKey(S)}>${assetKey(X)}`, `${assetKey(X)}>${assetKey(B)}`].includes(pair)
      ? [makeQuote("test", r, "1000000")] : [];
  });
  const result = await searchRoutes(request, [p], { ...defaults, pivots: [S, X] });
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].legs.length, 3);
  const local = await searchRoutes({ ...request, from: X }, [p], { ...defaults, pivots: [] });
  assert.equal(local.routes.length, 1);
  const sourceTwo = await searchRoutes({ ...request, to: X }, [p], { ...defaults, pivots: [S], maxLegs: 2 });
  assert.equal(sourceTwo.routes[0].legs.length, 2);
});

test("exact amounts remain intact above Number.MAX_SAFE_INTEGER", async () => {
  const huge = "900719925474099312345678";
  let got = "";
  const p = provider("relay", (r) => {
    if (assetKey(r.from) === assetKey(A) && assetKey(r.to) === assetKey(X)) return [makeQuote("relay", r, huge)];
    if (assetKey(r.from) === assetKey(X) && assetKey(r.to) === assetKey(B)) { got = r.amount; return [makeQuote("relay", r, huge)]; }
    return [];
  });
  await searchRoutes(request, [p], defaults);
  assert.equal(got, huge);
});

test("failed provider cancellation cannot block the engine indefinitely", async () => {
  const controller = new AbortController();
  const trigger = setTimeout(() => controller.abort(), 10);
  const result = await searchRoutes(request, [provider("hanging", () => new Promise(() => {}))],
    { ...defaults, signal: controller.signal, maxLegs: 1 });
  clearTimeout(trigger);
  assert.equal(result.routes.length, 0);
  assert.ok(result.diagnostics.some((d) => d.status === "error"));
});

test("different amounts are quoted independently, no fixed exchange-rate graph", async () => {
  const p = fixture();
  const got: string[] = [];
  p[1] = provider("relay", (r) => {
    if (assetKey(r.from) === assetKey(A) && assetKey(r.to) === assetKey(X)) {
      return [makeQuote("relay", r, "1000000", { id: "small" }), makeQuote("relay", r, "2000000", { id: "large" })];
    }
    return [];
  });
  p[2] = provider("cow", (r) => {
    if (assetKey(r.from) === assetKey(X) && assetKey(r.to) === assetKey(B)) { got.push(r.amount); return [makeQuote("cow", r, units(1))]; }
    return [];
  });
  await searchRoutes(request, p, defaults);
  assert.deepEqual(got.sort(), ["1000000", "2000000"]);
});

test("money calculations are exact and external cost rounds up", () => {
  assert.equal(sumUsd(["0.1", "0.2", "0.00000001"]), "0.30000001");
  assert.equal(usdToRawCeil("0.01", "3", 6), BigInt(3334));
  assert.throws(() => rawAmount("1e18"));
  assert.throws(() => rawAmount("-1"));
  assert.throws(() => rawAmount((BigInt(2) ** BigInt(256)).toString()));
  assert.throws(() => usdToRawCeil("1", "0", 18));
});

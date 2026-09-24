import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NATIVE } from "../../lib/routing/research/amounts.ts";
import { createProviders, normalizeCow, normalizeLifi, normalizeRelay } from "../../lib/routing/research/providers.ts";
import { createJsonHttp, createReplayHttp } from "../../lib/routing/research/http.ts";
import type { HttpEvidence } from "../../lib/routing/research/http.ts";
import { discoverPivots } from "../../lib/routing/research/catalog.ts";
import type { QuoteRequest } from "../../lib/routing/research/types.ts";

const now = 1000000;
const from = { chainId: 137, address: "0x" + "1".repeat(40), decimals: 6 };
const to = { chainId: 100, address: "0x" + "2".repeat(40), decimals: 18 };
const req: QuoteRequest = { from, to, amount: "100000000", wallet: "0x" + "3".repeat(40), slippageBps: 50 };

function lifiFixture() {
  return { routes: [{ id: "q1", fromChainId: 137, toChainId: 100, fromToken: from, toToken: to,
    fromAmount: req.amount, toAmount: "99000000000000000000", toAmountMin: "98000000000000000000", gasCostUSD: "1",
    steps: [{ action: { fromToken: from }, estimate: { gasCosts: [{ type: "SEND", amountUSD: "1" }],
      feeCosts: [{ included: true, amountUSD: "5" }, { included: false, amountUSD: "0.2" }], executionDuration: 4 },
    includedSteps: [{ estimate: { gasCosts: [{ type: "SEND", amountUSD: "1" }], feeCosts: [{ included: true, amountUSD: "5" }] } }] }] }] };
}

test("LI.FI cost normalization excludes included fees and does not duplicate substeps", () => {
  const [q] = normalizeLifi(lifiFixture(), req, now);
  assert.equal(q.amountOut, "99000000000000000000");
  assert.equal(q.externalCostUsd, "1.2");
  assert.ok(q.missingCosts.includes("ERC-20 approval gas not measured"));
  assert.deepEqual(normalizeLifi(lifiFixture(), req, now, { assumePreapproved: true })[0].missingCosts, []);
});

test("LI.FI missing or ambiguous fee metadata does not become a complete cost", () => {
  const body = lifiFixture();
  delete (body.routes[0].steps[0].estimate as { feeCosts?: unknown }).feeCosts;
  const [q] = normalizeLifi(body, req, now, { assumePreapproved: true });
  assert.ok(q.missingCosts.length > 0);
});

test("Relay requires gas denominated in the native asset on the source chain", () => {
  const body = { steps: [{ kind: "transaction" }], fees: { gas: { amountUsd: "0.05", currency: { chainId: 137, address: NATIVE } } },
    details: { currencyIn: { currency: from, amount: req.amount }, currencyOut: { currency: to, amount: "99000000000000000000", minimumAmount: "98000000000000000000" } } };
  assert.equal(normalizeRelay(body, req, now)[0].externalCostUsd, "0.05");
  body.fees.gas.currency.address = from.address;
  assert.equal(normalizeRelay(body, req, now)[0].externalCostUsd, null);
  body.details.currencyIn.amount = "99999999";
  assert.throws(() => normalizeRelay(body, req, now), /input mismatch/);
});

test("CoW counts the sell-token fee within the requested input exactly once", () => {
  const local = { ...req, from: { ...from, chainId: 100 } };
  const body = { id: 1, verified: true, expiration: new Date(now + 20000).toISOString(),
    quote: { sellToken: from.address, buyToken: to.address, kind: "sell", sellAmount: "99000000", feeAmount: "1000000", buyAmount: "85000000000000000000" } };
  const [q] = normalizeCow(body, local, now, { assumePreapproved: true });
  assert.equal(q.amountIn, req.amount);
  assert.equal(q.amountOut, body.quote.buyAmount);
  assert.equal(q.externalCostUsd, "0");
  assert.equal(q.expiresAt, now + 20000);
  body.quote.sellAmount = "100000000";
  assert.throws(() => normalizeCow(body, local, now), /sellAmountBeforeFee/);
});

test("CoW native assets need a separate supported wrap route, not a fake ERC-20 quote", () => {
  const cow = createProviders(async () => ({})).find((p) => p.id === "cow")!;
  assert.equal(cow.supports({ ...from, chainId: 100, address: NATIVE }, to), false);
  assert.equal(cow.supports(from, to), false);
  assert.equal(cow.supports({ ...from, chainId: 100 }, to), true);
});

test("discovery generalizes across networks and never merges same-symbol addresses", async () => {
  const second = { ...to, address: "0x" + "4".repeat(40), symbol: "USDC", coinKey: "USDC" };
  const result = await discoverPivots(async (url) => url.includes("relay.link") ? { chains: [
    { id: 100, vmType: "evm", currency: { address: NATIVE, decimals: 18, symbol: "xDAI", id: "dai" },
      solverCurrencies: [{ ...to, id: "usdc", symbol: "USDC" }] },
  ] } : { tokens: { "100": [second], "137": [{ ...from, coinKey: "USDC" }] } }, [137, 100], 4);
  assert.equal(result.pivots.filter((a) => a.chainId === 100).length, 3);
  assert.ok(result.pivots.some((a) => a.chainId === 137));
  assert.equal(result.errors.length, 0);
});

test("evidence excludes credentials and replays without a network fallback", async () => {
  const evidence: HttpEvidence[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init!.headers as Record<string, string>)["x-api-key"], "SECRET_TEST_KEY");
    return new Response(JSON.stringify({ routes: [] }), { status: 200 });
  }) as typeof fetch;
  const http = createJsonHttp((item) => evidence.push(item), fetcher);
  await http("https://li.quest/v1/advanced/routes", { input: "100" }, { "x-api-key": "SECRET_TEST_KEY" });
  assert.equal(JSON.stringify(evidence).includes("SECRET_TEST_KEY"), false);
  const clock = { now: 0 };
  const replay = createReplayHttp(evidence, clock);
  assert.deepEqual(await replay("https://li.quest/v1/advanced/routes", { input: "100" }), { routes: [] });
  assert.ok(clock.now > 0);
  await assert.rejects(replay("https://li.quest/v1/advanced/routes", { input: "100" }), /No recorded response/);
});

test("normalizers accept projected real API responses while preserving cost uncertainties", () => {
  const live = JSON.parse(readFileSync(new URL("./fixtures/live-2026-09-23.json", import.meta.url), "utf8"));
  const route = live.lifi.response.routes[0];
  const actual: QuoteRequest = { ...req, from: route.fromToken, to: route.toToken, amount: route.fromAmount };
  assert.equal(normalizeLifi(live.lifi.response, actual, live.lifi.capturedAt)[0].amountOut, "173382611583243031148");
  assert.equal(normalizeRelay(live.relay.response, actual, live.relay.capturedAt)[0].amountOut, "173817193217081909028");
  const cow = live.cow.response.quote;
  const local: QuoteRequest = { ...actual, from: { chainId: 100, address: cow.sellToken, decimals: 18 },
    amount: (BigInt(cow.sellAmount) + BigInt(cow.feeAmount)).toString() };
  const [normalized] = normalizeCow(live.cow.response, local, live.cow.capturedAt);
  assert.equal(normalized.amountOut, cow.buyAmount);
  assert.ok(normalized.missingCosts.includes("CoW additional protocol fee treatment requires verification"));
});

// Transaction gas parameters projected from the supplied 2026-09-23 capture.
// Synthetic wallet, tokens and approval calldata keep user details out of fixtures.
function relayTransactions() {
  const tx = { from: req.wallet, to: "0x" + "4".repeat(40), chainId: 137,
    gas: "115321", maxFeePerGas: "353628538606", value: "0", data: "0x1234" };
  return { steps: [
    { id: "approve", kind: "transaction", items: [{ status: "incomplete", data: { ...tx, to: from.address, gas: "100804",
      data: "0x095ea7b3" + "4".repeat(40).padStart(64, "0") + BigInt(req.amount).toString(16).padStart(64, "0") } }] },
    { id: "deposit", kind: "transaction", items: [{ status: "incomplete", data: tx }] },
  ], fees: { gas: { amount: "40780796700582526", amountUsd: "0.004093", currency: { chainId: 137, address: NATIVE, decimals: 18, symbol: "POL" } } },
  details: { currencyIn: { currency: from, amount: req.amount }, currencyOut: { currency: to, amount: "99000000000000000000" } } };
}

test("Relay counts approval and deposit gas once using exact native-unit ratios", () => {
  const [q] = normalizeRelay(relayTransactions(), req, now);
  assert.equal(q.externalCostUsd, "0.007670759228588029");
  assert.equal(q.gasAccounting, "transactions");
  assert.equal(q.gasEstimates?.length, 2);
  assert.equal(q.gasEstimates?.[0].amountRaw, "35647171205639224");
  assert.equal(q.gasEstimates?.[1].amountUsd, "0.004093");
  assert.deepEqual(q.missingCosts, []);
  assert.equal(q.amountOut, "99000000000000000000");
  assert.equal(normalizeRelay(relayTransactions(), req, now, { assumePreapproved: true })[0].externalCostUsd, "0.004093");
});

test("Relay keeps missing or mismatched transaction gas unresolved", () => {
  for (const mutation of [
    (b: ReturnType<typeof relayTransactions>) => { b.steps[0].items[0].data.gas = ""; },
    (b: ReturnType<typeof relayTransactions>) => { b.steps[1].items[0].data.chainId = 100; },
    (b: ReturnType<typeof relayTransactions>) => { b.fees.gas.amount = "0"; },
    (b: ReturnType<typeof relayTransactions>) => { b.fees.gas.amountUsd = "0"; },
  ]) {
    const body = relayTransactions(); mutation(body);
    const [q] = normalizeRelay(body, req, now);
    assert.equal(q.gasAccounting, "provider_summary");
    assert.ok(q.missingCosts.includes("Relay transaction gas coverage unverified"));
    assert.ok(q.missingCosts.includes("ERC-20 approval gas not measured"));
  }
  const wrongSpender = relayTransactions();
  wrongSpender.steps[0].items[0].data.data = wrongSpender.steps[0].items[0].data.data.replace("4".repeat(40), "5".repeat(40));
  assert.ok(normalizeRelay(wrongSpender, req, now)[0].missingCosts.includes("ERC-20 approval gas not measured"));
  const otherToken = relayTransactions(); otherToken.steps[0].items[0].data.to = to.address;
  assert.ok(normalizeRelay(otherToken, req, now)[0].missingCosts.includes("ERC-20 approval gas not measured"));
});

test("Relay accounts for multiple items within one transaction step", () => {
  const body = relayTransactions();
  body.steps[1].items.push(structuredClone(body.steps[1].items[0]));
  assert.equal(normalizeRelay(body, req, now)[0].externalCostUsd, "0.011763759228588029");
});

test("LI.FI exposes its fee recipient without subtracting included fees or nested duplicates", () => {
  const body = lifiFixture();
  Object.assign(body.routes[0].steps[0].estimate.feeCosts[0], { name: "LIFI Fixed Fee", token: { ...from, symbol: "USDC" },
    amount: "500000", amountUSD: "0.5001", feeSplit: { lifiFee: "500000", integratorFee: "0", recipients: [{ name: "lifi", fee: "500000" }] } });
  const [q] = normalizeLifi(body, req, now);
  assert.equal(q.externalCostUsd, "1.2");
  assert.equal(q.fees?.length, 2);
  assert.deepEqual(q.fees?.[0].recipients, [{ name: "lifi", amountRaw: "500000" }]);
  assert.equal(q.fees?.[0].included, true);
  assert.equal(q.fees?.[0].amountUsd, "0.5001");
});

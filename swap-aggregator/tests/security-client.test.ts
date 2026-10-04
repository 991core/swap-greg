import { expect, it, vi } from "vitest";
import { authorizeSwapIntent, createTransactionAuthorizer, isRegistryToken, preloadTrustedRegistry } from "../lib/security/client";
import seed from "../security/trusted-tokens.v1.json";
import { validateTrustedRegistry } from "../lib/security/identity";
import { getPopularTokens } from "../lib/tokens/catalog";
import type { SecuritySwapIntent } from "../lib/security/quote-validator";
const intent: SecuritySwapIntent = { provider: "lifi", protocol: "test", fromChainId: 8453, toChainId: 1,
  fromTokenAddress: "0x0000000000000000000000000000000000000000", toTokenAddress: "0x0000000000000000000000000000000000000000",
  fromTokenDecimals: 18, toTokenDecimals: 18, fromAddress: "0x1111111111111111111111111111111111111111", receiver: "0x1111111111111111111111111111111111111111",
  fromAmount: "1", toAmount: "1", minimumAmountOut: "1", expiresAt: 9999999999999, maxSlippageBps: 50 };
it.each([{}, { authorized: false, registryVersion: 1 }, { authorized: true }, { authorized: true, registryVersion: 0 }, { authorized: true, registryVersion: "1" }])("rejects HTTP 200 without valid authorization %j", async data => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
  await expect(authorizeSwapIntent(intent, intent)).rejects.toThrow("SECURITY_VALIDATION_UNAVAILABLE");
});
it("rejects unexpected HTML and oversized authorization bodies", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>")));
  await expect(authorizeSwapIntent(intent, intent)).rejects.toThrow("SECURITY_VALIDATION_UNAVAILABLE");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(" ".repeat(9000))));
  await expect(authorizeSwapIntent(intent, intent)).rejects.toThrow("SECURITY_VALIDATION_UNAVAILABLE");
});
it("captures the user intent immutably for each later transaction authorization", async () => {
  const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ authorized: true, registryVersion: 1 })); vi.stubGlobal("fetch", fetchMock);
  const original = { ...intent }; const authorize = createTransactionAuthorizer(original); original.receiver = "0x2222222222222222222222222222222222222222";
  await authorize({ chainId: 8453, from: intent.fromAddress, to: intent.fromAddress, data: "0x12345678", value: "0" }, { provider: "lifi", kind: "swap" });
  const options = fetchMock.mock.calls[0][1] as RequestInit;
  expect(JSON.parse(String(options.body)).intent.receiver).toBe(intent.receiver);
});
it("treats registry load failure as untrusted and uses exact identities when loaded", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  const token = getPopularTokens(8453)[0]; expect(isRegistryToken(await preloadTrustedRegistry(), token)).toBe(false);
  const state = { status: "ready" as const, registry: validateTrustedRegistry(seed) };
  expect(isRegistryToken(state, token)).toBe(true);
  expect(isRegistryToken(state, { ...token, decimals: 6 })).toBe(false);
  expect(isRegistryToken(state, { ...token, address: intent.fromAddress, riskAcknowledged: true })).toBe(false);
});

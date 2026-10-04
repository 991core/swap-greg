import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { OneClickNormalizedRoute } from "../lib/types/normalized-route";
import type { RouteSelectionParams } from "../lib/routing/orchestrator";
vi.mock("../lib/wallet", () => ({ walletConfig: {} }));
// This suite isolates quote lifetime/verdict revocation; security-api.test.ts exercises real authority.
vi.mock("../lib/security/client", async original => {
  const actual = await original<typeof import("../lib/security/client")>();
  const seed = (await import("../security/trusted-tokens.v1.json")).default;
  const state = { status: "ready" as const, registry: seed, executionConfigured: true };
  return { ...actual, registrySnapshot: () => state, serverRegistrySnapshot: () => state, subscribeRegistry: () => () => {}, preloadTrustedRegistry: vi.fn(async () => state), authorizeSwapIntent: vi.fn(async () => {}), createTransactionAuthorizer: () => vi.fn(async () => {}) };
});
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" }),
  useBalance: () => ({ data: { value: BigInt("1000000000000000000") }, refetch: vi.fn() }),
  useReadContract: () => ({ data: BigInt("1000000000000000000"), refetch: vi.fn() }),
}));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(() => ({ isConnected: true, chainId: 8453, address: "0x1111111111111111111111111111111111111111" })), getBalance: vi.fn(), readContract: vi.fn(), switchChain: vi.fn() }));
vi.mock("../lib/aggregators/lifi/execute", () => ({ executeLifiRoute: vi.fn() }));
vi.mock("../lib/aggregators/rango/execute", () => ({ executeRangoRoute: vi.fn() }));
vi.mock("../lib/aggregators/oneclick/execute", () => ({ executeOneClickRoute: vi.fn() }));
vi.mock("../lib/aggregators/oneclick/client", () => ({ fetchOneClickTokens: vi.fn(async () => ({})) }));
vi.mock("../lib/routing/orchestrator", () => ({ getRoutesForSelection: vi.fn() }));
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn(), getTokenDetails: vi.fn() }));
vi.mock("../lib/tokens/popular", async original => ({ ...await original<typeof import("../lib/tokens/popular")>(), preloadPopularTokens: vi.fn(async () => {}) }));
vi.mock("../lib/pricing", async (original) => ({ ...await original<typeof import("../lib/pricing")>(), fetchTokenPriceUsd: vi.fn(async () => null), fetchUsdEurRate: vi.fn(async () => null) }));
import { SwapCard } from "../components/SwapCard";
import { I18nProvider } from "../lib/i18n";
import { getCatalogToken } from "../lib/tokens/catalog";
import { searchTokens, getTokenDetails } from "../lib/tokens/client";
import { getRoutesForSelection } from "../lib/routing/orchestrator";
import { executeSwapQuote } from "../lib/routing/execute";
import { executeOneClickRoute } from "../lib/aggregators/oneclick/execute";
import { getBalance, switchChain } from "wagmi/actions";
import { isObservedTokenFlagged } from "../lib/tokens/verdicts";

const known = getCatalogToken(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); localStorage.setItem("hermes-lang", "en");
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => ({ chainId, query, tokens: [{ ...known, verificationStatus: "flagged" }], checkedAt: Date.now(), limit: 25, hasMore: false, truncated: false }));
});

it("revokes an existing catalogue 1Click selection after observing a flag, closing the picker and attempting execution", async () => {
  let original!: OneClickNormalizedRoute;
  let request!: RouteSelectionParams;
  vi.mocked(getRoutesForSelection).mockImplementation(async input => {
    request = input;
    original = { ...input, provider: "oneclick", id: "oneclick:original", toAmount: "900000000000000", toAmountMin: "800000000000000",
      gasCostUSD: null, toolLabel: "1Click", durationSeconds: 60, expiresAt: Date.now() + 30_000,
      raw: { fromToken: input.fromToken!, toToken: input.toToken!, minAmountOut: "800000000000000" } };
    return [original];
  });
  const view = render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.click(view.container.querySelectorAll(".jumper-token-select")[0]);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^USDC / }));
  expect(searchTokens).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "1" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Swap" }).disabled).toBe(false);
  const signal = vi.mocked(getRoutesForSelection).mock.calls[0][1];

  fireEvent.click(view.container.querySelectorAll(".jumper-token-select")[0]);
  fireEvent.change(screen.getByRole("textbox", { name: "Name, symbol or contract address" }), { target: { value: "usdc" } });
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>("button", { name: /^USDC / }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(view.container.querySelectorAll(".jumper-token-symbol")[0].textContent).toBe("USDC");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Swap" }).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("flagged");
  expect(signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));

  // Also exercise the real common preflight against the old selected route.
  await expect(executeSwapQuote(original, request, vi.fn(), { fromToken: request.fromToken!, toToken: request.toToken! }, undefined, { confirm: vi.fn(() => true), onPending: vi.fn() })).rejects.toThrow("token_blocked");
  expect(executeOneClickRoute).not.toHaveBeenCalled();
  expect(getBalance).not.toHaveBeenCalled(); expect(switchChain).not.toHaveBeenCalled();
  expect(getTokenDetails).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(getRoutesForSelection).toHaveBeenCalledOnce();

  // Local exact-address resolution cannot erase a previously observed flag.
  fireEvent.click(view.container.querySelectorAll(".jumper-token-select")[0]);
  fireEvent.change(screen.getByRole("textbox", { name: "Name, symbol or contract address" }), { target: { value: known.address } });
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>("button", { name: /^USDC / }).disabled).toBe(true);
  expect(searchTokens).toHaveBeenCalledOnce();
  expect(isObservedTokenFlagged({ ...known, chainId: 1 })).toBe(false);
});

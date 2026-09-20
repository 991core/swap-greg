import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { NormalizedRoute } from "../lib/types/normalized-route";
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" }),
  useBalance: () => ({ data: { value: BigInt("1000000000000000000") }, refetch: vi.fn() }),
  useReadContract: () => ({ data: BigInt("1000000000000000000"), refetch: vi.fn() }),
}));
vi.mock("../lib/aggregators/lifi/client", () => ({ getLifiSdkClient: vi.fn() }));
vi.mock("../lib/routing/orchestrator", () => ({ getRoutesForSelection: vi.fn() }));
vi.mock("../lib/routing/execute", () => ({ executeSwapQuote: vi.fn(), SwapValidationError: class extends Error {} }));
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn(), getTokenDetails: vi.fn() }));
vi.mock("../lib/pricing", async (original) => ({ ...await original<typeof import("../lib/pricing")>(), fetchTokenPriceUsd: vi.fn(async () => null), fetchUsdEurRate: vi.fn(async () => null) }));
import { SwapCard } from "../components/SwapCard";
import { I18nProvider } from "../lib/i18n";
import { getRoutesForSelection } from "../lib/routing/orchestrator";
import { executeSwapQuote } from "../lib/routing/execute";
import { searchTokens } from "../lib/tokens/client";
import { quote } from "./fixtures";
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); localStorage.setItem("hermes-lang", "en"); });
it("automatically updates the quote and blocks Swap while refreshing without executing", async () => {
  let finish!: (routes: NormalizedRoute[]) => void;
  vi.mocked(getRoutesForSelection).mockImplementationOnce(async () => [quote()]).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const view = render(<I18nProvider><SwapCard /></I18nProvider>);
  // The form and both local defaults exist on the first render.
  expect(view.container.querySelectorAll(".jumper-token-select")).toHaveLength(2);
  expect(searchTokens).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Swap" }).disabled).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Searching routes…" }).disabled).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("radio").disabled).toBe(true);
  expect(screen.getByRole("timer").textContent).toContain("Refreshing quotes…");
  const refreshed = { ...quote("lifi:refreshed"), toAmount: "800000000000000" };
  await act(async () => finish([refreshed]));
  expect(screen.getByLabelText<HTMLInputElement>("You receive").value).toBe("0.0008");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Swap" }).disabled).toBe(false);
  expect(executeSwapQuote).not.toHaveBeenCalled();
});

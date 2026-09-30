import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { NormalizedRoute } from "../lib/types/normalized-route";
const account = vi.hoisted(() => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" }));
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useBalance: () => ({ data: { value: BigInt("1000000000000000000") }, refetch: vi.fn() }),
  useReadContract: () => ({ data: BigInt("1000000000000000000"), refetch: vi.fn() }),
}));
vi.mock("../lib/aggregators/lifi/client", () => ({ getLifiSdkClient: vi.fn() }));
vi.mock("../lib/routing/orchestrator", () => ({ getRoutesForSelection: vi.fn() }));
vi.mock("../lib/routing/execute", () => ({ executeSwapQuote: vi.fn(), SwapValidationError: class extends Error {} }));
vi.mock("../lib/aggregators/oneclick/client", () => ({ fetchOneClickTokens: vi.fn(async () => ({})) }));
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn(), getTokenDetails: vi.fn() }));
vi.mock("../lib/pricing", async (original) => ({ ...await original<typeof import("../lib/pricing")>(), fetchTokenPriceUsd: vi.fn(async () => null), fetchUsdEurRate: vi.fn(async () => null) }));
import { SwapCard } from "../components/SwapCard";
import { I18nProvider } from "../lib/i18n";
import { getRoutesForSelection } from "../lib/routing/orchestrator";
import { executeSwapQuote } from "../lib/routing/execute";
import { searchTokens } from "../lib/tokens/client";
import { quote } from "./fixtures";
import { normalizedRango, pendingRango } from "./rango-fixtures";
import { PENDING_RANGO_KEY } from "../lib/aggregators/rango/tracking";
import { fetchUsdEurRate, fetchTokenPriceUsd } from "../lib/pricing";
beforeEach(() => { account.isConnected = true; vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(getRoutesForSelection).mockReset(); localStorage.setItem("hermes-lang", "en"); localStorage.removeItem(PENDING_RANGO_KEY); localStorage.removeItem("hermes-currency"); });
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
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Searching routes…" }).disabled).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("radio").disabled).toBe(true);
  expect(screen.getByRole("timer").textContent).toContain("Refreshing quotes…");
  const refreshed = { ...quote("lifi:refreshed"), toAmount: "800000000000000" };
  await act(async () => finish([refreshed]));
  expect(screen.getByLabelText<HTMLInputElement>("You receive").value).toBe("0.0008");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Swap" }).disabled).toBe(false);
  expect(executeSwapQuote).not.toHaveBeenCalled();
});
it("shows both providers and switches the available routes after toggling", async () => {
  vi.mocked(getRoutesForSelection).mockImplementation(async input => input.providers?.rango ? [normalizedRango(), quote()] : [quote()]);
  render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  const toggle = screen.getByRole("button", { name: "Rango" });
  expect(toggle.getAttribute("aria-pressed")).toBe("true"); fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("false"); expect(screen.queryAllByRole("radio")).toHaveLength(0);
  await act(() => vi.advanceTimersByTimeAsync(500)); expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(executeSwapQuote).not.toHaveBeenCalled();
});
it("restores a pending Rango transaction after reload and prevents sending it again", async () => {
  localStorage.setItem(PENDING_RANGO_KEY, JSON.stringify(pendingRango()));
  render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.getByRole("button", { name: "Resume tracking" })).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Transaction submitted" }).disabled).toBe(true);
  expect(getRoutesForSelection).not.toHaveBeenCalled(); expect(executeSwapQuote).not.toHaveBeenCalled();
  localStorage.removeItem(PENDING_RANGO_KEY);
});
it("converts quote fees to EUR, remembers the preference and leaves quote requests unchanged", async () => {
  vi.mocked(fetchUsdEurRate).mockResolvedValueOnce({ rate: 0.9, date: "2026-09-18" });
  vi.mocked(fetchTokenPriceUsd).mockResolvedValueOnce(2500).mockResolvedValueOnce(2500);
  vi.mocked(getRoutesForSelection).mockImplementation(async () => [quote()]);
  render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  fireEvent.click(screen.getByRole("button", { name: "EUR" }));
  expect(screen.getByRole("button", { name: "EUR" }).getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem("hermes-currency")).toBe("EUR");
  expect(screen.getByText("≈ €2.03")).toBeTruthy();
  expect(screen.queryByText("≈ $2.25")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(getRoutesForSelection).toHaveBeenCalledTimes(1);
  expect(executeSwapQuote).not.toHaveBeenCalled();
});
it("disables EUR when its rate is unavailable and asks for a token when no pinned equivalent exists", async () => {
  render(<I18nProvider><SwapCard /></I18nProvider>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "EUR" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  fireEvent.click(screen.getByRole("button", { name: "Source network: Base" }));
  fireEvent.click(screen.getByRole("option", { name: "Polygon" }));
  expect(screen.getByRole("button", { name: "Source network: Polygon" })).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("You send").value).toBe("");
  expect(screen.getByRole("dialog", { name: "Select source token" })).toBeTruthy();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(searchTokens).not.toHaveBeenCalled();
});

it("quotes without a wallet and invalidates the preview when connecting", async () => {
  account.isConnected = false;
  vi.mocked(getRoutesForSelection).mockImplementation(async input => [{ ...quote(), fromAddress: input.fromAddress }]);
  const view = render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(getRoutesForSelection).toHaveBeenLastCalledWith(expect.objectContaining({ fromAddress: "" }), expect.anything(), undefined, expect.anything());
  expect(screen.getByRole("radio")).toBeTruthy();
  account.isConnected = true; view.rerender(<I18nProvider><SwapCard /></I18nProvider>);
  expect(screen.queryByRole("radio")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(getRoutesForSelection).toHaveBeenLastCalledWith(expect.objectContaining({ fromAddress: account.address }), expect.anything(), undefined, expect.anything());
  expect(executeSwapQuote).not.toHaveBeenCalled();
});
it("inverts the token and network pair without substituting the quoted output amount", async () => {
  vi.mocked(getRoutesForSelection).mockImplementation(async () => [quote()]);
  render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  fireEvent.click(screen.getByRole("button", { name: "Invert" }));
  expect(screen.getByLabelText<HTMLInputElement>("You send").value).toBe("0.001");
  expect(screen.getByRole("button", { name: "Source network: Ethereum" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Destination network: Base" })).toBeTruthy();
});

it("keeps quote failures in logs, retries silently, and still displays execution errors", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getRoutesForSelection).mockRejectedValueOnce(new Error("No selected provider is available. Retrying automatically.")).mockImplementation(async () => [quote()]);
  render(<I18nProvider><SwapCard /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: "0.001" } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/No selected provider|temporarily unavailable/)).toBeNull();
  expect(warn).toHaveBeenCalledWith("[Hermes quotes]", expect.objectContaining({ event: "refresh_failed", reason: "all_providers_failed" }));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByRole("radio")).toBeTruthy();
  vi.mocked(executeSwapQuote).mockRejectedValueOnce(new Error("Wallet rejected the transaction"));
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("alert").textContent).toBe("Wallet rejected the transaction");
});

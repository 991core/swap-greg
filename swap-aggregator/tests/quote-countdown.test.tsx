import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuoteCountdown } from "../components/QuoteCountdown";
import { I18nProvider } from "../lib/i18n";
beforeEach(() => { vi.useFakeTimers(); localStorage.setItem("hermes-lang", "fr"); });
it("shows the seconds left and switches to the refresh animation at the deadline", async () => {
  const props = { expiresAt: Date.now() + 60_000, retryAt: null, loading: false, waiting: false, suspended: false };
  const view = render(<I18nProvider><QuoteCountdown {...props} /></I18nProvider>);
  expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Actualisation automatique dans 60s");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole("timer").textContent).toContain("59s");
  await act(() => vi.advanceTimersByTimeAsync(59_000));
  expect(screen.getByRole("timer").className).toContain("is-refreshing");
  view.rerender(<I18nProvider><QuoteCountdown {...props} expiresAt={Date.now() + 60_000} /></I18nProvider>);
  expect(screen.getByRole("timer").textContent).toContain("60s");
});
it("shows the retry delay and pauses its animation during a transaction", () => {
  const props = { expiresAt: Date.now() - 1, retryAt: Date.now() + 15_000, loading: false, waiting: false, suspended: false };
  const view = render(<I18nProvider><QuoteCountdown {...props} /></I18nProvider>);
  expect(screen.getByRole("timer").textContent).toContain("Nouvelle tentative dans 15s");
  view.rerender(<I18nProvider><QuoteCountdown {...props} suspended /></I18nProvider>);
  expect(screen.getByRole("timer").textContent).toContain("suspendue pendant la transaction");
  expect(screen.getByRole("timer").className).not.toContain("is-refreshing");
});

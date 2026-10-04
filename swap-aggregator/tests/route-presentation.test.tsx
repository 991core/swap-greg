import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { quoteAmount, quoteFiat } from "../lib/presentation";
import { RouteList } from "../components/RouteList";
import { fromToken, quote } from "./fixtures";
import { canExecuteQuote } from "../lib/routing/quote";
import { params } from "./fixtures";

it("keeps tiny token amounts non-zero and the exact large integer value available", () => {
  expect(quoteAmount("1", 18)).toEqual({ exact: "0.000000000000000001", short: "0.000000000000000001", rounded: false });
  const amount = quoteAmount("9007199254740993123456789", 18);
  expect(amount).toEqual({ exact: "9007199.254740993123456789", short: "9007199.25474", rounded: true });
});

it("never presents a non-zero fee as free and cannot invent an EUR exchange rate", () => {
  expect(quoteFiat(0.00001, "USD", null, "en")).toBe("< $0.01");
  expect(quoteFiat(0, "USD", null, "en")).toBe("$0.00");
  expect(quoteFiat(2, "EUR", null, "en")).toBeNull();
  expect(quoteFiat(2, "EUR", 0.9, "en")).toBe("€1.80");
});

it("keeps decision amounts visible and expanding details does not select a route", () => {
  localStorage.setItem("hermes-lang", "en");
  const route = quote(); route.raw.steps[0].estimate.feeCosts = [{ name: "Bridge fee", description: "Bridge fee", amount: "123", token: fromToken, included: false, percentage: "0", amountUSD: "0.01" }];
  const onSelect = vi.fn();
  render(<I18nProvider><RouteList routes={[route]} selectedId={null} onSelect={onSelect} toDecimals={18} toSymbol="ETH" priceUsd={2500} /></I18nProvider>);
  const card = screen.getByRole("article");
  expect(within(card).getByText("0.0009")).toBeTruthy();
  expect(within(card).getByText("0.0008955 ETH")).toBeTruthy();
  expect(within(card).getByText("Other additional fees · see details")).toBeTruthy();
  fireEvent.click(within(card).getByText("Route details"));
  expect(card.querySelector("details")?.open).toBe(true);
  expect(within(card).getByText("0.000000000000000123 ETH")).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio"));
  expect(onSelect).toHaveBeenCalledWith(route);
});

it("keeps other routes visible when a remote fee is malformed and disables only that route", () => {
  const broken = quote("lifi:broken");
  broken.raw.steps[0].estimate.feeCosts = [{ name: "Invalid", amount: "oops", token: fromToken, included: false }] as typeof broken.raw.steps[0]["estimate"]["feeCosts"];
  const good = quote("lifi:good");
  const select = vi.fn();
  render(<I18nProvider><RouteList routes={[broken, good]} selectedId={null} onSelect={select} toDecimals={18} toSymbol="ETH" /></I18nProvider>);
  const radios = screen.getAllByRole<HTMLInputElement>("radio");
  expect(radios[0].disabled).toBe(true);
  expect(radios[1].disabled).toBe(false);
  expect(screen.getByText("Fee details unavailable · route disabled")).toBeTruthy();
  expect(canExecuteQuote(broken, params)).toBe(false);
  fireEvent.click(radios[1]); expect(select).toHaveBeenCalledWith(good);
});

it("shows an incompatible LI.FI route but blocks selection before any wallet request", () => {
  const unsupported = quote("lifi:two-wallet-steps");
  unsupported.raw.steps.push(structuredClone(unsupported.raw.steps[0]));
  render(<I18nProvider><RouteList routes={[unsupported]} selectedId={null} onSelect={vi.fn()} toDecimals={18} toSymbol="ETH" /></I18nProvider>);
  expect(screen.getByRole<HTMLInputElement>("radio").disabled).toBe(true);
  expect(screen.getByText("This route needs wallet actions this release does not support")).toBeTruthy();
  expect(canExecuteQuote(unsupported, params)).toBe(false);
});

it("does not crash the route list when gas metadata is malformed", () => {
  const broken = quote("lifi:broken-gas");
  broken.raw.steps[0].estimate.gasCosts = [{ amount: "1", token: null }] as unknown as typeof broken.raw.steps[0]["estimate"]["gasCosts"];
  const good = quote("lifi:good-gas");
  render(<I18nProvider><RouteList routes={[broken, good]} selectedId={null} onSelect={vi.fn()} toDecimals={18} toSymbol="ETH" /></I18nProvider>);
  const radios = screen.getAllByRole<HTMLInputElement>("radio");
  expect(radios[0].disabled).toBe(true);
  expect(radios[1].disabled).toBe(false);
  expect(screen.getByText("Gas details unavailable · route disabled")).toBeTruthy();
  expect(canExecuteQuote(broken, params)).toBe(false);
});

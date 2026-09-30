import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { quoteAmount, quoteFiat } from "../lib/presentation";
import { RouteList } from "../components/RouteList";
import { fromToken, quote } from "./fixtures";

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

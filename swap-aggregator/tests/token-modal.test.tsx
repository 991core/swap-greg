import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExtendedChain } from "@lifi/sdk";
vi.mock("../lib/contractTokenResolver", () => ({ looksLikeAddress: () => false, resolveTokenByAddress: vi.fn() }));
import TokenSelectModal from "../components/TokenSelectModal";
import { I18nProvider } from "../lib/i18n";
import { fromToken, toToken } from "./fixtures";
import React from "react";
it("changing the modal chain changes its token list and the selected token's chain", () => {
  const onSelect = vi.fn();
  const baseToken = { ...fromToken, symbol: "BASE-ETH", name: "Base Ether" };
  const chains = [{ id: 1, name: "Ethereum" }, { id: 8453, name: "Base" }] as ExtendedChain[];
  const modal = React.createElement(TokenSelectModal, { open: true, onClose: vi.fn(), onSelect, title: "Select source token", selectedChainId: 1, selectedToken: toToken, chains, tokensByChain: { 1: [toToken], 8453: [baseToken] } });
  render(React.createElement(I18nProvider, null, modal));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "8453" } });
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("8453");
  fireEvent.click(screen.getByRole("button", { name: /BASE-ETH/ }));
  expect(onSelect).toHaveBeenCalledWith(8453, baseToken);
});

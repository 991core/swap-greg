import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExtendedChain } from "@lifi/sdk";
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn() }));
import { searchTokens } from "../lib/tokens/client";
import { TokenSearchError, type AppToken, type TokenSearchResult } from "../lib/tokens/types";
import TokenSelectModal from "../components/TokenSelectModal";
import { I18nProvider } from "../lib/i18n";
import { fromToken, toToken } from "./fixtures";
import { getCatalogToken } from "../lib/tokens/catalog";

const chains = [{ id: 1, name: "Ethereum" }, { id: 8453, name: "Base" }] as ExtendedChain[];
const custom: AppToken = { ...fromToken, chainId: 1, symbol: "CAFE", name: "Cafe Token", address: "0x2222222222222222222222222222222222222222", verificationStatus: "unverified" };
function result(chainId: number, query: string, tokens: AppToken[] = [], extra: Partial<TokenSearchResult> = {}): TokenSearchResult {
  return { chainId, query, tokens, limit: 25, hasMore: false, truncated: false, checkedAt: Date.now(), ...extra };
}
function mount() {
  const onSelect = vi.fn();
  render(<I18nProvider><TokenSelectModal open onClose={vi.fn()} onSelect={onSelect} title="Select source token" selectedChainId={1} selectedToken={toToken} chains={chains} /></I18nProvider>);
  return onSelect;
}
async function tick(ms = 300) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function type(query: string) { fireEvent.change(screen.getByRole("textbox"), { target: { value: query } }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.mocked(searchTokens).mockReset(); localStorage.setItem("hermes-lang", "en");
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query));
});

it("changing the modal chain changes its token list and the selected token's chain", async () => {
  const onSelect = mount(); await tick(0);
  fireEvent.click(screen.getByRole("combobox")); fireEvent.click(screen.getByRole("option", { name: "Base" })); await tick(0);
  expect(screen.getByRole("combobox").getAttribute("aria-label")).toBe("Chains: Base");
  expect(searchTokens).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /USDC/ }));
  expect(onSelect).toHaveBeenCalledWith(8453, expect.objectContaining({ chainId: 8453, symbol: "USDC", decimals: 6 }));
});
it("supports keyboard network navigation and Escape closes only the network menu", async () => {
  mount();
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Ethereum" }));
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Base" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  expect(searchTokens).not.toHaveBeenCalled();
});
it("debounces catalogue searches and retains homonymous contracts", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, query === "cafe" ? [custom, { ...custom, address: "0x3333333333333333333333333333333333333333" }] : []));
  mount(); await tick(0); type("caf"); await tick(200); type("cafe"); await tick(299);
  expect(searchTokens).not.toHaveBeenCalled(); await tick(1);
  expect(searchTokens).toHaveBeenLastCalledWith(1, "cafe", expect.objectContaining({ limit: 25, signal: expect.any(AbortSignal) }));
  expect(screen.getAllByRole("button", { name: /CAFE/ })).toHaveLength(2);
});
it("requires explicit address/risk consent for an unverified token", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, query ? [custom] : []));
  const onSelect = mount(); type(custom.address); await tick();
  fireEvent.click(screen.getByRole("button", { name: /CAFE/ }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByText(custom.address)).toBeTruthy();
  expect(screen.getByRole<HTMLAnchorElement>("link", { name: /explorer/ }).href).toBe("https://etherscan.io/address/" + custom.address);
  const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Select CAFE" });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
  expect(onSelect).toHaveBeenCalledWith(1, { ...custom, riskAcknowledged: true });
});
it("never selects a token flagged by LI.FI", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, query ? [{ ...custom, verificationStatus: "flagged" }] : []));
  const onSelect = mount(); type("cafe"); await tick();
  const row = screen.getByRole<HTMLButtonElement>("button", { name: /CAFE/ });
  expect(row.disabled).toBe(true); fireEvent.click(row);
  expect(onSelect).not.toHaveBeenCalled(); expect(screen.queryByRole("checkbox")).toBeNull();
});
it("aborts stale searches and ignores late answers even when the transport ignores abort", async () => {
  let finish!: (value: TokenSearchResult) => void;
  vi.mocked(searchTokens).mockImplementation((chainId, query = "") => query === "old" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(result(chainId, query, query === "new" ? [{ ...custom, symbol: "NEW" }] : [])));
  mount(); await tick(0); type("old"); await tick();
  const signal = vi.mocked(searchTokens).mock.calls.at(-1)![2]!.signal!;
  type("new"); expect(signal.aborted).toBe(true); await tick();
  await act(async () => { finish(result(1, "old", [{ ...custom, symbol: "OLD" }])); });
  expect(screen.getByRole("button", { name: /NEW/ })).toBeTruthy(); expect(screen.queryByRole("button", { name: /OLD/ })).toBeNull();
});
it("clears consent and stale rows immediately when switching networks", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, query ? [{ ...custom, chainId }] : []));
  const onSelect = mount(); type("cafe"); await tick(); fireEvent.click(screen.getByRole("button", { name: /CAFE/ }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("combobox")); fireEvent.click(screen.getByRole("option", { name: "Base" }));
  expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("button", { name: /CAFE/ })).toBeNull();
  type("cafe"); await tick(); fireEvent.click(screen.getByRole("button", { name: /CAFE/ }));
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false); expect(onSelect).not.toHaveBeenCalled();
});
it("loads more results without imposing a top-token allowlist", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "", options) => result(chainId, query, [custom], { limit: options?.limit, hasMore: options?.limit === 25 }));
  mount(); type("cafe"); await tick(); fireEvent.click(screen.getByRole("button", { name: "Show more tokens" })); await tick();
  expect(searchTokens).toHaveBeenLastCalledWith(1, "cafe", expect.objectContaining({ limit: 50 }));
});
it("distinguishes rate limits from an empty catalogue and supports retry", async () => {
  vi.mocked(searchTokens).mockRejectedValueOnce(new TokenSearchError("rate_limited", 429)).mockResolvedValue(result(1, "cafe", [custom]));
  mount(); type("cafe"); await tick();
  expect(screen.getByText(/Too many token searches/)).toBeTruthy();
  expect(screen.queryByText("No tokens available for this selection.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await tick();
  expect(screen.getByRole("button", { name: /CAFE/ })).toBeTruthy();
});
it("displays and selects major assets immediately without fetching or consent", async () => {
  vi.mocked(searchTokens).mockRejectedValue(new Error("offline"));
  const onSelect = mount();
  const usdc = screen.getByRole("button", { name: /USDC/ });
  expect(screen.queryByText("Searching LI.FI…")).toBeNull();
  fireEvent.click(usdc);
  expect(onSelect).toHaveBeenCalledWith(1, expect.objectContaining({ symbol: "USDC", decimals: 6 }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  await tick(1000); expect(searchTokens).not.toHaveBeenCalled();
});
it("finds a known contract locally by its exact address without an API request", async () => {
  const onSelect = mount();
  const address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  type(address); fireEvent.click(screen.getByRole("button", { name: /USDC/ })); await tick();
  expect(onSelect).toHaveBeenCalledWith(1, getCatalogToken(1, address));
  expect(searchTokens).not.toHaveBeenCalled();
});
it("keeps local matches visible instantly and through a remote search outage", async () => {
  vi.mocked(searchTokens).mockRejectedValue(new TokenSearchError("tokens_unavailable"));
  mount(); type("usdc"); expect(screen.getByRole("button", { name: /USDC/ })).toBeTruthy();
  await tick(); expect(screen.getByRole("button", { name: /USDC/ })).toBeTruthy();
  expect(screen.getByText(/verification is unavailable/)).toBeTruthy();
});
it("does not give a same-symbol impostor the catalog exemption", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, [{ ...custom, symbol: "USDC" }]));
  const onSelect = mount(); type("usdc"); await tick();
  expect(screen.getAllByRole("button", { name: /USDC/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /USDC Cafe Token/ }));
  expect(screen.getByRole("checkbox")).toBeTruthy(); expect(onSelect).not.toHaveBeenCalled();
});
it("keeps a negative remote verdict on a duplicate catalog asset", async () => {
  const known = getCatalogToken(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")!;
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, [{ ...known, verificationStatus: "flagged" }]));
  mount(); type("usdc"); await tick();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: /USDC/ }).disabled).toBe(true);
});
it("only fetches the remote popular list when browsing more is requested", async () => {
  mount(); await tick(); expect(searchTokens).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Browse more tokens on LI.FI" })); await tick(0);
  expect(searchTokens).toHaveBeenCalledWith(1, "", expect.objectContaining({ limit: 25 }));
});

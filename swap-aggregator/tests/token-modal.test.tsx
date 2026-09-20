import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExtendedChain } from "@lifi/sdk";
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn() }));
import { searchTokens } from "../lib/tokens/client";
import { TokenSearchError, type AppToken, type TokenSearchResult } from "../lib/tokens/types";
import TokenSelectModal from "../components/TokenSelectModal";
import { I18nProvider } from "../lib/i18n";
import { fromToken, toToken } from "./fixtures";

const chains = [{ id: 1, name: "Ethereum" }, { id: 8453, name: "Base" }] as ExtendedChain[];
const custom: AppToken = { ...fromToken, chainId: 1, symbol: "CAFE", name: "Cafe Token", address: "0x2222222222222222222222222222222222222222", verificationStatus: "unverified" };
function result(chainId: number, query: string, tokens: AppToken[] = [], extra: Partial<TokenSearchResult> = {}): TokenSearchResult {
  return { chainId, query, tokens, limit: 25, hasMore: false, truncated: false, checkedAt: Date.now(), ...extra };
}
function mount() {
  const onSelect = vi.fn();
  render(<I18nProvider><TokenSelectModal open onClose={vi.fn()} onSelect={onSelect} title="Select source token" selectedChainId={1} selectedToken={toToken} chains={chains} tokensByChain={{ 1: [toToken], 8453: [fromToken] }} /></I18nProvider>);
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
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "8453" } }); await tick(0);
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("8453");
  expect(searchTokens).toHaveBeenLastCalledWith(8453, "", expect.objectContaining({ limit: 25 }));
  fireEvent.click(screen.getByRole("button", { name: /ETH/ }));
  expect(onSelect).toHaveBeenCalledWith(8453, fromToken);
});
it("debounces catalogue searches and retains homonymous contracts", async () => {
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, query === "cafe" ? [custom, { ...custom, address: "0x3333333333333333333333333333333333333333" }] : []));
  mount(); await tick(0); type("caf"); await tick(200); type("cafe"); await tick(299);
  expect(searchTokens).toHaveBeenCalledOnce(); await tick(1);
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
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "8453" } });
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

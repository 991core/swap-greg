import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../lib/tokens/client", () => ({ searchTokens: vi.fn() }));
import { searchTokens } from "../lib/tokens/client";
import { APP_CHAINS, APP_CHAIN_IDS } from "../lib/chains";
import { preloadPopularTokens } from "../lib/tokens/popular";
import { getPopularTokens } from "../lib/tokens/catalog";
import { TokenSearchError, type AppToken, type TokenSearchResult } from "../lib/tokens/types";
import TokenSelectModal from "../components/TokenSelectModal";
import { I18nProvider } from "../lib/i18n";
import { fetchMarketUniverse } from "../lib/tokens/market-universe";

function popular(chainId: number): AppToken[] {
  return Array.from({ length: 100 }, (_, index) => ({
    chainId, address: "0x" + (1000 + index).toString(16).padStart(40, "0"), decimals: 18,
    symbol: `T${String(index).padStart(3, "0")}`, name: `Popular asset ${index}`,
    priceUSD: "1", marketSource: "coingecko", marketCapUSD: 100 - index, verificationStatus: "unverified" as const,
  }));
}
function result(chainId: number, query = "", tokens = popular(chainId)): TokenSearchResult {
  return { chainId, query, tokens, checkedAt: Date.now(), limit: 100, truncated: true, hasMore: true };
}
function mount(chainId: number) {
  const onSelect = vi.fn();
  render(<I18nProvider><TokenSelectModal open onClose={vi.fn()} onSelect={onSelect} title="Select token" selectedChainId={chainId} selectedToken={null} chains={APP_CHAINS} /></I18nProvider>);
  return onSelect;
}
function rows() { return Array.from(screen.getByRole("dialog").querySelectorAll<HTMLButtonElement>(".jumper-token-row")); }
beforeEach(() => {
  localStorage.setItem("hermes-lang", "en"); vi.mocked(searchTokens).mockReset();
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, query ? [] : popular(chainId)));
});

it.each(APP_CHAIN_IDS)("uses live market capitalization rather than alphabetic discovery on chain %s, even before other networks finish", async chainId => {
  const first = { ...popular(chainId)[0], symbol: "ZBIG", marketCapUSD: 1000 };
  const second = { ...popular(chainId)[1], symbol: "ASMALL", marketCapUSD: 100 };
  const unknown = { ...popular(chainId)[2], symbol: "AAA", marketSource: undefined, marketCapUSD: 1e30 };
  const tokens = Object.fromEntries(APP_CHAIN_IDS.map(id => [id, id === chainId ? [unknown, second, first] : []]));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ source: "coingecko", fetchedAt: new Date().toISOString(),
    assets: [{ provider: "coingecko", providerAssetId: "known-id", symbol: "ZBIG", name: "Fixture", marketCap: 1000, marketCapRank: 1 }],
    tokens, failures: [], targetSize: 100, fetchLimit: 120 })));
  // No popular-list preload has finished. The market snapshot must already sort the picker.
  await fetchMarketUniverse(); mount(chainId);
  expect(rows()[0].querySelector("strong")?.textContent).toBe(getPopularTokens(chainId)[0].symbol);
  expect(rows()[1].textContent).toContain("ZBIG");
  expect(rows()[2].textContent).toContain("ASMALL");
  expect(rows().findIndex(row => row.textContent?.includes("AAA"))).toBeGreaterThan(2);
  expect(searchTokens).not.toHaveBeenCalled();
});

it.each(APP_CHAIN_IDS)("shows the cached top 100 on chain %s in pages of 25 without opening-time requests", async chainId => {
  await preloadPopularTokens([chainId]); vi.mocked(searchTokens).mockClear();
  mount(chainId);
  expect(rows()).toHaveLength(25);
  expect(rows()[0].querySelector("strong")?.textContent).toBe(getPopularTokens(chainId)[0].symbol);
  expect(rows()[1].textContent).toContain("T000"); expect(rows()[24].textContent).toContain("T023");
  expect(screen.queryByRole("button", { name: /T099 / })).toBeNull();
  for (let page = 0; page < 4; page++) fireEvent.click(screen.getByRole("button", { name: "Show more tokens" }));
  expect(rows().filter(row => /^T\d{3}$/.test(row.querySelector("strong")?.textContent ?? ""))).toHaveLength(100);
  expect(rows()[100].textContent).toContain("T099");
  expect(searchTokens).not.toHaveBeenCalled();
});
it("keeps noncatalog popular tokens subject to explicit risk consent", async () => {
  await preloadPopularTokens([8453]); const onSelect = mount(8453);
  fireEvent.click(screen.getByRole("button", { name: /^T000 / }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Select T000" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Select T000" }));
  expect(onSelect).toHaveBeenCalledWith(8453, expect.objectContaining({ symbol: "T000", riskAcknowledged: true }));
});
it("continues remote discovery outside the popular 100 and puts an exact search match first", async () => {
  vi.useFakeTimers(); await preloadPopularTokens([1]); mount(1);
  const other = { ...popular(1)[0], address: "0x9999999999999999999999999999999999999999", symbol: "OUTSIDE", marketCapUSD: 0 };
  vi.mocked(searchTokens).mockImplementation(async (chainId, query = "") => result(chainId, query, [
    { ...other, address: "0x8888888888888888888888888888888888888888", symbol: "OTHER", marketCapUSD: 1_000_000 }, other,
  ]));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "outside" } });
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(rows()[0].textContent).toContain("OUTSIDE");
  expect(searchTokens).toHaveBeenLastCalledWith(1, "outside", expect.objectContaining({ limit: 25 }));
});
it("switches between populated networks without mixing cached identities or making requests", async () => {
  await preloadPopularTokens([1, 8453]); vi.mocked(searchTokens).mockClear(); const onSelect = mount(1);
  fireEvent.click(screen.getByRole("button", { name: /^Chains:/ }));
  fireEvent.click(screen.getByRole("option", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: /^T000 / })); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Select T000" }));
  expect(onSelect).toHaveBeenCalledWith(8453, expect.objectContaining({ chainId: 8453 }));
  expect(searchTokens).not.toHaveBeenCalled();
});
it("keeps local tokens usable while discovery loads or fails", async () => {
  let reject!: (error: unknown) => void;
  vi.mocked(searchTokens).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const loading = preloadPopularTokens([1]); const onSelect = mount(1);
  expect(screen.getByText("Loading popular tokens on this network…")).toBeTruthy();
  const usdc = within(screen.getByRole("dialog")).getByRole("button", { name: /^USDC / });
  expect((usdc as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { reject(new TokenSearchError("tokens_unavailable")); await loading; });
  expect(screen.getByText(/expanded list is unavailable/)).toBeTruthy();
  fireEvent.click(usdc); expect(onSelect).toHaveBeenCalledWith(1, expect.objectContaining({ symbol: "USDC" }));
});
it("keeps a flagged catalog duplicate blocked even when its popular rank is high", async () => {
  const known = getPopularTokens(1).find(token => token.symbol === "USDC")!;
  vi.mocked(searchTokens).mockImplementation(async chainId => result(chainId, "", [{ ...known, marketCapUSD: 10_000_000, verificationStatus: "flagged" }]));
  await preloadPopularTokens([1]); const onSelect = mount(1);
  const row = screen.getByRole<HTMLButtonElement>("button", { name: /^USDC / });
  expect(row.disabled).toBe(true); fireEvent.click(row); expect(onSelect).not.toHaveBeenCalled();
});

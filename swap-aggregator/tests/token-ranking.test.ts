import { describe, expect, it } from "vitest";
import { APP_CHAINS } from "../lib/chains";
import { getCatalogToken, getPopularTokens, isCatalogToken } from "../lib/tokens/catalog";
import { rankTokenResults, sortTokenResults } from "../lib/tokens/ranking";
import type { AppToken } from "../lib/tokens/types";
import { POPULAR_TOKEN_LIMIT } from "../lib/tokens/types";
import { requiresTokenConfirmation, tokenVerification, uniqueTokens, validateToken } from "../lib/tokens/validation";

const asset = (id: number, marketCapUSD?: number): AppToken => ({
  chainId: 8453, address: "0x" + id.toString(16).padStart(40, "0"), decimals: 18,
  name: `Asset ${id}`, symbol: `ASSET${id}`, priceUSD: "0", marketCapUSD, marketSource: "coingecko",
});
const usdc = getCatalogToken(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;

describe("token market data", () => {
  it("copies finite nonnegative provider observations without granting consent", () => {
    const token = validateToken({ ...asset(1), marketCapUSD: 123.5, volumeUSD24H: 0,
      riskAcknowledged: true, isTrusted: true }, 8453)!;
    expect(token).toMatchObject({ marketCapUSD: 123.5, volumeUSD24H: 0, verificationStatus: "unverified" });
    expect(token).not.toHaveProperty("riskAcknowledged");
    expect(token).not.toHaveProperty("isTrusted");
    expect(requiresTokenConfirmation(token)).toBe(true);
  });
  it.each([null, undefined, "100", "", -1, NaN, Infinity, -Infinity, {}, true])("keeps invalid observation %j unknown", value => {
    const token = validateToken({ ...asset(1), marketCapUSD: value, volumeUSD24H: value }, 8453)!;
    expect(token).not.toHaveProperty("marketCapUSD");
    expect(token).not.toHaveProperty("volumeUSD24H");
    expect(tokenVerification(token)).toBe("unverified");
  });
});

describe("market-cap ordering and identity merge", () => {
  it.each(APP_CHAINS)("puts the native asset first on $name even without market data", chain => {
    const native = getPopularTokens(chain.id)[0];
    const large = { ...asset(42, 1e15), chainId: chain.id };
    const small = { ...asset(43, 100), chainId: chain.id };
    const homonym = { ...asset(44, 1000), chainId: chain.id, symbol: native.symbol };
    const ranked = rankTokenResults([native], [small, large, homonym]);
    expect(ranked.map(token => token.address)).toEqual([native.address, large.address, homonym.address, small.address]);
    expect(sortTokenResults([large, native], large.address)[0]).toBe(large);
  });
  it("puts known capitalization first, descending, with stable ties and unknowns", () => {
    const tokens = [asset(1), asset(2, 0), asset(3, 200), asset(4, 200), asset(5, 10), asset(6)];
    expect(sortTokenResults(tokens).map(token => token.symbol)).toEqual(["ASSET3", "ASSET4", "ASSET5", "ASSET2", "ASSET1", "ASSET6"]);
    expect(tokens.map(token => token.symbol)).toEqual(["ASSET1", "ASSET2", "ASSET3", "ASSET4", "ASSET5", "ASSET6"]);
  });
  it("prioritizes an exact address, symbol or name ahead of capitalization", () => {
    const small = asset(1, 1), large = asset(2, 100);
    for (const query of [small.address.toUpperCase(), " asset1 ", "Asset 1"]) {
      expect(sortTokenResults([large, small], query)[0]).toBe(small);
    }
    expect(sortTokenResults([large, small], "asset")[0]).toBe(large);
  });
  it("keeps native, wrapped, homonyms and contracts on different networks separate", () => {
    const native = getPopularTokens(8453)[0];
    const wrapped = getCatalogToken(8453, "0x4200000000000000000000000000000000000006")!;
    const sameSymbol = { ...asset(9, 50), symbol: native.symbol };
    const otherChain = { ...native, chainId: 1 };
    expect(rankTokenResults([native, wrapped], [sameSymbol, otherChain])).toHaveLength(4);
    expect(isCatalogToken(rankTokenResults([], [sameSymbol])[0])).toBe(false);
  });
  it("keeps catalog metadata/logo and adds only matching market observations", () => {
    const remote = { ...usdc, name: "Provider name", logoURI: "https://example.com/logo.svg", marketSource: "coingecko" as const, marketCapUSD: 10, volumeUSD24H: 20, riskAcknowledged: true };
    const [merged] = rankTokenResults([usdc], [remote]);
    expect(merged).toMatchObject({ ...usdc, marketCapUSD: 10, volumeUSD24H: 20 });
    expect(merged).not.toHaveProperty("riskAcknowledged");
    expect(usdc).not.toHaveProperty("marketCapUSD");
    expect(getCatalogToken(usdc.chainId, usdc.address)).not.toHaveProperty("marketCapUSD");
  });
  it("preserves an exact provider-name search match while showing the pinned catalog name", () => {
    const remote = { ...usdc, name: "USD Coin", marketCapUSD: 1 };
    const larger = { ...asset(9, 1e9), name: "USD Coin Variant" };
    const ranked = rankTokenResults([usdc], [larger, remote], [], "usd coin");
    expect(ranked[0]).toMatchObject({ address: usdc.address, name: usdc.name });
  });
  it.each([{ decimals: 18 }])("refuses metrics from altered catalog decimals %j but retains its flag", alteration => {
    const [merged] = rankTokenResults([usdc], [{ ...usdc, ...alteration, marketSource: "coingecko", marketCapUSD: 1e9, volumeUSD24H: 1e8, verificationStatus: "flagged" }]);
    expect(merged).toMatchObject({ address: usdc.address, decimals: usdc.decimals, symbol: usdc.symbol, logoURI: usdc.logoURI, verificationStatus: "flagged" });
    expect(merged).not.toHaveProperty("marketCapUSD");
    expect(merged).not.toHaveProperty("volumeUSD24H");
  });
  it("ranks an exact contract despite a provider symbol alias while preserving local metadata", () => {
    const ranked = rankTokenResults([usdc], [{ ...usdc, symbol: "USDc", marketSource: "coinmarketcap", marketCapUSD: 100 }]);
    expect(ranked[0]).toMatchObject({ symbol: usdc.symbol, marketCapUSD: 100, marketSource: "coinmarketcap" });
  });
  it("does not infer catalog exemption from a symbol or import provider consent", () => {
    const impostor = { ...asset(9, 100), symbol: "USDC", riskAcknowledged: true };
    const [merged] = rankTokenResults([], [impostor]);
    expect(isCatalogToken(merged)).toBe(false);
    expect(requiresTokenConfirmation(merged)).toBe(true);
    expect(merged).not.toHaveProperty("riskAcknowledged");
  });
  it("keeps a flag from any duplicate/source/breakdown without losing valid metrics", () => {
    const positive = { ...asset(1, 100), verificationStatus: "verified" as const };
    const negative = { ...asset(1), address: positive.address.toUpperCase(), verificationStatusBreakdown: [{ provider: "screen", result: "flagged" as const }] };
    for (const sources of [[positive, negative], [negative, positive]]) {
      const [merged] = rankTokenResults([], [sources[0]], [sources[1]]);
      expect(tokenVerification(merged)).toBe("flagged");
      expect(merged.marketCapUSD).toBe(100);
      const [deduplicated] = uniqueTokens(sources);
      expect(tokenVerification(deduplicated)).toBe("flagged");
      expect(deduplicated.marketCapUSD).toBe(100);
    }
  });
  it("does not invent capitalization from volume, price or the catalog on any app network", () => {
    expect(POPULAR_TOKEN_LIMIT).toBe(100);
    for (const chain of APP_CHAINS) {
      const ranked = rankTokenResults(getPopularTokens(chain.id), []);
      expect(ranked.every(token => token.marketCapUSD === undefined)).toBe(true);
      expect(ranked.map(token => token.address)).toEqual(getPopularTokens(chain.id).map(token => token.address));
    }
    expect(sortTokenResults([{ ...asset(1), volumeUSD24H: 1e20, priceUSD: "1000000" }, asset(2, 0)])[0].symbol).toBe("ASSET2");
  });
});

it("never ranks by a LI.FI capitalization without independent market provenance", () => {
  const unknown = { ...asset(1, 1e20), marketSource: undefined };
  expect(sortTokenResults([unknown, asset(2, 1)])[0].symbol).toBe("ASSET2");
  expect(rankTokenResults([], [unknown])[0]).not.toHaveProperty("marketCapUSD");
});

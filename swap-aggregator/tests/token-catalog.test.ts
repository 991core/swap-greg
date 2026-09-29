import { describe, expect, it } from "vitest";
import { APP_CHAINS } from "../lib/chains";
import { getCatalogToken, getPopularTokens, isCatalogToken } from "../lib/tokens/catalog";
import { requiresTokenConfirmation, tokenKey, validateToken } from "../lib/tokens/validation";

describe("local token catalog", () => {
  it("pins valid, unique identities and decimals on every configured chain", () => {
    const all = APP_CHAINS.flatMap((chain) => {
      const tokens = getPopularTokens(chain.id);
      expect(tokens[0]).toMatchObject({ chainId: chain.id, ...chain.nativeCurrency });
      return tokens;
    });
    expect(new Set(all.map(tokenKey)).size).toBe(all.length);
    for (const token of all) {
      expect(validateToken(token, token.chainId)).not.toBeNull();
      expect(requiresTokenConfirmation(token)).toBe(false);
    }
  });
  it("never trusts a token by symbol, by an upstream flag or on the wrong chain", () => {
    const usdc = getPopularTokens(8453).find((token) => token.symbol === "USDC")!;
    for (const token of [
      { ...usdc, chainId: 1 }, { ...usdc, address: "0x2222222222222222222222222222222222222222" },
      { ...usdc, decimals: 18 }, { ...usdc, symbol: "FAKE" },
    ]) {
      expect(isCatalogToken({ ...token, isTrusted: true } as typeof token)).toBe(false);
      expect(requiresTokenConfirmation(token)).toBe(true);
    }
  });
  it("does not let a caller mutate future catalog lookups", () => {
    const usdc = getPopularTokens(8453).find((token) => token.symbol === "USDC")!;
    usdc.decimals = 18;
    expect(getCatalogToken(usdc.chainId, usdc.address)?.decimals).toBe(6);
    expect(getPopularTokens(999)).toEqual([]);
  });
});

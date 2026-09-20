import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/tokens/client", () => ({ getTokenDetails: vi.fn() }));
import { getTokenDetails } from "../lib/tokens/client";
import { looksLikeAddress, resolveTokenByAddress } from "../lib/contractTokenResolver";
import { fetchTokenPriceUsd, formatCurrencyValue, fetchUsdEurRate } from "../lib/pricing";
import { fromToken } from "./fixtures";
beforeEach(() => { vi.clearAllMocks(); });
describe("asset identity", () => {
  it("accepts mixed-case EVM addresses and excludes unsupported address formats", () => {
    expect(looksLikeAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(true);
    expect(looksLikeAddress("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf")).toBe(false);
  });
  it("uses LI.FI metadata from the server without guessing 18 decimals", async () => {
    const address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    vi.mocked(getTokenDetails).mockResolvedValue({ ...fromToken, address, decimals: 6, symbol: "USDC" });
    expect(await resolveTokenByAddress(8453, address)).toMatchObject({ decimals: 6, chainId: 8453, symbol: "USDC" });
    expect(getTokenDetails).toHaveBeenCalledWith(8453, address);
  });
  it("does not fall back to RPC when LI.FI metadata is unavailable", async () => {
    vi.mocked(getTokenDetails).mockRejectedValue(new Error("no metadata"));
    expect(await resolveTokenByAddress(1, "0x2222222222222222222222222222222222222222")).toBeNull();
  });
  it.each([[56, "BNB", "500"], [137, "POL", "0.2"], [43114, "AVAX", "25"]])("prices native assets using their chain (%s)", async (chainId, symbol, priceUSD) => {
    const token = { ...fromToken, chainId: Number(chainId), symbol: String(symbol) };
    vi.mocked(getTokenDetails).mockResolvedValue({ ...token, priceUSD: String(priceUSD) });
    expect(await fetchTokenPriceUsd(token)).toBe(Number(priceUSD));
    expect(getTokenDetails).toHaveBeenCalledWith(chainId, token.address);
  });
  it("does not manufacture an EUR rate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchUsdEurRate()).toBeNull();
    expect(formatCurrencyValue(100, "EUR")).toBeNull();
    expect(formatCurrencyValue(100, "EUR", 0.85, "en-US")).toBe("€85.00");
  });
});

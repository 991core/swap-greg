import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@lifi/sdk", () => ({ getToken: vi.fn() }));
vi.mock("../lib/aggregators/lifi/client", () => ({ getLifiSdkClient: () => ({}) }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(), createPublicClient: vi.fn() }));
import { getToken } from "@lifi/sdk";
import { createPublicClient } from "viem";
import { looksLikeAddress, resolveTokenByAddress } from "../lib/contractTokenResolver";
import { fetchTokenPriceUsd, formatCurrencyValue, fetchUsdEurRate } from "../lib/pricing";
import { fromToken } from "./fixtures";
beforeEach(() => { vi.clearAllMocks(); });
describe("asset identity", () => {
  it("accepts mixed-case EVM addresses and excludes unsupported address formats", () => {
    expect(looksLikeAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(true);
    expect(looksLikeAddress("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf")).toBe(false);
  });
  it("resolves Base metadata on-chain without guessing 18 decimals", async () => {
    vi.mocked(getToken).mockRejectedValue(new Error("metadata unavailable"));
    const read = vi.fn().mockResolvedValueOnce(6).mockResolvedValueOnce("USDC").mockResolvedValueOnce("USD Coin");
    vi.mocked(createPublicClient).mockReturnValue({ readContract: read } as never);
    const address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    expect(await resolveTokenByAddress(8453, address)).toMatchObject({ decimals: 6, chainId: 8453, symbol: "USDC" });
    expect(createPublicClient).toHaveBeenCalledWith(expect.objectContaining({ chain: expect.objectContaining({ id: 8453 }) }));
  });
  it("does not invent metadata when all readers fail", async () => {
    vi.mocked(getToken).mockRejectedValue(new Error("no metadata"));
    vi.mocked(createPublicClient).mockReturnValue({ readContract: vi.fn().mockRejectedValue(new Error("no contract")) } as never);
    expect(await resolveTokenByAddress(1, "0x2222222222222222222222222222222222222222")).toBeNull();
  });
  it.each([[56, "BNB", "500"], [137, "POL", "0.2"], [43114, "AVAX", "25"]])("prices native assets using their chain (%s)", async (chainId, symbol, priceUSD) => {
    const token = { ...fromToken, chainId: Number(chainId), symbol: String(symbol) };
    vi.mocked(getToken).mockResolvedValue({ ...token, priceUSD: String(priceUSD) } as never);
    expect(await fetchTokenPriceUsd(token)).toBe(Number(priceUSD));
    expect(getToken).toHaveBeenCalledWith(expect.anything(), chainId, token.address, expect.anything());
  });
  it("does not manufacture an EUR rate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchUsdEurRate()).toBeNull();
    expect(formatCurrencyValue(100, "EUR")).toBeNull();
    expect(formatCurrencyValue(100, "EUR", 0.85, "en-US")).toBe("€85.00");
  });
});

import { expect, it, vi } from "vitest";
vi.mock("../lib/wallet", () => ({ walletConfig: { id: "test-wallet" } }));
vi.mock("wagmi/actions", () => ({ getWalletClient: vi.fn(), switchChain: vi.fn() }));
import { getWalletClient, switchChain } from "wagmi/actions";
import { isEthereumProvider } from "@lifi/sdk-provider-ethereum";
import { getLifiSdkClient } from "../lib/aggregators/lifi/client";
import { wallet } from "./fixtures";
it("registers an EVM quote provider that cannot access or switch the signing wallet", async () => {
  const provider = getLifiSdkClient().providers.find((p) => p.isAddress(wallet));
  expect(provider && isEthereumProvider(provider)).toBe(true);
  if (!provider || !isEthereumProvider(provider)) throw new Error("EVM provider missing");
  await expect(provider.options.getWalletClient?.()).rejects.toThrow("authorizer");
  await expect(provider.options.switchChain?.(8453)).rejects.toThrow("authorizer");
  expect(getWalletClient).not.toHaveBeenCalled(); expect(switchChain).not.toHaveBeenCalled();
  await expect(provider.options.switchChain?.(728126428)).rejects.toThrow("Unsupported network");
});

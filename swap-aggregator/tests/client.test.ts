import { expect, it, vi } from "vitest";
vi.mock("../lib/wallet", () => ({ walletConfig: { id: "test-wallet" } }));
vi.mock("wagmi/actions", () => ({ getWalletClient: vi.fn(), switchChain: vi.fn() }));
import { getWalletClient, switchChain } from "wagmi/actions";
import { isEthereumProvider } from "@lifi/sdk-provider-ethereum";
import { getLifiSdkClient } from "../lib/aggregators/lifi/client";
import { wallet } from "./fixtures";
it("registers an EVM provider that reads the live wallet after switching chains", async () => {
  const provider = getLifiSdkClient().providers.find((p) => p.isAddress(wallet));
  expect(provider && isEthereumProvider(provider)).toBe(true);
  if (!provider || !isEthereumProvider(provider)) throw new Error("EVM provider missing");
  vi.mocked(getWalletClient).mockResolvedValue({ chain: { id: 8453 } } as never);
  vi.mocked(switchChain).mockResolvedValue({ id: 8453 } as never);
  const client = await provider.options.switchChain?.(8453);
  expect(client?.chain?.id).toBe(8453);
  expect(getWalletClient).toHaveBeenCalledWith(expect.anything(), { chainId: 8453 });
  await expect(provider.options.switchChain?.(728126428)).rejects.toThrow("Unsupported network");
});

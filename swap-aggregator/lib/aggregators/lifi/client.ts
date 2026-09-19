import { createClient } from "@lifi/sdk";
import { EthereumProvider } from "@lifi/sdk-provider-ethereum";
import { getWalletClient, switchChain } from "wagmi/actions";
import { walletConfig } from "../../wallet";
import { isAppChainId } from "../../chains";

export const lifiClient = createClient({
  integrator: "hermes-hms",
  apiKey: process.env.NEXT_PUBLIC_LIFI_API_KEY || undefined,
  preloadChains: false,
  providers: [EthereumProvider({
    getWalletClient: async () => {
      const client = await getWalletClient(walletConfig);
      if (!client) throw new Error("Connect a wallet before executing a swap.");
      return client;
    },
    switchChain: async (chainId) => {
      if (!isAppChainId(chainId)) throw new Error("Unsupported network.");
      const chain = await switchChain(walletConfig, { chainId });
      const client = await getWalletClient(walletConfig, { chainId: chain.id });
      if (!client) throw new Error("The wallet did not return a client for the selected network.");
      return client;
    },
  })],
});

export function getLifiSdkClient() { return lifiClient; }

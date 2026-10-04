import { createClient } from "@lifi/sdk";
import { EthereumProvider } from "@lifi/sdk-provider-ethereum";
import { getWalletClient, switchChain } from "wagmi/actions";
import { walletConfig } from "../../wallet";
import { isAppChainId } from "../../chains";
import { createGuardedLifiWallet, type LifiWalletSecurity } from "../../security/lifi-wallet";

export const lifiClient = createClient({
  integrator: "hermes-hms",
  preloadChains: false,
  providers: [EthereumProvider({
    disableMessageSigning: true,
    getWalletClient: async () => {
      throw new Error("A transaction authorizer is required before using the wallet.");
    },
    switchChain: async (chainId) => {
      if (!isAppChainId(chainId)) throw new Error("Unsupported network.");
      throw new Error("A transaction authorizer is required before switching the wallet.");
    },
  })],
});

export function getLifiSdkClient() { return lifiClient; }

/** Quotes share a client; every execution gets its own immutable authorization scope. */
export function getLifiExecutionClient(security: LifiWalletSecurity) {
  if (!security || typeof security.authorizeTransaction !== "function" || typeof security.check !== "function") {
    throw new Error("A transaction authorizer is required before using the wallet.");
  }
  const readGuardedWallet = async () => {
    security.check();
    const client = await getWalletClient(walletConfig, { chainId: security.chainId });
    security.check();
    if (!client) throw new Error("Connect a wallet before executing a swap.");
    return createGuardedLifiWallet(client, security);
  };
  return createClient({ integrator: "hermes-hms", preloadChains: false, providers: [EthereumProvider({
    disableMessageSigning: true,
    getWalletClient: readGuardedWallet,
    switchChain: async (chainId) => {
      if (!isAppChainId(chainId) || chainId !== security.chainId) throw new Error("Unsupported execution network.");
      security.check();
      await switchChain(walletConfig, { chainId });
      security.check();
      return readGuardedWallet();
    },
  })] });
}

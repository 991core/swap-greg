import { createConfig, http, type Transport } from "wagmi";
// Import the lightweight connector directly. The `wagmi/connectors` barrel
// also bundles optional Base/Coinbase x402 connectors that are not needed by
// this app and are not safe to resolve in a server build.
import { injected } from "@wagmi/core";
import { APP_CHAINS, type AppChainId } from "./chains";

// Keep the runtime configuration limited to the injected connector. RainbowKit
// can render its connect button with this config, while the package's optional
// Base/Coinbase connectors are kept out of the server bundle.
export const walletConfig = createConfig({
  chains: APP_CHAINS,
  connectors: [injected()],
  transports: Object.fromEntries(APP_CHAINS.map((chain) => [chain.id, http()])) as Record<AppChainId, Transport>,
  ssr: true,
});

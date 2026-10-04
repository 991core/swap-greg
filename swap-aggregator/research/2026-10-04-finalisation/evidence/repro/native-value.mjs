// Upstream is fully simulated. No actual wallet/signature/broadcast occurs.
import { createGuardedLifiWallet } from './lifi-wallet.mjs';
import { createWalletClient, custom } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/viem/_esm/index.js';
import { mainnet } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/viem/_esm/chains/index.js';
const account = '0x1111111111111111111111111111111111111111'; let forwardedRequests = 0;
const original = createWalletClient({ account, chain: mainnet, transport: custom({ request: async ({ method }) => {
  const values = { eth_accounts: [account], eth_chainId: '0x1', eth_getBalance: '0xc350', eth_estimateGas: '0x5208', eth_gasPrice: '0x1' };
  if (method === 'eth_sendTransaction') { forwardedRequests++; return '0x' + 'ab'.repeat(32); }
  if (method in values) return values[method]; throw Error(method);
} }, { retryCount: 0 }) });
const guard = createGuardedLifiWallet(original, { account, chainId: 1, protocol: 'bridge',
  fromTokenAddress: '0x0000000000000000000000000000000000000000', fromAmount: '100', quotedNativeGasReserve: '21000', check: () => {} });
await guard.request({ method: 'eth_sendTransaction', params: [{ from: account, to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: '0x5f5e100' }] });
console.log(JSON.stringify({ selectedPrincipal: '100', candidateValue: '100000000', nativeBalance: '50000', gasWithPadding: '25200', forwardedRequests, actuallyAffordable: false }));

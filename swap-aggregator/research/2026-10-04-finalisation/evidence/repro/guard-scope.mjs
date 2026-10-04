// Actual transpiled Hermes guard + installed viem. Upstream is fully simulated.
import { createGuardedLifiWallet } from './lifi-wallet.mjs';
import { createWalletClient, custom } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/viem/_esm/index.js';
import { mainnet } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/viem/_esm/chains/index.js';
const account = '0x1111111111111111111111111111111111111111', router = '0x2222222222222222222222222222222222222222'; let broadcasts = 0;
const original = createWalletClient({ account, chain: mainnet, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_accounts') return [account]; if (method === 'eth_chainId') return '0x1';
  if (method === 'eth_getBalance') return '0xde0b6b3a7640000'; if (method === 'eth_estimateGas') return '0x5208'; if (method === 'eth_gasPrice') return '0x1';
  if (method === 'eth_sendTransaction') { broadcasts++; throw new Error('ambiguous broadcast'); } throw Error(method);
} }, { retryCount: 0 }) });
const scope = { account, chainId: 1, protocol: 'bridge', fromTokenAddress: '0x0000000000000000000000000000000000000000',
  fromAmount: '100', quotedNativeGasReserve: '21000', check: () => {} };
const request = { method: 'eth_sendTransaction', params: [{ from: account, to: router, data: '0xdeadbeef', value: '0x64' }] };
const first = createGuardedLifiWallet(original, scope);
for (const guard of [first, first, createGuardedLifiWallet(original, scope)]) try { await guard.request(request); } catch {}
console.log(JSON.stringify({ attempts: 3, actualBroadcastRequests: broadcasts, comment: 'same guard blocked second; fresh execution guard allowed third' }));

// All HTTP calls are replaced with a fixture. No network or wallet.
import { WaitForTransactionStatusTask } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/dist/esm/core/tasks/WaitForTransactionStatusTask.js';
import { StatusManager } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/dist/esm/core/StatusManager.js';
import { executionState } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/dist/esm/core/executionState.js';
for (const substatus of ['REFUNDED', 'PARTIAL']) {
  const step = { id: 'step', tool: 'bridge', action: { fromChainId: 1, toChainId: 8453 },
    execution: { status: 'PENDING', actions: [{ type: 'CROSS_CHAIN', status: 'DONE', txHash: '0x' + 'ab'.repeat(32) }] } };
  const route = { id: 'audit-' + substatus, steps: [step] }; executionState.create({ route });
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'DONE', substatus,
    receiving: { chainId: 1, amount: '1', token: { chainId: 1, address: '0x1111111111111111111111111111111111111111' } }, sending: { amount: '1000' } }));
  await new WaitForTransactionStatusTask('RECEIVING_CHAIN').run({ client: { config: { integrator: 'audit', apiUrl: 'https://mock.invalid' } },
    step, statusManager: new StatusManager(route.id), toChain: { id: 8453, metamask: { blockExplorerUrls: ['https://mock.invalid/'] } }, isBridgeExecution: true });
  console.log(JSON.stringify({ substatus, executionStatus: step.execution.status,
    hermesSuccessCondition: route.steps.every(s => s.execution?.status === 'DONE'),
    receivedChain: step.execution.toToken.chainId, receivedAmount: step.execution.toAmount }));
  executionState.delete(route.id);
}

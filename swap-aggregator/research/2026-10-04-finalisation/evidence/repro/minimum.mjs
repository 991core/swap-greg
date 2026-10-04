// Local-only reproduction against the installed SDK; no fetch or wallet.
import { stepComparison } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/dist/esm/core/tasks/helpers/stepComparison.js';
import { StatusManager } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/dist/esm/core/StatusManager.js';
import { executionState } from '/home/pierre/Downloads/swap-aggregator/swap-aggregator/node_modules/@lifi/sdk/dist/esm/core/executionState.js';
const step = { id: 'step', action: { slippage: 0.005 }, estimate: { toAmountMin: '1000000', toAmount: '1005025' } };
const route = { id: 'audit-pure', toAmountMin: '1000000', steps: [step] }; let hooks = 0;
executionState.create({ route });
await stepComparison(new StatusManager(route.id), step,
  { ...step, estimate: { ...step.estimate, toAmountMin: '995001' } }, true,
  { acceptExchangeRateUpdateHook: async () => { hooks++; return false; } });
console.log(JSON.stringify({ routeMinimum: route.toAmountMin, singleStepMinimum: route.steps[0].estimate.toAmountMin, hooks }));
executionState.delete(route.id);

import type { ExecutionOptions, Route, RouteExtended } from "@lifi/sdk";
import { normalizedSecurityAddress, securityUint } from "../../security/quote-validator";

const native = (address: string) => /^0x0{40}$/i.test(address);
const fail = (reason: string): never => { throw new Error(`LI.FI execution blocked: ${reason}`); };
const sameToken = (left: Route["fromToken"], right: Route["fromToken"]) => left?.chainId === right?.chainId &&
  normalizedSecurityAddress(left?.address) !== null && normalizedSecurityAddress(left.address) === normalizedSecurityAddress(right?.address) && left.decimals === right?.decimals;

/** Capability boundary, not a contract/token allowlist. Included steps execute
 * inside the provider transaction; multiple top-level steps need extra wallets. */
export function assertLifiExecutionCapability(route: Route): void {
  if (route.steps.length !== 1) fail("multiple_wallet_steps_unsupported");
  const step = route.steps[0];
  if (step.action.fromChainId !== route.fromChainId || step.action.toChainId !== route.toChainId ||
      !sameToken(step.action.fromToken, route.fromToken) || !sameToken(step.action.toToken, route.toToken) ||
      step.action.fromAmount !== route.fromAmount || normalizedSecurityAddress(step.action.fromAddress) !== normalizedSecurityAddress(route.fromAddress) ||
      normalizedSecurityAddress(step.action.toAddress) !== normalizedSecurityAddress(route.toAddress)) fail("step_identity_changed");
  if (step.typedData?.length || (step.type as string) === "custom" || step.includedSteps?.some(s => s.type === "custom")) fail("unsupported_wallet_capability");
}

function fees(route: Route): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const fee of route.steps.flatMap(step => step.estimate.feeCosts ?? [])) {
    const amount = securityUint(fee.amount, true);
    const address = normalizedSecurityAddress(fee.token?.address);
    if (amount === null || !address || !Number.isSafeInteger(fee.token.chainId) || !Number.isSafeInteger(fee.token.decimals) || typeof fee.included !== "boolean") return fail("invalid_quoted_fee");
    const key = `${fee.token.chainId}:${address}:${fee.token.decimals}:${fee.included}`;
    result.set(key, (result.get(key) ?? BigInt(0)) + amount);
  }
  return result;
}

export function lifiNativeSpendBudget(route: Route): string {
  const principal = securityUint(route.fromAmount);
  if (principal === null) return fail("invalid_principal");
  fees(route); // malformed fees never silently become zero
  let budget = native(route.fromToken.address) ? principal : BigInt(0);
  for (const fee of route.steps.flatMap(step => step.estimate.feeCosts ?? [])) {
    if (!fee.included && fee.token.chainId === route.fromChainId && native(fee.token.address)) budget += BigInt(fee.amount);
  }
  return budget.toString();
}

/** Uses the SDK's official route and prepared-transaction hooks. The SDK may
 * tolerate a lower step minimum without calling acceptExchangeRateUpdateHook;
 * compare its actual rebuilt step with a separate immutable consent snapshot. */
export function createLifiExecutionPolicy(selected: Route, options: ExecutionOptions = {}, check: () => void) {
  const consent = structuredClone(selected);
  assertLifiExecutionCapability(consent);
  const minimum = securityUint(consent.toAmountMin);
  if (minimum === null) return fail("invalid_selected_minimum");
  const selectedFees = fees(consent);
  let latest: Route | RouteExtended = consent;
  let prepared: { to?: string; data?: string; value?: bigint; chainId?: number; from?: string } | undefined;
  const validate = () => {
    check();
    assertLifiExecutionCapability(latest);
    if (latest.id !== consent.id || latest.fromChainId !== consent.fromChainId || latest.toChainId !== consent.toChainId ||
        latest.fromAmount !== consent.fromAmount || !sameToken(latest.fromToken, consent.fromToken) || !sameToken(latest.toToken, consent.toToken) ||
        normalizedSecurityAddress(latest.fromAddress) !== normalizedSecurityAddress(consent.fromAddress) || normalizedSecurityAddress(latest.toAddress) !== normalizedSecurityAddress(consent.toAddress) ||
        latest.steps[0].id !== consent.steps[0].id || latest.steps[0].tool !== consent.steps[0].tool) fail("selected_identity_changed");
    const rebuiltMinimum = securityUint(latest.steps[0].estimate.toAmountMin);
    const routeMinimum = securityUint(latest.toAmountMin);
    if (rebuiltMinimum === null || routeMinimum === null || rebuiltMinimum < minimum || routeMinimum < minimum) fail("minimum_below_consent");
    for (const [key, amount] of fees(latest)) if (amount > (selectedFees.get(key) ?? BigInt(0))) fail("fees_above_consent");
  };
  return {
    maxNativeValue: lifiNativeSpendBudget(consent),
    check: validate,
    checkTransaction(candidate: { to: string; data: string; value: string }) {
      validate();
      if (!prepared || normalizedSecurityAddress(prepared.to) !== normalizedSecurityAddress(candidate.to) || prepared.data !== candidate.data ||
          (prepared.value ?? BigInt(0)) !== BigInt(candidate.value)) fail("transaction_not_bound_to_rebuilt_step");
    },
    options: {
      ...options,
      acceptExchangeRateUpdateHook: async () => false,
      updateRouteHook(route: RouteExtended) {
        latest = structuredClone(route);
        // Receiving status updates may occur after the quote deadline. They do
        // not sign. The guarded transport validates immediately before signing.
        options.updateRouteHook?.(route);
      },
      async updateTransactionRequestHook(request) {
        validate();
        // Caller hooks cannot replace provider transactions at this boundary.
        // The public hook is reserved to retain the exact prepared request.
        if (request.requestType === "transaction") prepared = { ...request };
        return request;
      },
    } satisfies ExecutionOptions,
  };
}

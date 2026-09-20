import type { NormalizedRoute } from "../types/normalized-route";
import { rangoToken } from "../aggregators/rango/validation";

export function routeTokens(route: NormalizedRoute) {
  return route.provider === "lifi" ? { fromToken: route.raw.fromToken, toToken: route.raw.toToken } :
    { fromToken: rangoToken(route.raw.quote.route.from), toToken: rangoToken(route.raw.quote.route.to) };
}
export function routeFees(route: NormalizedRoute) {
  return route.provider === "lifi" ? route.raw.steps.flatMap((step) => step.estimate.feeCosts ?? []) :
    route.raw.quote.route.fee.filter((fee) => fee.expenseType !== "FROM_SOURCE_WALLET").map((fee) => ({
      name: fee.name, amount: fee.amount, token: rangoToken(fee.token), included: fee.expenseType === "DECREASE_FROM_OUTPUT",
    }));
}

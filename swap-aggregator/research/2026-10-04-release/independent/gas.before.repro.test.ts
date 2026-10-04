import { expect, it } from "vitest";
import { quote, params } from "../../../tests/fixtures";
import { canExecuteQuote, sourceGasAmount } from "../../../lib/routing/quote";
it("reproduces selected malformed gas-token metadata passing eligibility but crashing reserve rendering", () => {
  const route = quote();
  route.raw.steps[0].estimate.gasCosts = [{ amount: "1", token: null }] as never;
  expect(canExecuteQuote(route, params)).toBe(true);
  expect(() => sourceGasAmount(route)).toThrow();
});

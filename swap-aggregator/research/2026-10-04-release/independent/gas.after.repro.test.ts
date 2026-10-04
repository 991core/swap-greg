import { expect, it } from "vitest";
import { quote, params } from "../../../tests/fixtures";
import { canExecuteQuote, sourceGasAmount } from "../../../lib/routing/quote";
it("refuses eligibility for malformed gas-token metadata and leaves reserve rendering safe", () => {
  const route = quote();
  route.raw.steps[0].estimate.gasCosts = [{ amount: "1", token: null }] as never;
  expect(canExecuteQuote(route, params)).toBe(false);
  expect(() => sourceGasAmount(route)).not.toThrow();
});

import { describe, expect, it } from "vitest";
import { balancePercentage, formatTokenAmount, parseTokenAmount } from "../lib/amounts";
describe("monetary amounts", () => {
  it.each([["1.5", "1500000"], ["1,5", "1500000"], ["0,01", "10000"], [".01", "10000"], [" 0001.50 ", "1500000"], ["0", "0"]])("parses %s without changing the intended value", (input, expected) => expect(parseTokenAmount(input, 6)).toBe(expected));
  it.each(["Infinity", "1e3", "+1", "-1", "0x12", "1,000.50", "1.000,50", "1 000", "1,2,3", "", ".", "1.0000001"])("rejects invalid or ambiguous input %s", (input) => expect(parseTokenAmount(input, 6)).toBeNull());
  it("preserves amounts above the Number precision limit", () => expect(parseTokenAmount("9007199254740993.000001", 6)).toBe("9007199254740993000001"));
  it("supports zero-decimal assets", () => { expect(parseTokenAmount("123", 0)).toBe("123"); expect(formatTokenAmount("123", 0)).toBe("123"); });
  it("never rounds a quick amount above the balance", () => {
    const balance = BigInt("999999999999999999999");
    expect(parseTokenAmount(balancePercentage(balance, 100, 18), 18)).toBe(balance.toString());
    expect(parseTokenAmount(balancePercentage(balance, 25, 18), 18)).toBe((balance / BigInt(4)).toString());
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import { logQuoteFailure } from "../lib/routing/diagnostics";
const context = { event: "provider_failed" as const, provider: "oneclick" as const, fromChainId: 137, toChainId: 100 };
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
it("logs a safe cause and status without dumping upstream messages or context payloads", () => {
  logQuoteFailure(Object.assign(new Error("secret URL https://example.test?apiKey=PRIVATE and wallet 0x1111111111111111111111111111111111111111"), { status: 429 }), context);
  expect(console.warn).toHaveBeenCalledWith("[Hermes quotes]", { ...context, reason: "http_error", status: 429 });
  const serialized = JSON.stringify(vi.mocked(console.warn).mock.calls);
  expect(serialized).not.toMatch(/PRIVATE|https:|0x111/);
});
it("distinguishes unsupported pairs from other provider errors", () => {
  logQuoteFailure(Object.assign(new Error("Pair not supported by 1Click"), { status: 400 }), context);
  expect(console.warn).toHaveBeenCalledWith("[Hermes quotes]", { ...context, reason: "unsupported_pair", status: 400 });
});
it("extracts nested HTTP status and ignores unsafe status values", () => {
  logQuoteFailure({ cause: { status: 502 } }, context);
  expect(console.warn).toHaveBeenLastCalledWith("[Hermes quotes]", { ...context, reason: "http_error", status: 502 });
  logQuoteFailure({ status: "SECRET", name: "SECRET" }, context);
  expect(console.warn).toHaveBeenLastCalledWith("[Hermes quotes]", { ...context, reason: "provider_error" });
});

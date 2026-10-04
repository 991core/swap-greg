import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../lib/aggregators/lifi/routes", () => ({ fetchRoutes: vi.fn() }));
import { fetchRoutes } from "../../../lib/aggregators/lifi/routes";
import { getRoutesForSelection } from "../../../lib/routing/orchestrator";
import { params } from "../../../tests/fixtures";
beforeEach(() => { vi.clearAllMocks(); });
it("preserves a real Rango HTTP configuration category through client and orchestrator without raw errors", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: "sensitive fake message" }, { status: 503, headers: { "X-Hermes-Error-Code": "provider_configuration" } }));
  vi.stubGlobal("fetch", fetcher);
  const warn = vi.fn();
  await expect(getRoutesForSelection({ ...params, providers: { lifi: false, rango: true, oneclick: false, socket: false } }, undefined, warn)).rejects.toMatchObject({ failure: "configuration" });
  expect(warn).toHaveBeenCalledWith({ provider: "rango", message: "configuration" });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("preserves all-provider quotas as a structured public quota failure", async () => {
  vi.mocked(fetchRoutes).mockRejectedValue(Object.assign(new Error("private upstream URL"), { status: 429 }));
  await expect(getRoutesForSelection({ ...params, providers: { lifi: true, rango: false, oneclick: false, socket: false } })).rejects.toMatchObject({ failure: "quota" });
});

import { ROUTE_TIMEOUT_MS } from "../../routing/config";

export async function rangoRequest<T>(operation: "quote" | "swap" | "status", body: object, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, ROUTE_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/rango/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 429 ? "Rango: rate limit reached. Please try again shortly." : "Rango is unavailable. Please try again.");
    return await response.json() as T;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

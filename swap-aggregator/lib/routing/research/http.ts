export interface HttpEvidence {
  url: string;
  method: string;
  request: unknown;
  startedAt: number;
  finishedAt: number;
  status: number | null;
  response?: unknown;
  error?: string;
}

export type JsonHttp = (url: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;

/** Only fixed public read/quote endpoints are used by the supplied adapters. */
export function createJsonHttp(record: (evidence: HttpEvidence) => void = () => {}, fetcher = fetch): JsonHttp {
  return async (url, body, headers = {}, signal) => {
    const evidence: HttpEvidence = { url, method: body === undefined ? "GET" : "POST", request: body ?? null, startedAt: Date.now(), finishedAt: 0, status: null };
    try {
      const response = await fetcher(url, {
        method: evidence.method,
        headers: { accept: "application/json", "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ?? AbortSignal.timeout(12000),
        redirect: "error",
      });
      evidence.status = response.status;
      const text = await response.text();
      if (text.length > 8_000_000) throw new Error("Provider response exceeds the research size limit");
      try { evidence.response = JSON.parse(text); }
      catch { evidence.response = text.slice(0, 500); throw new Error(`HTTP ${response.status}: non-JSON response`); }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return evidence.response;
    } catch (error) {
      // Never record request headers, credentials or error bodies in exceptions.
      evidence.error = error instanceof Error ? error.message : "Request failed";
      throw error;
    } finally {
      evidence.finishedAt = Date.now();
      record(evidence);
    }
  };
}

/** Offline replay has no network fallback. Repeated identical requests are FIFO. */
export function createReplayHttp(evidence: HttpEvidence[], clock: { now: number }): JsonHttp {
  const queues = new Map<string, HttpEvidence[]>();
  const key = (url: string, body: unknown) => JSON.stringify([url, body ?? null]);
  for (const item of evidence) {
    const id = key(item.url, item.request);
    queues.set(id, [...(queues.get(id) ?? []), item]);
  }
  return async (url, body) => {
    const item = queues.get(key(url, body))?.shift();
    if (!item) throw new Error(`No recorded response for ${url}`);
    clock.now = Math.max(clock.now, item.finishedAt);
    if (item.error) throw new Error(item.error);
    return structuredClone(item.response);
  };
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array");
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string field");
  return value;
}

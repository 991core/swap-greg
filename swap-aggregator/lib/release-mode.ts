export type ReleaseMode = "quotes" | "enabled" | "incident";

// Next embeds this public value in the browser bundle at build time. A missing
// or unrecognised value fails closed for every execution entry point.
const configured = process.env.NEXT_PUBLIC_RELEASE_MODE;
export const RELEASE_MODE: ReleaseMode = configured === "enabled" || configured === "incident" ? configured : "quotes";
export const canExecuteNewSwap = (): boolean => RELEASE_MODE === "enabled";

/** Recheck the server incident switch after asynchronous preparation. */
export async function assertExecutionEnabled(): Promise<void> {
  if (!canExecuteNewSwap()) throw new Error("execution_disabled");
  const response = await fetch("/api/release", { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("execution_disabled");
  const policy: unknown = await response.json();
  if (!policy || typeof policy !== "object" || (policy as { executionEnabled?: unknown }).executionEnabled !== true) throw new Error("execution_disabled");
}

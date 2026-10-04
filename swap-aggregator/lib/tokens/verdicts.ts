import { isAppChainId } from "../chains";
import type { AppToken } from "./types";
import { looksLikeAddress, tokenKey, tokenVerification } from "./validation";

// A negative observation is monotone for this browser session. Neither a new
// search, a catalogue copy nor a different provider can clear it.
const flagged = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;

export function rememberTokenVerdicts(tokens: readonly AppToken[]) {
  let changed = false;
  for (const token of tokens) {
    if (!isAppChainId(token.chainId) || !looksLikeAddress(token.address) || tokenVerification(token) !== "flagged") continue;
    const key = tokenKey(token);
    if (!flagged.has(key)) { flagged.add(key); changed = true; }
  }
  if (changed) { revision++; listeners.forEach((listener) => listener()); }
}

export function isObservedTokenFlagged(token: Pick<AppToken, "chainId" | "address"> | null) {
  return token !== null && flagged.has(tokenKey(token));
}

export function withObservedVerdict(token: AppToken): AppToken {
  return isObservedTokenFlagged(token) ? { ...token, verificationStatus: "flagged" } : token;
}

export function subscribeTokenVerdicts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const tokenVerdictsSnapshot = () => revision;
export const serverTokenVerdictsSnapshot = () => 0;

/** Test isolation only; production has no operation that clears observed flags. */
export function resetTokenVerdictsForTests() {
  if (process.env.NODE_ENV !== "test") throw new Error("Token verdicts cannot be cleared in production.");
  flagged.clear(); revision = 0;
}

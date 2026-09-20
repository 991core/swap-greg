import { getAddress } from "viem";
import { APP_CHAINS, isAppChainId } from "../chains";
import { SEARCH_LIMITS, TokenSearchError, type AppToken } from "./types";
import { isCatalogToken, NATIVE_ADDRESS } from "./catalog";

export { NATIVE_ADDRESS } from "./catalog";
const unsafeText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
export function looksLikeAddress(value: string): boolean { return /^0x[0-9a-f]{40}$/i.test(value.trim()); }
export function tokenKey(token: { chainId: number; address: string }): string { return `${token.chainId}:${token.address.toLowerCase()}`; }

export function tokenVerification(token: Pick<AppToken, "verificationStatus" | "verificationStatusBreakdown">) {
  if (token.verificationStatus === "flagged" || token.verificationStatusBreakdown?.some((item) => item.result === "flagged")) return "flagged";
  if (token.verificationStatusBreakdown?.some((item) => item.result === "unverified")) return "unverified";
  return token.verificationStatus === "verified" ? "verified" : "unverified";
}

export function isKnownNativeToken(token: AppToken): boolean {
  const chain = APP_CHAINS.find((item) => item.id === token.chainId);
  return Boolean(chain && token.address.toLowerCase() === NATIVE_ADDRESS && token.decimals === chain.nativeCurrency.decimals && token.symbol === chain.nativeCurrency.symbol);
}
export function requiresTokenConfirmation(token: AppToken): boolean {
  return tokenVerification(token) === "unverified" && !isCatalogToken(token);
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !unsafeText.test(value);
}

/** Validate untrusted metadata and copy only display/identity fields. */
export function validateToken(value: unknown, chainId: number, expectedAddress?: string): AppToken | null {
  if (!value || typeof value !== "object" || !isAppChainId(chainId)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.chainId !== chainId || typeof raw.address !== "string" || !looksLikeAddress(raw.address)) return null;
  const address = getAddress(raw.address.trim().toLowerCase());
  if (expectedAddress && address.toLowerCase() !== expectedAddress.trim().toLowerCase()) return null;
  if (typeof raw.decimals !== "number" || !Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 255) return null;
  if (!validText(raw.symbol, 64) || !validText(raw.name, 128)) return null;
  const native = address === NATIVE_ADDRESS ? APP_CHAINS.find((chain) => chain.id === chainId)?.nativeCurrency : undefined;
  if (native && raw.decimals !== native.decimals) return null;
  const breakdown = Array.isArray(raw.verificationStatusBreakdown) ? raw.verificationStatusBreakdown.filter((item) =>
    item && typeof item === "object" && ["flagged", "verified", "unverified"].includes(item.result),
  ) : [];
  const verificationStatus = tokenVerification({ verificationStatus: raw.verificationStatus as AppToken["verificationStatus"], verificationStatusBreakdown: breakdown });
  const token: AppToken = {
    chainId, address, decimals: raw.decimals,
    symbol: native?.symbol ?? raw.symbol.trim(), name: native?.name ?? raw.name.trim(),
    priceUSD: typeof raw.priceUSD === "string" && raw.priceUSD.trim() && Number.isFinite(Number(raw.priceUSD)) && Number(raw.priceUSD) >= 0 ? raw.priceUSD : "0",
    verificationStatus,
    verificationStatusBreakdown: breakdown.slice(0, 12).map((item) => ({
      provider: validText(item.provider, 80) ? item.provider : "LI.FI", result: item.result,
      ...(validText(item.reason, 240) ? { reason: item.reason } : {}),
    })),
  };
  if (typeof raw.logoURI === "string" && raw.logoURI.length <= 2048) {
    try {
      const url = new URL(raw.logoURI);
      if (url.protocol === "https:" && !url.username && !url.password) token.logoURI = url.href;
    } catch { /* Logos are optional. */ }
  }
  return token;
}

export function uniqueTokens(tokens: AppToken[]): AppToken[] {
  const byAddress = new Map<string, AppToken>();
  for (const token of tokens) {
    const previous = byAddress.get(tokenKey(token));
    // A duplicate's negative verdict must never be overwritten by a positive one.
    if (!previous || tokenVerification(token) === "flagged" || (tokenVerification(previous) === "verified" && tokenVerification(token) === "unverified")) byAddress.set(tokenKey(token), token);
  }
  return [...byAddress.values()];
}

export type TokenSearchInput = { chainId: number; query: string; limit: number; fresh: boolean };
export function parseTokenSearch(params: URLSearchParams): TokenSearchInput {
  const chain = params.get("chainId") ?? "";
  const query = (params.get("query") ?? "").trim().replace(/ +/g, " ");
  const limitText = params.get("limit") ?? String(SEARCH_LIMITS[0]);
  const limit = Number(limitText);
  const fresh = params.get("fresh") ?? "0";
  if (!/^\d+$/.test(chain) || !isAppChainId(Number(chain)) || !/^\d+$/.test(limitText) || !SEARCH_LIMITS.some((item) => item === limit) || query.length > 100 || unsafeText.test(query) || !["0", "1"].includes(fresh)) {
    throw new TokenSearchError("invalid_search", 400);
  }
  // "0x" and "0xBitcoin" are also token names. Reject incomplete hex contracts,
  // while leaving those names searchable.
  const addressLike = (query.length > 2 && /^0x[0-9a-f]+$/i.test(query)) || /^0x\S{40}$/i.test(query);
  if (addressLike && !looksLikeAddress(query)) throw new TokenSearchError("invalid_address", 400);
  if (fresh === "1" && !looksLikeAddress(query)) throw new TokenSearchError("invalid_search", 400);
  return { chainId: Number(chain), query: query.toLowerCase(), limit, fresh: fresh === "1" };
}

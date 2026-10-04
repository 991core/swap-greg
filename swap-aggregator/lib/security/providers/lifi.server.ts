import "server-only";
import { APP_CHAIN_IDS, isAppChainId } from "../../chains";
import type { AppToken } from "../../tokens/types";
import { validateToken, uniqueTokens, tokenVerification } from "../../tokens/validation";
import type { TokenSourceResult } from "../types";
import { requestSecurityProvider } from "./transport.server";
import { isRecord, normalizeAddress, safeText, SecurityProviderError } from "./types";
const nativeAddress = "0x0000000000000000000000000000000000000000";
export async function getLiFiDiscovery(chainIds: readonly number[] = APP_CHAIN_IDS, fresh = false): Promise<{ tokens: Record<number, AppToken[]>; coinKeys: Record<number, Record<string, string>> }> {
  if (!chainIds.length || chainIds.some(id => !isAppChainId(id)) || new Set(chainIds).size !== chainIds.length) throw new SecurityProviderError("lifi", "unsupported_chain", 400);
  const url = new URL("https://li.quest/v1/tokens"); url.search = new URLSearchParams({ chains: chainIds.join(","), chainTypes: "EVM", extended: "true", minPriceUSD: "0", limit: "100", orderBy: "volumeUSD24H" }).toString();
  const data = await requestSecurityProvider("lifi", url, { fresh });
  if (!isRecord(data) || !isRecord(data.tokens)) throw new SecurityProviderError("lifi", "invalid_response");
  const tokens: Record<number, AppToken[]> = {}; const coinKeys: Record<number, Record<string, string>> = {};
  for (const chainId of chainIds) {
    const rows = data.tokens[chainId]; if (!Array.isArray(rows) || rows.length > 200) throw new SecurityProviderError("lifi", "invalid_response");
    const decimals = new Map<string, number>(); const keys: Record<string, string> = {};
    const valid: AppToken[] = [];
    for (const row of rows) {
      const token = validateToken(row, chainId); if (!token || !isRecord(row)) throw new SecurityProviderError("lifi", "invalid_response");
      const address = token.address.toLowerCase(); if (decimals.has(address) && decimals.get(address) !== token.decimals) throw new SecurityProviderError("lifi", "ambiguous_deployment"); decimals.set(address, token.decimals);
      if (safeText(row.coinKey, 128)) { if (keys[address] && keys[address] !== row.coinKey) throw new SecurityProviderError("lifi", "ambiguous_asset"); keys[address] = row.coinKey; }
      valid.push(token);
    }
    tokens[chainId] = uniqueTokens(valid).slice(0, 100); coinKeys[chainId] = keys;
  }
  return { tokens, coinKeys };
}
export async function getLiFiTokenByAddress(chainId: number, address: string | null, fresh = false): Promise<AppToken> {
  if (!isAppChainId(chainId) || normalizeAddress(address) === undefined) throw new SecurityProviderError("lifi", "invalid_identity", 400);
  const url = new URL("https://li.quest/v1/token"); url.search = new URLSearchParams({ chain: String(chainId), token: address ?? nativeAddress }).toString();
  const data = await requestSecurityProvider("lifi", url, { fresh });
  const token = validateToken(data, chainId, address ?? nativeAddress);
  if (!token) throw new SecurityProviderError("lifi", "identity_mismatch");
  return token;
}
function normalizeLiFiResult(token: AppToken, lookupMode: "candidate-bound" | "asset-id", providerAssetId?: string): TokenSourceResult {
  if (tokenVerification(token) === "flagged") throw new SecurityProviderError("lifi", "token_flagged");
  const address = normalizeAddress(token.address)!;
  return { provider: "lifi", ...(providerAssetId ? { providerAssetId } : {}), chainId: token.chainId, tokenType: address === null ? "native" : "contract", address, decimals: token.decimals, symbol: token.symbol, fetchedAt: new Date().toISOString(), lookupMode };
}
export async function resolveLiFiCandidate(chainId: number, address: string | null, fresh = true): Promise<TokenSourceResult> {
  return normalizeLiFiResult(await getLiFiTokenByAddress(chainId, address, fresh), "candidate-bound");
}
/** Only an explicitly bound coinKey observed in list output is independent evidence. */
export async function resolveLiFiAsset(coinKey: string, chainId: number, fresh = true): Promise<TokenSourceResult> {
  if (!safeText(coinKey, 128)) throw new SecurityProviderError("lifi", "invalid_asset_id", 400);
  const { tokens, coinKeys } = await getLiFiDiscovery([chainId], fresh);
  const matches = tokens[chainId].filter(token => coinKeys[chainId][token.address.toLowerCase()] === coinKey);
  if (matches.length !== 1) throw new SecurityProviderError("lifi", matches.length ? "ambiguous_deployment" : "asset_binding_unavailable");
  return normalizeLiFiResult(matches[0], "asset-id", coinKey);
}

import { isSafeSecurityText, isValidSecurityDate, normalizeTokenIdentity } from "./identity";
import { TOKEN_PROVIDERS, type SecurityEvent, type TokenConsensusInput, type TokenConsensusResult, type TokenProvider, type TokenSourceResult } from "./types";

/** Pure comparison. Provider agreement never authorizes registry onboarding or migration. */
export function verifyTokenConsensus(input: TokenConsensusInput): TokenConsensusResult {
  const detectedAt = input.detectedAt ?? new Date().toISOString();
  if (!isSafeSecurityText(input.assetId) || !isValidSecurityDate(detectedAt)) throw new Error("INVALID_CONSENSUS_INPUT");
  normalizeTokenIdentity(input.chainId, "native", null);
  const events: SecurityEvent[] = [];
  const base = { assetId: input.assetId, chainId: input.chainId, detectedAt, ...(input.correlationId ? { correlationId: input.correlationId } : {}) };
  const sources: Partial<Record<TokenProvider, TokenSourceResult>> = {};
  const observed: Partial<Record<TokenProvider, TokenSourceResult>> = {};
  const providers: NonNullable<SecurityEvent["providers"]> = {};
  const invalid = new Set<TokenProvider>();
  const nonVoting = new Set<TokenProvider>();
  const invalidEvidence = new Set(["identity_mismatch", "metadata_mismatch", "invalid_address", "invalid_identity", "wrong_chain", "token_flagged", "ambiguous_deployment", "ambiguous_asset", "asset_id_mismatch", "native_asset_mismatch", "invalid_response", "response_too_large"]);
  let invalidIdentity = (input.unavailable ?? []).some((item) => invalidEvidence.has(item.reason));
  for (const result of input.results) {
    if (!(TOKEN_PROVIDERS as readonly string[]).includes(result.provider)) continue;
    try {
      if (sources[result.provider] || nonVoting.has(result.provider) || invalid.has(result.provider)) throw new Error("DUPLICATE_PROVIDER_RESULT");
      if (result.chainId !== input.chainId || (result.assetId !== undefined && result.assetId !== input.assetId)) throw new Error("UNBOUND_PROVIDER_IDENTITY");
      if (!isValidSecurityDate(result.fetchedAt) || (result.decimals !== undefined && (!Number.isInteger(result.decimals) || result.decimals < 0 || result.decimals > 255))) throw new Error("INVALID_PROVIDER_METADATA");
      const identity = normalizeTokenIdentity(result.chainId, result.tokenType, result.address);
      const independent = result.lookupMode !== "candidate-bound" && result.lookupMode !== "local-binding";
      providers[result.provider] = { address: identity.address, fetchedAt: result.fetchedAt, independent };
      observed[result.provider] = { ...result, address: identity.address };
      if (!independent) { nonVoting.add(result.provider); continue; }
      sources[result.provider] = { ...result, address: identity.address, tokenType: identity.type === "native" ? "native" : "contract" };
    } catch {
      invalidIdentity = true;
      invalid.add(result.provider);
      delete sources[result.provider]; delete providers[result.provider]; delete observed[result.provider];
    }
  }
  for (const provider of TOKEN_PROVIDERS) {
    if (!sources[provider]) events.push({ ...base, event: "TOKEN_PROVIDER_UNAVAILABLE", severity: "warning", action: "manual_review", details: { provider, reason: invalid.has(provider) ? "invalid_or_unbound_response" : "unavailable" } });
  }
  const counts = new Map<string | null, number>();
  for (const result of Object.values(sources)) counts.set(result.address, (counts.get(result.address) ?? 0) + 1);
  let consensusAddress: string | null | undefined;
  for (const [address, count] of counts) if (count >= 2) consensusAddress = address;
  const registry = input.registryEntry;
  let registryAddress: string | null | undefined;
  let registryValid = false;
  if (registry && registry.assetId === input.assetId && registry.chainId === input.chainId) {
    try { const identity = normalizeTokenIdentity(registry.chainId, registry.type, registry.address); registryAddress = identity.address; registryValid = identity.type === registry.type && Number.isInteger(registry.decimals) && registry.decimals >= 0 && registry.decimals <= 255; } catch { /* fail closed */ }
  }
  const divergentProviders = TOKEN_PROVIDERS.filter((provider) => providers[provider] && providers[provider]!.address !== (registryValid ? registryAddress : consensusAddress));
  const usableCount = Object.keys(sources).length;
  const quorum = input.requiredSources ?? 3;
  if (!Number.isInteger(quorum) || quorum < 2 || quorum > 3) throw new Error("INVALID_CONSENSUS_QUORUM");
  const disagreement = new Set(Object.values(providers).map((source) => source.address)).size > 1;
  const registryMismatch = registryValid && divergentProviders.length > 0;
  const majorityMismatch = registryValid && consensusAddress !== undefined && consensusAddress !== registryAddress;
  const metadataMismatch = registryValid && Object.values(observed).some((source) => source.address === registryAddress && source.decimals !== undefined && source.decimals !== registry!.decimals);
  let status: TokenConsensusResult["status"] = "manual_review";
  if (!registryValid || registry!.status !== "trusted") {
    status = "blocked";
    events.push({ ...base, event: "TOKEN_NOT_IN_REGISTRY", severity: "critical", action: "blocked", details: { reason: registryValid ? "registry_entry_disabled" : "missing_or_invalid_registry_entry" } });
  } else if (majorityMismatch || metadataMismatch || invalidIdentity || divergentProviders.some((provider) => nonVoting.has(provider))) status = "blocked";
  else if (consensusAddress === registryAddress && usableCount >= quorum) status = disagreement ? "verified_with_warning" : "verified";
  const critical = majorityMismatch || metadataMismatch || invalidIdentity || divergentProviders.some((provider) => nonVoting.has(provider));
  if (disagreement || registryMismatch) events.push({
    ...base, event: "TOKEN_ADDRESS_CONFLICT", ...(registry?.symbol ? { symbol: registry.symbol } : {}),
    ...(registryValid ? { registryAddress } : {}), providers, ...(consensusAddress !== undefined ? { consensusAddress } : {}), divergentProviders,
    severity: critical ? "critical" : status === "verified_with_warning" ? "warning" : "high",
    action: critical || status === "blocked" ? "blocked" : status === "verified_with_warning" ? "allowed_with_warning" : "manual_review",
  });
  if (majorityMismatch) events.push({ ...base, event: "TOKEN_CONTRACT_CHANGED", registryAddress, oldAddress: registryAddress, newAddress: consensusAddress, consensusAddress, providers, divergentProviders, severity: "critical", action: "blocked" });
  if (metadataMismatch) events.push({ ...base, event: "QUOTE_TOKEN_MISMATCH", registryAddress, providers, divergentProviders, severity: "critical", action: "blocked", details: { reason: "registry_decimals_mismatch" } });
  if (invalidIdentity) events.push({ ...base, event: "QUOTE_TOKEN_MISMATCH", registryAddress, providers, divergentProviders, severity: "critical", action: "blocked", details: { reason: (input.unavailable ?? []).some(item => item.reason === "token_flagged") ? "token_flagged" : "invalid_provider_identity" } });
  if (status === "verified" && usableCount === 3) events.push({ ...base, event: "TOKEN_CONSENSUS_RESTORED", registryAddress, consensusAddress, providers, divergentProviders: [], severity: "warning", action: "allowed_with_warning" });
  return { status, consensusAddress, divergentProviders, events };
}

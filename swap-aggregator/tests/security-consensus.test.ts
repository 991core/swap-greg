import { describe, expect, it } from "vitest";
import seed from "../security/trusted-tokens.v1.json";
import { verifyTokenConsensus } from "../lib/security/consensus";
import { normalizeTokenIdentity, tokenIdentityKey, validateTrustedRegistry } from "../lib/security/identity";
import { TOKEN_PROVIDERS, type TokenSourceResult } from "../lib/security/types";

const registry = validateTrustedRegistry(seed).entries.find((entry) => entry.chainId === 1 && entry.symbol === "USDC")!;
const A = registry.address!; const B = "0x" + "b".repeat(40); const C = "0x" + "c".repeat(40);
const fetchedAt = "2026-10-02T12:00:00.000Z";
function results(addresses: (string | null)[]): TokenSourceResult[] { return addresses.map((address, i) => ({ provider: TOKEN_PROVIDERS[i], chainId: 1, address, tokenType: address === null ? "native" : "contract", fetchedAt, decimals: 6, lookupMode: "asset-id" })); }
function verify(addresses: (string | null)[]) { return verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: results(addresses), detectedAt: fetchedAt }); }

describe("registry-authoritative token consensus", () => {
  it("three matching sources verify without an address conflict", () => {
    const value = verify([A, A, A]); expect(value.status).toBe("verified"); expect(value.consensusAddress).toBe(A);
    expect(value.events.filter((event) => event.event === "TOKEN_ADDRESS_CONFLICT")).toEqual([]);
  });
  it.each([0, 1, 2])("attributes the outlier at index %i and keeps A", (index) => {
    const values = [A, A, A]; values[index] = B;
    const value = verify(values); expect(value.status).toBe("verified_with_warning"); expect(value.divergentProviders).toEqual([TOKEN_PROVIDERS[index]]);
    expect(value.events.find((event) => event.event === "TOKEN_ADDRESS_CONFLICT")).toMatchObject({ severity: "warning", action: "allowed_with_warning", registryAddress: A, consensusAddress: A });
  });
  it("all different require high-severity manual review", () => {
    const value = verify([A, B, C]); expect(value.status).toBe("manual_review"); expect(value.consensusAddress).toBeUndefined();
    expect(value.events.find((event) => event.event === "TOKEN_ADDRESS_CONFLICT")?.severity).toBe("high");
  });
  it.each([[B, B, A], [B, B, B]])("a fake external majority cannot rewrite A: %j", (...addresses) => {
    const original = structuredClone(registry); const value = verify(addresses);
    expect(value.status).toBe("blocked"); expect(registry).toEqual(original);
    expect(value.events.find((event) => event.event === "TOKEN_ADDRESS_CONFLICT")?.severity).toBe("critical");
    expect(value.events.find((event) => event.event === "TOKEN_CONTRACT_CHANGED")).toMatchObject({ oldAddress: A, newAddress: B, severity: "critical" });
  });
  it("absence is not a vote or conflict", () => {
    const value = verify([A, A]); expect(value.status).toBe("manual_review");
    expect(value.events.some((event) => event.event === "TOKEN_ADDRESS_CONFLICT")).toBe(false);
    expect(value.events.find((event) => event.event === "TOKEN_PROVIDER_UNAVAILABLE")?.details?.provider).toBe("lifi");
  });
  it("explicit two-source observation policy still cannot onboard an unknown token", () => {
    const value = verifyTokenConsensus({ assetId: "unknown", chainId: 1, results: results([A, A, A]), requiredSources: 2 });
    expect(value.status).toBe("blocked"); expect(value.events.some((event) => event.event === "TOKEN_NOT_IN_REGISTRY")).toBe(true);
  });
  it("candidate-bound LI.FI is diagnostic evidence with zero independent votes", () => {
    const sources = results([A, A, A]); sources[2].lookupMode = "candidate-bound";
    const value = verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: sources });
    expect(value.status).toBe("manual_review"); expect(value.events.some((event) => event.event === "TOKEN_CONSENSUS_RESTORED")).toBe(false);
    sources[2].address = B;
    const wrong = verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: sources });
    expect(wrong.status).toBe("blocked"); expect(wrong.divergentProviders).toEqual(["lifi"]);
    expect(wrong.events.find((event) => event.event === "TOKEN_ADDRESS_CONFLICT")?.severity).toBe("critical");
  });
  it("rejects duplicate-provider votes, wrong chains and malformed identities", () => {
    const duplicates = [results([A])[0], results([A])[0], results([A, A])[1]];
    const value = verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: duplicates }); expect(value.status).toBe("blocked");
    const sources = results([A, A, A]); sources[0].chainId = 56;
    expect(verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: sources }).status).toBe("blocked");
    sources[0].chainId = 1; sources[0].address = "invalid";
    expect(verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: sources }).status).toBe("blocked");
  });
  it("provider identity mismatch reported as unavailable still blocks", () => {
    const value = verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: [], unavailable: [{ provider: "lifi", chainId: 1, reason: "identity_mismatch" }] });
    expect(value.status).toBe("blocked"); expect(value.events.some((event) => event.event === "QUOTE_TOKEN_MISMATCH")).toBe(true);
  });
  it("decimals and disabled registry metadata fail closed", () => {
    const sources = results([A, A, A]); sources[0].decimals = 18;
    expect(verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: sources }).status).toBe("blocked");
    sources[0].decimals = 6; sources[2].lookupMode = "candidate-bound"; sources[2].decimals = 18;
    expect(verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: registry, results: sources }).status).toBe("blocked");
    expect(verifyTokenConsensus({ assetId: registry.assetId, chainId: 1, registryEntry: { ...registry, status: "disabled" }, results: results([A, A, A]) }).status).toBe("blocked");
  });
  it("native sentinels normalize to null, never to WETH or a different chain", () => {
    expect(normalizeTokenIdentity(1, "contract", "0x" + "0".repeat(40))).toEqual({ chainId: 1, type: "native", address: null });
    expect(tokenIdentityKey(1, null)).not.toBe(tokenIdentityKey(1, "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"));
    expect(tokenIdentityKey(1, A)).not.toBe(tokenIdentityKey(56, A));
    expect(() => normalizeTokenIdentity(1, "native", A)).toThrow("NATIVE_CONTRACT_ADDRESS");
    expect(() => normalizeTokenIdentity(999, "native", null)).toThrow("UNSUPPORTED_SECURITY_CHAIN");
  });
});

import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { MAX_UINT256, validateSwapQuote, type RegistrySnapshot, type SecuritySwapIntent } from "../lib/security/quote-validator";
import { REVIEWED_UNISWAP_V2_ABI, validateTransaction, type TransactionCandidate, type TransactionPolicy } from "../lib/security/transaction-validator";
import type { TrustedTokenEntry } from "../lib/security/types";

const account = "0x1111111111111111111111111111111111111111";
const source = "0x2222222222222222222222222222222222222222";
const destination = "0x3333333333333333333333333333333333333333";
const router = "0x4444444444444444444444444444444444444444";
const foreign = "0x5555555555555555555555555555555555555555";
const native = "0x0000000000000000000000000000000000000000";
const now = 1_800_000_000_000;
function entry(address: string | null, assetId: string, chainId = 1): TrustedTokenEntry {
  return { assetId, chainId, type: address ? "erc20" : "native", address, decimals: 18, symbol: assetId,
    status: "trusted", consensusSources: ["coingecko", "coinmarketcap", "lifi"], firstVerifiedAt: new Date(now).toISOString(), lastVerifiedAt: new Date(now).toISOString(), version: 1 };
}
const registry: RegistrySnapshot = { entries: [entry(source, "source"), entry(destination, "destination"), entry(null, "eth")] };
function intent(overrides: Partial<SecuritySwapIntent> = {}): SecuritySwapIntent {
  return { provider: "lifi", protocol: "uniswap_v2", fromChainId: 1, toChainId: 1, fromTokenAddress: source,
    toTokenAddress: destination, fromTokenDecimals: 18, toTokenDecimals: 18, fromAddress: account, receiver: account,
    fromAmount: "1000000", toAmount: "990000", minimumAmountOut: "985050", expiresAt: now + 30_000, maxSlippageBps: 50, ...overrides };
}
function policy(): TransactionPolicy {
  return { supportedChainIds: [1], maxSlippageBps: 100, lifiAllowedContracts: [{ chainId: 1, address: router, provider: "lifi", protocol: "uniswap_v2", abi: "uniswap_v2_swap_exact_tokens_v1" }],
    allowedApprovalTargets: [{ chainId: 1, address: router, provider: "lifi", protocol: "uniswap_v2" }], allowedDepositReceivers: [] };
}
function swap(overrides: Partial<TransactionCandidate> = {}): TransactionCandidate {
  return { chainId: 1, from: account, to: router, value: "0", data: encodeFunctionData({ abi: REVIEWED_UNISWAP_V2_ABI,
    functionName: "swapExactTokensForTokens", args: [BigInt(1000000), BigInt(985050), [source, destination], account, BigInt(now / 1000 + 20)] }), ...overrides };
}
function approve(spender: Address = router, amount = BigInt(1000000)): TransactionCandidate {
  return swap({ to: source, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });
}
describe("Trusted Registry quote boundary", () => {
  it("accepts case-normalized exact identities with pinned decimals", () => {
    expect(() => validateSwapQuote(intent({ fromTokenAddress: source.toUpperCase().replace("0X", "0x") }), intent(), registry, now)).not.toThrow();
  });
  it.each([
    [{ toTokenAddress: foreign }, "QUOTE_TOKEN_MISMATCH"], [{ toChainId: 8453 }, "QUOTE_CHAIN_MISMATCH"],
    [{ receiver: foreign }, "QUOTE_RECEIVER_MISMATCH"], [{ fromTokenDecimals: 6 }, "QUOTE_TOKEN_MISMATCH"],
    [{ fromAmount: "1000001" }, "QUOTE_VALIDATION_FAILED"], [{ minimumAmountOut: "985049" }, "QUOTE_VALIDATION_FAILED"],
    [{ expiresAt: now }, "QUOTE_VALIDATION_FAILED"], [{ maxSlippageBps: 100 }, "QUOTE_VALIDATION_FAILED"],
  ] as const)("rejects a changed quote field %j", (change, code) => {
    expect(() => validateSwapQuote(intent(change), intent(), registry, now)).toThrow(code);
  });
  it("blocks unregistered tokens despite matching quote/intent and any API claim", () => {
    const requested = intent({ fromTokenAddress: foreign });
    expect(() => validateSwapQuote(requested, requested, registry, now)).toThrow("TOKEN_NOT_IN_REGISTRY");
  });
  it("blocks disabled/migration entries and duplicate registry identities", () => {
    for (const status of ["disabled", "pending_migration"] as const) expect(() => validateSwapQuote(intent(), intent(), { entries: registry.entries.map(token => token.address === source ? { ...token, status } : token) }, now)).toThrow("TOKEN_NOT_IN_REGISTRY");
    expect(() => validateSwapQuote(intent(), intent(), { entries: [...registry.entries, entry(source, "impostor")] }, now)).toThrow("TOKEN_NOT_IN_REGISTRY");
  });
  it("normalizes native sentinels locally but never equates native ETH with an ERC-20", () => {
    const requested = intent({ fromTokenAddress: native });
    expect(() => validateSwapQuote(requested, requested, registry, now)).not.toThrow();
    expect(() => validateSwapQuote(intent(), requested, registry, now)).toThrow("QUOTE_TOKEN_MISMATCH");
  });
});
describe("decoded final transaction boundary", () => {
  it("accepts only a reviewed same-chain exact-input V2 method and exact finite approval", () => {
    expect(validateTransaction(swap(), intent(), registry, policy(), { provider: "lifi", kind: "swap" }, now).kind).toBe("swap");
    expect(validateTransaction(approve(), intent(), registry, policy(), { provider: "lifi", kind: "approval" }, now)).toMatchObject({ kind: "approval", spender: router });
    expect(validateTransaction(approve(router, BigInt(0)), intent(), registry, policy(), { provider: "lifi", kind: "approval_reset" }, now).kind).toBe("approval_reset");
  });
  it("blocks default empty targets, unknown router/spender and protocol/provider/chain wildcard attempts", () => {
    expect(() => validateTransaction(swap(), intent(), registry, { ...policy(), lifiAllowedContracts: [] }, undefined, now)).toThrow("UNKNOWN_TRANSACTION_TARGET");
    expect(() => validateTransaction(approve(foreign), intent(), registry, policy(), undefined, now)).toThrow("UNKNOWN_APPROVAL_TARGET");
    for (const target of [{ ...policy().lifiAllowedContracts[0], protocol: undefined }, { ...policy().lifiAllowedContracts[0], provider: "rango" as const }, { ...policy().lifiAllowedContracts[0], chainId: 8453 }]) {
      expect(() => validateTransaction(swap(), intent(), registry, { ...policy(), lifiAllowedContracts: [target] }, undefined, now)).toThrow("UNKNOWN_TRANSACTION_TARGET");
    }
  });
  it.each([MAX_UINT256, BigInt(999999), BigInt(1000001)])("rejects oversized/infinite or inaccurate approval %s", amount => {
    expect(() => validateTransaction(approve(router, amount), intent(), registry, policy(), undefined, now)).toThrow("QUOTE_VALIDATION_FAILED");
  });
  it("rejects changed source account/network/value and noncanonical/trailing calldata", () => {
    for (const change of [{ from: foreign }, { chainId: 8453 }, { value: "1" }, { data: `${swap().data}00` }]) {
      expect(() => validateTransaction(swap(change), intent(), registry, policy(), undefined, now)).toThrow();
    }
    expect(() => validateTransaction(swap({ data: "0x12345678" }), intent(), registry, policy(), undefined, now)).toThrow("QUOTE_VALIDATION_FAILED");
    expect(() => validateTransaction({ ...swap(), authorizationList: [] } as TransactionCandidate, intent(), registry, policy(), undefined, now)).toThrow("QUOTE_VALIDATION_FAILED");
  });
  it("checks decoded path, receiver, amount, minimum and deadline rather than selector only", () => {
    const valid = [BigInt(1000000), BigInt(985050), [source, destination], account, BigInt(now / 1000 + 20)] as const;
    const variants = [
      [BigInt(1), ...valid.slice(1)], [valid[0], BigInt(1), ...valid.slice(2)], [valid[0], valid[1], [source, foreign], ...valid.slice(3)],
      [...valid.slice(0, 3), foreign, valid[4]], [...valid.slice(0, 4), BigInt(now / 1000 - 1)], [...valid.slice(0, 4), BigInt(now / 1000 + 60)],
    ];
    for (const args of variants) {
      const data = encodeFunctionData({ abi: REVIEWED_UNISWAP_V2_ABI, functionName: "swapExactTokensForTokens", args: args as unknown as typeof valid });
      expect(() => validateTransaction(swap({ data }), intent(), registry, policy(), undefined, now)).toThrow();
    }
  });
  it("rejects a decoded V2 method used for a cross-chain quote", () => {
    const requested = intent({ toChainId: 8453 }); const remote = { entries: [...registry.entries, entry(destination, "destination", 8453)] };
    expect(() => validateTransaction(swap(), requested, remote, { ...policy(), supportedChainIds: [1, 8453] }, undefined, now)).toThrow("QUOTE_VALIDATION_FAILED");
  });
  it("never lets a 1Click quote promote its dynamic deposit into the reviewed allowlist", () => {
    const requested = intent({ provider: "oneclick", protocol: "oneclick", depositAddress: foreign });
    const tx = swap({ to: source, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [foreign, BigInt(requested.fromAmount)] }) });
    expect(() => validateTransaction(tx, requested, registry, policy(), { provider: "oneclick", kind: "deposit", depositAddress: foreign }, now)).toThrow("UNKNOWN_TRANSACTION_TARGET");
    const approved = { ...policy(), allowedDepositReceivers: [{ chainId: 1, address: foreign, provider: "oneclick" as const, protocol: "oneclick", abi: "erc20_transfer" as const }] };
    expect(validateTransaction(tx, requested, registry, approved, { provider: "oneclick", kind: "deposit", depositAddress: foreign }, now).kind).toBe("deposit");
    expect(() => validateTransaction(tx, { ...requested, depositAddress: router }, registry, approved, { provider: "oneclick", kind: "deposit" }, now)).toThrow("QUOTE_VALIDATION_FAILED");
  });
});

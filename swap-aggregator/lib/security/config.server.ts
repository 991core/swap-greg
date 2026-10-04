import "server-only";
import path from "node:path";
import { isSupportedSecurityChain, normalizeEvmAddress, SUPPORTED_SECURITY_CHAIN_IDS } from "./identity";

export type ContractPolicy = {
  chainId: number; address: string; provider: "lifi" | "rango" | "oneclick"; protocol: string;
  abi?: "uniswap_v2_swap_exact_tokens_v1" | "erc20_transfer";
};
export type SecurityConfig = {
  requiredSources: number;
  allowTwoOfThreeOnInitialOnboarding: boolean;
  topAssetFetchLimit: number;
  targetUniverseSize: number;
  supportedChainIds: number[];
  lifiAllowedContracts: ContractPolicy[];
  allowedApprovalTargets: ContractPolicy[];
  allowedDepositReceivers: ContractPolicy[];
  maxSlippageBps: number;
  registryPath: string;
  conflictLogPath: string;
  conflictLogRetentionDays: number;
};
function boundedInteger(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`INVALID_SECURITY_CONFIG:${key}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`INVALID_SECURITY_CONFIG:${key}`);
  return value;
}
function policies(raw: string | undefined, requireAbi: boolean): ContractPolicy[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 256) throw new Error();
    return value.map((entry: ContractPolicy) => {
      if (!entry || !isSupportedSecurityChain(entry.chainId) || !["lifi", "rango", "oneclick"].includes(entry.provider) || typeof entry.protocol !== "string" || !/^[a-zA-Z0-9_:. -]{1,100}$/.test(entry.protocol) || (requireAbi && !entry.abi) || (entry.abi !== undefined && !["uniswap_v2_swap_exact_tokens_v1", "erc20_transfer"].includes(entry.abi)) || Object.keys(entry).some((key) => !["chainId", "address", "provider", "protocol", "abi"].includes(key))) throw new Error();
      const address = normalizeEvmAddress(entry.address);
      if (/^0x0{40}$/.test(address)) throw new Error();
      return { ...entry, address };
    });
  } catch { throw new Error("INVALID_SECURITY_CONTRACT_POLICY"); }
}
/** Returns policy only; API credentials never enter this object or diagnostic errors. */
export function readSecurityConfig(env: Record<string, string | undefined> = process.env): SecurityConfig {
  const sourceCount = boundedInteger(env, "TOKEN_CONSENSUS_REQUIRED_SOURCES", 3, 2, 3);
  const flag = env.ALLOW_TWO_OF_THREE_ON_INITIAL_ONBOARDING ?? "false";
  if (flag !== "true" && flag !== "false") throw new Error("INVALID_SECURITY_CONFIG:ALLOW_TWO_OF_THREE_ON_INITIAL_ONBOARDING");
  let supportedChainIds = [...SUPPORTED_SECURITY_CHAIN_IDS] as number[];
  if (env.SUPPORTED_CHAIN_IDS) {
    try { const parsed: unknown = JSON.parse(env.SUPPORTED_CHAIN_IDS); if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 9 || parsed.some((id) => !isSupportedSecurityChain(id)) || new Set(parsed).size !== parsed.length) throw new Error(); supportedChainIds = parsed; }
    catch { throw new Error("INVALID_SECURITY_CONFIG:SUPPORTED_CHAIN_IDS"); }
  }
  const registryPath = path.resolve(env.TOKEN_REGISTRY_PATH || path.join(process.cwd(), ".hermes-security", "trusted-tokens.json"));
  const conflictLogPath = path.resolve(env.TOKEN_CONFLICT_LOG_PATH || path.join(path.dirname(registryPath), "security-events.json"));
  if (registryPath === conflictLogPath) throw new Error("INVALID_SECURITY_STORAGE_PATH");
  const topAssetFetchLimit = boundedInteger(env, "TOP_ASSET_FETCH_LIMIT", 120, 1, 250);
  const targetUniverseSize = boundedInteger(env, "TARGET_UNIVERSE_SIZE", 100, 1, 120);
  if (targetUniverseSize > topAssetFetchLimit) throw new Error("INVALID_SECURITY_UNIVERSE_SIZE");
  return { requiredSources: sourceCount, allowTwoOfThreeOnInitialOnboarding: flag === "true", topAssetFetchLimit, targetUniverseSize, supportedChainIds,
    lifiAllowedContracts: policies(env.LIFI_ALLOWED_CONTRACTS, true), allowedApprovalTargets: policies(env.ALLOWED_APPROVAL_TARGETS, false), allowedDepositReceivers: policies(env.ALLOWED_DEPOSIT_RECEIVERS, true),
    maxSlippageBps: boundedInteger(env, "MAX_SLIPPAGE_BPS", 100, 0, 9999), registryPath, conflictLogPath,
    // An archive-policy hint only. This implementation never deletes audit history.
    conflictLogRetentionDays: boundedInteger(env, "TOKEN_CONFLICT_LOG_RETENTION", 365, 1, 36500),
  };
}

import "server-only";

export const ONECLICK_API = "https://1click.chaindefuser.com/v0";

export const ONECLICK_CHAINS: Record<number, string> = {
  1: "eth", 8453: "base", 42161: "arb", 10: "op", 137: "pol",
  56: "bsc", 43114: "avax", 100: "gnosis",
};

export type OneClickToken = {
  assetId: string;
  blockchain: string;
  contractAddress: string;
  decimals: number;
  symbol: string;
};

export function oneClickHeaders(): HeadersInit {
  const apiKey = process.env.NEAR_1CLICK_API_KEY;
  const jwt = process.env.NEAR_1CLICK_JWT;
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
}

export async function oneClickRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${ONECLICK_API}${path}`, {
    ...init,
    headers: { ...oneClickHeaders(), ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "message" in result
      ? String(result.message) : `1Click HTTP ${response.status}`;
    throw new Error(message.slice(0, 300));
  }
  return result;
}

let tokenCache: { expires: number; tokens: OneClickToken[] } | undefined;

export async function getOneClickTokens(): Promise<OneClickToken[]> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.tokens;
  const data = await oneClickRequest("/tokens");
  if (!Array.isArray(data)) throw new Error("Invalid 1Click token registry");
  const tokens = data.filter((token): token is OneClickToken =>
    typeof token?.assetId === "string" &&
    typeof token?.blockchain === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(token?.contractAddress) &&
    Number.isInteger(token?.decimals) &&
    typeof token?.symbol === "string",
  );
  tokenCache = { expires: Date.now() + 5 * 60_000, tokens };
  return tokens;
}

export function findOneClickToken(tokens: OneClickToken[], chainId: number, address: string) {
  return tokens.find((token) =>
    token.blockchain === ONECLICK_CHAINS[chainId] &&
    token.contractAddress.toLowerCase() === address.toLowerCase(),
  );
}

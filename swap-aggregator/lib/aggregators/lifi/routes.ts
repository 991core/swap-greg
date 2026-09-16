import {
  getChains,
  getRoutes,
  getTokenBalances,
  getTokens,
  type ExtendedChain,
  type Route,
  type Token,
} from "@lifi/sdk";
import type { TokenAmount } from "@lifi/types";
import { createPublicClient, erc20Abi, formatUnits, http, type Address, type Chain } from "viem";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  gnosis,
  mainnet,
  metis,
  optimism,
  polygon,
  tron,
} from "viem/chains";
import { APP_CHAIN_IDS } from "../../chains";
import {
  isTop20Symbol,
  normalizeToTopSymbol,
  topSymbolRank,
} from "../../topTokens";
import { getLifiSdkClient } from "./client";

const CHAIN_LOOKUP = new Map<number, Chain>([
  [mainnet.id, mainnet],
  [base.id, base],
  [arbitrum.id, arbitrum],
  [optimism.id, optimism],
  [polygon.id, polygon],
  [bsc.id, bsc],
  [avalanche.id, avalanche],
  [gnosis.id, gnosis],
  [metis.id, metis],
  [tron.id, tron],
]);

const PLATFORM_FEE = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_PERCENT ?? "0") / 100;

export function buildKnownFallbackTokens(chainId: number): AppToken[] {
  const nativeCurrency = CHAIN_LOOKUP.get(chainId)?.nativeCurrency;
  const native = {
    address: "0x0000000000000000000000000000000000000000",
    symbol: nativeCurrency?.symbol ?? "ETH",
    name: nativeCurrency?.name ?? "Ether",
    decimals: nativeCurrency?.decimals ?? 18,
    chainId,
    priceUSD: "0",
    logoURI: "",
    topSymbol: (nativeCurrency?.symbol ?? "ETH").toUpperCase(),
    balance: "0",
    balanceUsd: 0,
    hasBalance: false,
  } as AppToken;

  const byChain: Record<number, AppToken[]> = {
    [mainnet.id]: [
      native,
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        symbol: "USDT",
        name: "Tether USD",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDT",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        chainId,
        priceUSD: "3000",
        logoURI: "",
        topSymbol: "ETH",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [base.id]: [
      native,
      {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        symbol: "DAI",
        name: "Dai Stablecoin",
        decimals: 18,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "DAI",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        chainId,
        priceUSD: "3000",
        logoURI: "",
        topSymbol: "ETH",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [arbitrum.id]: [
      native,
      {
        address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        symbol: "USDT",
        name: "Tether USD",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDT",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [optimism.id]: [
      native,
      {
        address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [polygon.id]: [
      native,
      {
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [gnosis.id]: [
      native,
      {
        address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
        symbol: "WXDAI",
        name: "Wrapped XDAI",
        decimals: 18,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "XDAI",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0x4ECaBa167037aEBa1C17D919515aAb6a66ce21Cf",
        symbol: "USDC",
        name: "USD Coin (Gnosis)",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [metis.id]: [
      native,
      {
        address: "0xDDe48985d6Af1D5ACA3321D30b821564Ef2bb9E1",
        symbol: "WMETIS",
        name: "Wrapped Metis",
        decimals: 18,
        chainId,
        priceUSD: "0",
        logoURI: "",
        topSymbol: "METIS",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "0x51318B7D00db7ACc4026C88c3101705Fe8598c5b",
        symbol: "USDC",
        name: "USD Coin (Metis)",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [1151111081099710]: [
      native,
      {
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        name: "USD Coin (Solana)",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDC",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        symbol: "USDT",
        name: "Tether USD (Solana)",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDT",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
      {
        address: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Wrapped Solana",
        decimals: 9,
        chainId,
        priceUSD: "0",
        logoURI: "",
        topSymbol: "SOL",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
    [tron.id]: [
      native,
      {
        address: "TEkxiTehnzSmSe2X7pLXdatGnCpnBR8nRa",
        symbol: "USDT",
        name: "Tether USD (Tron)",
        decimals: 6,
        chainId,
        priceUSD: "1",
        logoURI: "",
        topSymbol: "USDT",
        balance: "0",
        balanceUsd: 0,
        hasBalance: false,
      } as AppToken,
    ],
  };

  return byChain[chainId] ?? [native];
}

export type SwapParams = {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress: string;
};

export type AppToken = Token & {
  topSymbol: string;
  balance?: string;
  balanceUsd?: number;
  hasBalance?: boolean;
};

export type TokenBalanceEntry = {
  chainId: number;
  token: AppToken;
  balance: string;
  balanceUsd: number;
};

export async function fetchSupportedChains(): Promise<ExtendedChain[]> {
  const client = getLifiSdkClient();
  const chains = await getChains(client);
  const allowed = new Set<number>(APP_CHAIN_IDS);

  const filtered = chains.filter((chain) => allowed.has(chain.id));

  if (filtered.length === 0) {
    return chains.filter((chain) => allowed.has(chain.id));
  }

  return filtered.sort(
    (a, b) =>
      APP_CHAIN_IDS.indexOf(a.id as (typeof APP_CHAIN_IDS)[number]) -
      APP_CHAIN_IDS.indexOf(b.id as (typeof APP_CHAIN_IDS)[number]),
  );
}

export const fetchSupportedTestnetChains = fetchSupportedChains;

export async function fetchTopTokensByChain(chainIds: number[]): Promise<Record<number, AppToken[]>> {
  const client = getLifiSdkClient();
  const { tokens } = await getTokens(client, { chains: chainIds });
  const result: Record<number, AppToken[]> = {};

  for (const chainId of chainIds) {
    const list = tokens[chainId] ?? [];
    const bestByTop = new Map<string, AppToken>();

    for (const token of list) {
      if (!isTop20Symbol(token.symbol)) continue;

      const topSymbol = normalizeToTopSymbol(token.symbol)!;
      const candidate: AppToken = { ...token, topSymbol };
      const existing = bestByTop.get(topSymbol);

      if (!existing) {
        bestByTop.set(topSymbol, candidate);
        continue;
      }

      const exactNew =
        token.symbol.toUpperCase() === topSymbol ||
        (topSymbol === "BTC" && token.symbol.toUpperCase() === "WBTC");
      const exactOld =
        existing.symbol.toUpperCase() === topSymbol ||
        (topSymbol === "BTC" && existing.symbol.toUpperCase() === "WBTC");

      if (exactNew && !exactOld) {
        bestByTop.set(topSymbol, candidate);
      }
    }

    result[chainId] = [...bestByTop.values()].sort(
      (a, b) => topSymbolRank(a.topSymbol) - topSymbolRank(b.topSymbol),
    );
  }

  return result;
}

async function fetchOnchainBalancesForChain(
  walletAddress: string,
  chainId: number,
  tokens: AppToken[],
): Promise<TokenBalanceEntry[]> {
  const chain = CHAIN_LOOKUP.get(chainId);
  if (!chain) return [];

  const publicClient = createPublicClient({
    chain,
    transport: chain.rpcUrls.default.http[0] ? http(chain.rpcUrls.default.http[0], { retryCount: 2 }) : http(),
  });

  const entries: TokenBalanceEntry[] = [];

  try {
    const nativeBalance = await publicClient.getBalance({ address: walletAddress as Address });
    const amount = formatUnits(nativeBalance, chain.nativeCurrency.decimals);

    entries.push({
      chainId,
      balance: amount,
      balanceUsd: 0,
      token: {
        address: "0x0000000000000000000000000000000000000000",
        symbol: chain.nativeCurrency.symbol,
        name: chain.nativeCurrency.name,
        decimals: chain.nativeCurrency.decimals,
        chainId,
        priceUSD: "0",
        logoURI: "",
        topSymbol: chain.nativeCurrency.symbol.toUpperCase(),
        balance: amount,
        balanceUsd: 0,
        hasBalance: Number(amount) > 0,
      } as AppToken,
    });
  } catch {
    // Ignore native balance failures and continue with ERC20 balances.
  }

  for (const token of tokens) {
    const address = token.address?.toLowerCase();
    if (!address || address === "0x0000000000000000000000000000000000000000") continue;

    try {
      const balance = await publicClient.readContract({
        abi: erc20Abi,
        address: address as Address,
        functionName: "balanceOf",
        args: [walletAddress as Address],
      });

      const amount = formatUnits(balance as bigint, token.decimals ?? 18);
      if (Number(amount) <= 0) continue;

      entries.push({
        chainId,
        balance: amount,
        balanceUsd: token.balanceUsd ?? 0,
        token: {
          ...token,
          balance: amount,
          balanceUsd: token.balanceUsd ?? 0,
          hasBalance: true,
        },
      });
    } catch {
      // Some tokens may not be readable on-chain; skip them.
    }
  }

  return entries;
}

export async function fetchWalletTokenBalances(
  walletAddress: string,
  knownTokensByChain: Record<number, AppToken[]> = {},
): Promise<TokenBalanceEntry[]> {
  if (!walletAddress) return [];

  const entriesByKey = new Map<string, TokenBalanceEntry>();

  const addEntry = (entry: TokenBalanceEntry) => {
    const key = `${entry.chainId}:${entry.token.address ?? ""}:${entry.token.symbol}`;
    const current = entriesByKey.get(key);

    if (!current) {
      entriesByKey.set(key, entry);
      return;
    }

    const nextBalance = Number(entry.balance ?? "0");
    const currentBalance = Number(current.balance ?? "0");

    if (nextBalance > currentBalance) {
      entriesByKey.set(key, entry);
    }
  };

  try {
    const client = getLifiSdkClient();
    const balances = await getTokenBalances(client, walletAddress, []);

    for (const item of balances as TokenAmount[]) {
      const chainId = Number(item.chainId);
      const normalized = normalizeToTopSymbol(item.symbol);
      if (!normalized || !isTop20Symbol(item.symbol)) continue;

      const amount = String(item.amount ?? "0");
      const balanceUsd = (Number(item.priceUSD ?? 0) * Number(amount)) / 10 ** (item.decimals ?? 0);
      const token: AppToken = {
        address: item.address,
        symbol: item.symbol,
        name: item.name,
        decimals: item.decimals,
        chainId,
        priceUSD: item.priceUSD,
        logoURI: item.logoURI,
        topSymbol: normalized,
        balance: amount,
        balanceUsd: Number.isFinite(balanceUsd) ? balanceUsd : 0,
        hasBalance: Number(amount) > 0,
      };

      addEntry({
        chainId,
        token,
        balance: amount,
        balanceUsd: Number.isFinite(balanceUsd) ? balanceUsd : 0,
      });
    }
  } catch {
    // Fall through to on-chain polling below.
  }

  for (const [chainIdString, tokens] of Object.entries(knownTokensByChain)) {
    const chainId = Number(chainIdString);
    const fallbackTokens = tokens.length > 0 ? tokens : buildKnownFallbackTokens(chainId);
    const onchainEntries = await fetchOnchainBalancesForChain(walletAddress, chainId, fallbackTokens);
    for (const entry of onchainEntries) {
      addEntry(entry);
    }
  }

  return [...entriesByKey.values()].sort((a, b) => (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0));
}

export async function fetchRoutes(params: SwapParams): Promise<Route[]> {
  if (!params) {
    throw new Error("Les paramètres de recherche LI.FI sont absents.");
  }

  const client = getLifiSdkClient();
  const result = await getRoutes(client, {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    options: {
      ...(PLATFORM_FEE > 0 ? { fee: PLATFORM_FEE } : {}),
      maxPriceImpact: 0.4,
    },
  });

  const routes = [...(result.routes ?? [])];

  routes.sort((a, b) => {
    const aNet = BigInt(a.toAmount);
    const bNet = BigInt(b.toAmount);

    if (aNet === bNet) return 0;
    return aNet > bNet ? -1 : 1;
  });

  return routes;
}

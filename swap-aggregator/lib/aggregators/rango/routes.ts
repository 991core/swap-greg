import type { SwapParams } from "../lifi/routes";
import type { NormalizedRoute } from "../../types/normalized-route";

export type RangoRoute = {
  id?: string;
  toAmount?: string;
  destinationAmount?: string;
  steps?: Array<{
    tool?: string;
    toolDetails?: { name?: string };
    estimate?: { executionDuration?: number };
  }>;
};

export async function fetchRangoRoutes(params: SwapParams): Promise<RangoRoute[]> {
  const apiKey = process.env.NEXT_PUBLIC_RANGO_API_KEY;

  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch("https://api.rango.exchange/basic/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        from: {
          blockchain: params.fromChainId === 1 ? "ETH" : params.fromChainId === 8453 ? "BASE" : undefined,
          address: params.fromTokenAddress || null,
        },
        to: {
          blockchain: params.toChainId === 1 ? "ETH" : params.toChainId === 8453 ? "BASE" : undefined,
          address: params.toTokenAddress || null,
        },
        amount: params.fromAmount,
        fromAddress: params.fromAddress || undefined,
        toAddress: params.fromAddress || undefined,
        slippage: 1.5,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const route = data?.route ?? data;

    if (!route) {
      return [];
    }

    return [
      {
        id: route.id ?? `rango-${params.fromChainId}-${params.toChainId}-${params.fromTokenAddress}-${params.toTokenAddress}`,
        toAmount: route.toAmount ?? route.destinationAmount ?? "0",
        steps: route.steps ?? [],
      },
    ];
  } catch {
    return [];
  }
}

export function normalizeRangoRoute(route: RangoRoute, params: SwapParams): NormalizedRoute {
  const tools = (route.steps ?? [])
    .map((step) => step.toolDetails?.name || step.tool)
    .filter(Boolean);

  return {
    id: route.id ?? `rango-${params.fromChainId}-${params.toChainId}-${params.fromTokenAddress}-${params.toTokenAddress}`,
    provider: "rango",
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    toAmount: route.toAmount ?? "0",
    toolLabel: [...new Set(tools)].join(" → ") || "Rango",
    durationSeconds: (route.steps ?? []).reduce((acc, step) => acc + (step.estimate?.executionDuration ?? 0), 0),
    raw: route,
  };
}

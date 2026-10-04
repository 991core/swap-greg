import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetTokenVerdictsForTests } from "../lib/tokens/verdicts";
beforeEach(async () => { (await import("../lib/tokens/popular")).resetPopularTokensForTests(); resetTokenVerdictsForTests(); (await import("../lib/security/client")).resetRegistryForTests(); (await import("../lib/tokens/market-universe")).resetMarketUniverseForTests(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

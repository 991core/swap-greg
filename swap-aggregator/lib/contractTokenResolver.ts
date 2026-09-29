import { getTokenDetails } from "./tokens/client";
import type { AppToken } from "./tokens/types";
export { looksLikeAddress } from "./tokens/validation";

/** LI.FI metadata only: an RPC response alone does not establish route support. */
export async function resolveTokenByAddress(chainId: number, address: string): Promise<AppToken | null> {
  try { return await getTokenDetails(chainId, address); }
  catch { return null; }
}

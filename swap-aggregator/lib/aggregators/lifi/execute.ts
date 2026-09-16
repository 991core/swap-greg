import { executeRoute, type ExecutionOptions, type Route } from "@lifi/sdk";
import { getLifiSdkClient } from "./client";

export async function executeLifiRoute(route: Route, options?: ExecutionOptions) {
  const client = getLifiSdkClient();
  return executeRoute(client, route, options);
}

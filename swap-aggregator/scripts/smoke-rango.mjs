// Read-only smoke test against a production build. Never calls /swap or a wallet.
// Run: npm run build && node scripts/smoke-rango.mjs
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const port = 3149;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", chunk => { logs += chunk; });
server.stderr.on("data", chunk => { logs += chunk; });
try {
  const deadline = Date.now() + 15000;
  while (!logs.includes("Ready")) {
    if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Server did not start: ${logs}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const home = await fetch(base, { signal: AbortSignal.timeout(10000) });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Rango/); assert.match(html, /\/tokens\/eth.svg/);
  const files = (await readdir("public/tokens")).filter(name=>name.endsWith(".svg"));
  for (const file of files) {
    const response = await fetch(`${base}/tokens/${file}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, file); assert.match(await response.text(), /<svg/);
  }
  const post = (operation, body) => fetch(`${base}/api/rango/${operation}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  assert.equal((await post("quote", { params: { fromAmount: "1e18" } })).status, 400);
  assert.equal((await post("status", { requestId: "invalid", txId: "invalid" })).status, 400);
  const response = await post("quote", { params: { fromChainId: 8453, toChainId: 1,
    fromTokenAddress: "0x0000000000000000000000000000000000000000", toTokenAddress: "0x0000000000000000000000000000000000000000",
    fromAmount: "10000000000000000", fromAddress: "0x1111111111111111111111111111111111111111" } });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.resultType, "OK");
  assert.match(data.route.outputAmountMin, /^\d+$/);
  assert.doesNotMatch(logs, /Critical dependency|virtualMasterPool/);
  console.log(JSON.stringify({ home: home.status, localLogos: files.length, quote: response.status, resultType: data.resultType, provider: "Rango", swapper: data.route.swapper.title, walletTransactions: 0 }, null, 2));
} finally {
  server.kill("SIGTERM");
  if (server.exitCode === null) await once(server, "exit");
}

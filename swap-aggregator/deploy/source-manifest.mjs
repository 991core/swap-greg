import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, relative } from "node:path";

// Explicit source scope. Never traverses .env files, journals or local private data.
const root = resolve(import.meta.dirname, "..");
const selected = ["app", "components", "lib", "public", "security", "package.json", "package-lock.json", "next.config.js", "next-env.d.ts", "tsconfig.json", ".eslintrc.json", "Dockerfile", ".dockerignore"];
const files = [];
async function visit(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Refuse symlink in source scope: ${relative(root, path)}`);
  if (stat.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await visit(resolve(path, name));
  } else if (stat.isFile()) {
    const name = relative(root, path);
    if (/(?:^|\/)\.env|\.pem$|\.key$|secret/i.test(name)) throw new Error(`Refuse private-looking source file: ${name}`);
    files.push({ path: name, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
}
for (const entry of selected) await visit(resolve(root, entry));
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
const treeSha256 = createHash("sha256").update(files.map(file => `${file.path}\0${file.sha256}\n`).join("")).digest("hex");
let head;
try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
catch (error) {
  // Some constrained runners report EPERM after a successful child exit.
  // Accept only a successful git result with an exact commit hash, never stderr.
  if (error.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(String(error.stdout))) throw error;
  head = String(error.stdout).trim();
}
console.log(JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), head, treeSha256, files }, null, 2));

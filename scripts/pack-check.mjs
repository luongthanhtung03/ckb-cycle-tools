/**
 * Proves the npm package works for a stranger: packs it, installs the tarball
 * into an empty project, and uses it from there through the public entry point.
 *
 * Usage: npm run pack:check
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pack-check-"));
const app = join(dir, "app");
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();
try {
  sh(`npm pack --pack-destination "${dir}"`, process.cwd());
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  sh(`npm install --no-audit --no-fund "${join(dir, tgz)}"`, app);
  writeFileSync(
    join(app, "check.mjs"),
    `
import { profileTransaction, resolveDebugger } from "ckb-cycle-tools";
import { analyzeTransaction } from "ckb-cycle-tools/analyze";
import { execSync } from "node:child_process";
for (const f of [profileTransaction, resolveDebugger, analyzeTransaction]) {
  if (typeof f !== "function") throw new Error("missing export");
}
// The CLI as an installed bin, the way users run it.
const usage = execSync("npx --no-install ckb-cycles --help", { encoding: "utf8" });
if (!usage.startsWith("usage: ckb-cycles")) throw new Error("ckb-cycles bin");
console.log("ok: " + ${JSON.stringify(tgz)} + " installs, imports and runs ckb-cycles from a clean project");
`,
  );
  process.stdout.write(sh("node check.mjs", app));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Builds the ckb-js-vm session lock: esbuild bundles the TypeScript, then
 * ckb-js-vm itself (run under ckb-debugger) compiles it to QuickJS bytecode —
 * the same pipeline ckb-js-std projects use.
 *
 * Output: benchmarks/session-lock/dist/session-lock.bc
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDebugger } from "../../dist/index.js";

// ckb-testtool's ESM build uses extensionless imports plain Node cannot load; its
// CommonJS build is fine.
const require = createRequire(import.meta.url);
const { DEFAULT_SCRIPT_CKB_JS_VM } = require("ckb-testtool");

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const js = join(dist, "session-lock.js");
const bc = join(dist, "session-lock.bc");
mkdirSync(dist, { recursive: true });

// esbuild's JS API, not its bin: on Linux the install step swaps bin/esbuild for
// the native executable, which `node` cannot run.
require("esbuild").buildSync({
  entryPoints: [join(here, "js", "index.ts")],
  outfile: js,
  platform: "neutral",
  bundle: true,
  external: ["@ckb-js-std/bindings"],
  target: "es2022",
  minify: true,
});

// The same Windows-safe resolver this repo ships: no .cmd shim, no shell.
execFileSync(resolveDebugger(), ["--read-file", js, "--bin", DEFAULT_SCRIPT_CKB_JS_VM, "--", "-c", bc]);

console.log(`bytecode: ${bc} (${statSync(bc).size} bytes)`);

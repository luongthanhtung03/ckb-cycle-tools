/**
 * ckb-js-vm's start-up floor: how much of the ~14.3M cycles the session lock
 * spends on a run that rejects straight away depends on the script, and how
 * much is the VM itself?
 *
 * Every variant below exits as soon as it gets control. Each one runs in the
 * same transaction as the "args too short" scenario of compare.mjs (the lock
 * on input 0, 79 bytes of user args), with the variant's bytecode as the code
 * cell, under the same ckb-js-vm (ckb-testtool's) and the same ckb-debugger.
 * CKB-VM is deterministic, so one run per variant is the number.
 *
 *   - ckb-js-vm alone: `-h` (ELF load, prints usage, no JS engine) and
 *     `-e ""` (QuickJS runtime and context, an empty script, no cell loaded).
 *   - minimal scripts: exit(10), a bare throw, an empty module.
 *   - the minimal exit(10) plus dead code: one never-called function holding
 *     generated functions, sized to about 1, 10, 30, 50 and 100 KB of bytecode.
 *     QuickJS has to read all of it, but none of it runs.
 *   - the minimal exit(10) plus `import { HighLevel } from "@ckb-js-std/core"`:
 *     what initialising the standard library module costs.
 *   - the session lock as compare.mjs builds it, unminified, and with
 *     `currentCycles()` markers at the first JS statement and after
 *     @ckb-js-std/core has initialised.
 *   - the lock's bad-args check alone, written against the raw bindings
 *     (no @ckb-js-std/core): the same rejection without the library.
 *   - JS source instead of bytecode in the code cell, if this ckb-js-vm takes it.
 *
 * Run: npm run build && node benchmarks/session-lock/floor.mjs
 * Writes benchmarks/session-lock/dist/floor/results.json and the "Startup floor
 * vs bytecode size" section of RESULTS.md (compare.mjs keeps that section).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDebugger } from "../../dist/index.js";
import { buildScenario, SCENARIOS } from "./scenarios.mjs";

const require = createRequire(import.meta.url);
const { ccc } = require("@ckb-ccc/core");
const { DEFAULT_SCRIPT_CKB_JS_VM, Verifier } = require("ckb-testtool");
const esbuild = require("esbuild");

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "floor");
mkdirSync(out, { recursive: true });
const DEBUGGER = resolveDebugger();
const VM = DEFAULT_SCRIPT_CKB_JS_VM;
const BINDINGS = "@ckb-js-std/bindings";
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9+]+/g, "-").replace(/^-|-$/g, "");

/** Runs ckb-debugger and reads its exit code, cycles and script log. */
function debug(args) {
  const r = spawnSync(DEBUGGER, args, { encoding: "utf8" });
  const text = `${r.stdout}\n${r.stderr}`;
  const cycles = text.match(/All cycles: (\d+)/);
  const code = text.match(/Run result: (-?\d+)/);
  const log = [...text.matchAll(/Script log: (.*)/g)].map((m) => m[1].trim());
  if (!cycles) throw new Error(`no cycle count from ckb-debugger ${args.join(" ")}:\n${text}`);
  return { cycles: Number(cycles[1]), code: code ? Number(code[1]) : null, log };
}

/** QuickJS bytecode, compiled by this ckb-js-vm exactly as build-js.mjs does. */
function compile(name, js) {
  const src = join(out, `${slug(name)}.js`);
  const bc = join(out, `${slug(name)}.bc`);
  writeFileSync(src, js);
  execFileSync(DEBUGGER, ["--read-file", src, "--bin", VM, "--", "-c", bc]);
  return bc;
}

/**
 * esbuild with build-js.mjs's settings; `contents` is the entry module's source.
 * `patch` rewrites js/index.ts in memory (markers only; the file is not touched).
 */
async function bundle(contents, { minify = true, patch, markModules = false } = {}) {
  const plugins = [];
  if (patch)
    plugins.push({
      name: "mark-lock",
      setup(build) {
        build.onLoad({ filter: /[\\/]js[\\/]index\.ts$/ }, (a) => ({ contents: patch(readFileSync(a.path, "utf8")), loader: "ts" }));
      },
    });
  // A marker at the end of every @ckb-js-std/core module: modules run in
  // dependency order, so the gap before each marker is that module's top-level code.
  if (markModules)
    plugins.push({
      name: "mark-core-modules",
      setup(build) {
        build.onLoad({ filter: /@ckb-js-std[\\/]core[\\/]dist[\\/].*\.js$/ }, (a) => {
          const rel = a.path.replace(/\\/g, "/").replace(/.*@ckb-js-std\/core\/dist\//, "");
          const src = readFileSync(a.path, "utf8");
          return {
            contents: `${src}\nimport * as __m from "${BINDINGS}";\n__m.debug("@mark core/${rel} " + __m.currentCycles());\n`,
            loader: "js",
          };
        });
      },
    });
  const r = await esbuild.build({
    plugins,
    stdin: { contents, resolveDir: out, sourcefile: "entry.js", loader: "ts" },
    write: false,
    platform: "neutral",
    bundle: true,
    external: [BINDINGS],
    target: "es2022",
    minify,
  });
  return r.outputFiles[0].text;
}

const argsTooShort = SCENARIOS.find((s) => s.name === "args too short");
/** The "args too short" transaction with `code` (bytecode or source) as the script. */
function runInTx(name, code) {
  const { resource, tx } = buildScenario(argsTooShort, (resource, tx, userArgs) => {
    const vm = resource.deployCell(ccc.hexFrom(readFileSync(VM)), tx, false);
    const bc = resource.deployCell(ccc.hexFrom(code), tx, false);
    const args = "0x0000" + bc.codeHash.slice(2) + ccc.hexFrom(ccc.hashTypeToBytes(bc.hashType)).slice(2) + userArgs.slice(2);
    return ccc.Script.from({ codeHash: vm.codeHash, hashType: vm.hashType, args });
  });
  const file = join(out, `${slug(name)}.tx.json`);
  writeFileSync(file, JSON.stringify(Verifier.from(resource, tx).txFile()));
  return debug(["--tx-file", file, "--script", "input.0.lock"]);
}

const mark = (label) => `b.debug("@mark ${label} " + b.currentCycles());`;
const MIN_EXIT = `import * as b from "${BINDINGS}";\nb.exit(10);\n`;

/**
 * Dead code: one function nobody calls, holding `n` generated functions with
 * their own names, numbers and strings (so QuickJS cannot share atoms between them).
 */
function deadCode(n) {
  let s = "function __pad(){";
  for (let i = 0; i < n; i++)
    s +=
      `function p${i}(a,b){let x=a*${i}+b,s="pad string ${i}";` +
      `if(x>${i * 7 + 3})return s+x;for(let j=0;j<b;j++)x^=j<<${i % 13};` +
      `return {k${i}:x,v:[a,b,${i}]}}`;
  s += `return [${Array.from({ length: n }, (_, i) => `p${i}`).join(",")}]}\n`;
  return s;
}
const padded = (n) => `import * as b from "${BINDINGS}";\nglobalThis.__pad=__pad;\nb.exit(10);\n${deadCode(n)}`;

/** The lock's first check (args length) against the raw bindings: a molecule Script's args field. */
const RAW_REJECT = `import * as b from "${BINDINGS}";
const s = new DataView(b.loadScript());
const argsAt = s.getUint32(12, true);
const len = s.getUint32(argsAt, true) - 35;
b.exit(len === 80 || len === 112 || len === 128 || len === 160 ? 0 : 10);
`;

const rows = [];
const add = (row) => {
  rows.push(row);
  const f = (n) => (n === null || n === undefined ? "" : n.toLocaleString("en-US"));
  console.log(`${row.name.padEnd(46)} ${f(row.bytes).padStart(8)} B ${f(row.cycles).padStart(12)}  exit ${row.code}  ${row.marks ? JSON.stringify(row.marks) : ""}`);
};
const marksOf = (log) =>
  Object.fromEntries(log.filter((l) => l.startsWith("@mark ")).map((l) => l.slice(6).split(" ")).map(([k, v]) => [k, Number(v)]));

/** Every variant must exit the way it is written to, or its cycles mean nothing. */
function bytecodeVariant(name, js, extra = {}, expect = 10) {
  const bc = compile(name, js);
  const r = runInTx(name, readFileSync(bc));
  if (r.code !== expect) throw new Error(`${name}: exit ${r.code}, expected ${expect}\n${r.log.join("\n")}`);
  add({ name, kind: "bytecode", bytes: statSync(bc).size, sourceBytes: Buffer.byteLength(js), ...r, marks: marksOf(r.log), ...extra });
  return bc;
}

// --- ckb-js-vm on its own --------------------------------------------------
{
  const h = debug(["--bin", VM, "--", "-h"]);
  add({ name: "ckb-js-vm -h (no JS engine)", kind: "bare", bytes: null, ...h });
  const e = debug(["--bin", VM, "--", "-e", ""]);
  add({ name: 'ckb-js-vm -e "" (engine, empty script)', kind: "bare", bytes: 0, ...e });
}

// --- minimal scripts --------------------------------------------------------
bytecodeVariant("min-exit", MIN_EXIT);
bytecodeVariant("min-exit-marked", `import * as b from "${BINDINGS}";\n${mark("start")}\nb.exit(10);\n`);
bytecodeVariant("min-throw", `throw new Error("x");\n`, {}, -7);
bytecodeVariant("min-empty", `export {};\n`, {}, 0);

// --- dead code ------------------------------------------------------------
// Bytes per generated function, from a small build, to aim at each target size.
const base = statSync(compile("pad-probe-0", padded(0))).size;
const probe = statSync(compile("pad-probe-100", padded(100))).size;
const per = (probe - base) / 100;
for (const kb of [1, 10, 30, 50, 100]) {
  const n = Math.max(1, Math.round((kb * 1024 - base) / per));
  bytecodeVariant(`pad-${kb}k`, padded(n), { functions: n });
}

// --- the standard library ---------------------------------------------------
bytecodeVariant(
  "min-exit+core",
  await bundle(`import * as b from "${BINDINGS}";\nimport { HighLevel } from "@ckb-js-std/core";\nif (!HighLevel.loadScript) throw 0;\nb.exit(10);\n`),
);
// The lock's first library call: decode the running script with HighLevel.loadScript().
bytecodeVariant(
  "min-exit+core, HighLevel.loadScript()",
  await bundle(
    `import * as b from "${BINDINGS}";\nimport { HighLevel } from "@ckb-js-std/core";\n${mark("core")}\n` +
      `const args = HighLevel.loadScript().args;\n${mark("loaded")}\nb.exit(args.byteLength === 0 ? 0 : 10);\n`,
  ),
);

// --- the session lock -----------------------------------------------------
const lockEntry = join(here, "js", "index.ts").replace(/\\/g, "/");
const lock = await bundle(`import "${lockEntry}";`);
bytecodeVariant("session-lock (as compare.mjs)", lock);
bytecodeVariant("session-lock, not minified", await bundle(`import "${lockEntry}";`, { minify: false }));
// Markers: the first JS statement, then after @ckb-js-std/core has initialised. ES
// modules run in import order, so start.js runs first and core.js after the library.
writeFileSync(join(out, "mark-start.js"), `import * as b from "${BINDINGS}";\n${mark("start")}\n`);
writeFileSync(
  join(out, "mark-core.js"),
  `import * as b from "${BINDINGS}";\nimport { HighLevel } from "@ckb-js-std/core";\nif (!HighLevel.loadScript) throw 0;\n${mark("core")}\n`,
);
// Inside the lock (in memory only): when main() starts, after its loadScript(), at the rejection.
const lockMarks = (src) => {
  const at = (from, to) => {
    if (!src.includes(from)) throw new Error(`marker anchor not found in js/index.ts: ${from}`);
    src = src.replace(from, to);
  };
  const m = (label) => `bindings.debug("@mark ${label} " + bindings.currentCycles());`;
  at("function main(): number {", `function main(): number {\n  ${m("main")}`);
  at("const all = bytes(HighLevel.loadScript().args);", `const all = bytes(HighLevel.loadScript().args);\n  ${m("args")}`);
  at("default: return Error.BadArgs;", `default: ${m("reject")} return Error.BadArgs;`);
  return src;
};
bytecodeVariant(
  "session-lock, marked",
  await bundle(`import "./mark-start.js";\nimport "./mark-core.js";\nimport "${lockEntry}";`, { patch: lockMarks }),
);
bytecodeVariant(
  "session-lock, per-module marks",
  await bundle(`import "./mark-start.js";\nimport "${lockEntry}";`, { patch: lockMarks, markModules: true }),
);
// The lock's two top-level BigInt limits, 2n ** 64n - 1n and 2n ** 128n - 1n, written
// as hex literals instead (in memory; js/index.ts is unchanged). Same values.
const LIMITS = { 64: ["2n ** 64n - 1n", `0x${"f".repeat(16)}n`], 128: ["2n ** 128n - 1n", `0x${"f".repeat(32)}n`] };
const literalLimits = (...bits) => (src) => {
  for (const [from, to] of bits.map((b) => LIMITS[b])) {
    if (!src.includes(from)) throw new Error(`not found in js/index.ts: ${from}`);
    src = src.replace(from, to);
  }
  return src;
};
bytecodeVariant("session-lock, U128_MAX as a hex literal", await bundle(`import "${lockEntry}";`, { patch: literalLimits(128) }));
bytecodeVariant("session-lock, both BigInt limits as hex literals", await bundle(`import "${lockEntry}";`, { patch: literalLimits(64, 128) }));
bytecodeVariant("bad-args check, raw bindings only", RAW_REJECT);

// --- JS source in the code cell ---------------------------------------------
for (const [name, js] of [
  ["source: min-exit", MIN_EXIT],
  ["source: session-lock", lock],
]) {
  const r = runInTx(name, Buffer.from(js));
  if (r.code !== 10) throw new Error(`${name}: exit ${r.code}, expected 10\n${r.log.join("\n")}`);
  add({ name, kind: "source", bytes: Buffer.byteLength(js), ...r, marks: marksOf(r.log), note: r.log.slice(0, 3).join(" | ") });
}

const debuggerVersion = spawnSync(DEBUGGER, ["--version"], { encoding: "utf8" }).stdout.trim();
const vmSha = createHash("sha256").update(readFileSync(VM)).digest("hex");
const testtool = JSON.parse(readFileSync(join(dirname(require.resolve("ckb-testtool")), "..", "package.json"), "utf8")).version;
writeFileSync(join(out, "results.json"), JSON.stringify({ debugger: debuggerVersion, vm: VM, vmSha256: vmSha, testtool, rows }, null, 1));

// --- the RESULTS.md section -------------------------------------------------
const row = (name) => {
  const r = rows.find((x) => x.name === name);
  if (!r) throw new Error(`no row ${name}`);
  return r;
};
const fmt = (n) => n.toLocaleString("en-US");
const B = (n) => (n === null || n === undefined ? "–" : `${fmt(n)} B`);
const minExit = row("min-exit");
const lockRow = row("session-lock (as compare.mjs)");
const pad100 = row("pad-100k");
const perByte = (pad100.cycles - minExit.cycles) / (pad100.bytes - minExit.bytes);
const tableRow = (label, r) => `| ${label} | ${B(r.bytes)} | ${fmt(r.cycles)} |`;

const marked = row("session-lock, marked");
const m = marked.marks;
const vmStart = row("min-exit-marked").marks.start;
const share = (n) => `${((n / marked.cycles) * 100).toFixed(0)}%`;
const stages = [
  ["ckb-js-vm starts QuickJS and reaches the first statement of a 149-byte script", vmStart],
  [`reading the lock's ${fmt(lockRow.bytes)} B of bytecode and setting up the module`, m.start - vmStart],
  ["@ckb-js-std/core's top-level code (building its molecule codecs)", m.core - m.start],
  ["the lock's own top-level code: `2n ** 64n - 1n` and `2n ** 128n - 1n`", m.main - m.core],
  ["`HighLevel.loadScript()`, decoding the script", m.args - m.main],
  ["the args-length check and the exit", marked.cycles - m.args],
];

const perModule = row("session-lock, per-module marks").marks;
const moduleSteps = [];
let prev = perModule.start;
for (const [k, v] of Object.entries(perModule)) {
  if (!k.startsWith("core/")) continue;
  moduleSteps.push([k.slice(5), v - prev]);
  prev = v;
}
const bigModules = moduleSteps.filter(([, c]) => c >= 300_000);
const otherModules = moduleSteps.filter(([, c]) => c < 300_000);

/** From the 8 Oct comparison in RESULTS.md: floor 13,916,789 -> 14,273,079, bytecode 29,118 -> 30,917 B. */
const OCT8_FLOOR_INCREASE = 14_273_079 - 13_916_789;
const OCT8_BYTES_INCREASE = 30_917 - 29_118;
const literal128 = row("session-lock, U128_MAX as a hex literal");
const literalBoth = row("session-lock, both BigInt limits as hex literals");
const raw = row("bad-args check, raw bindings only");
const withCore = row("min-exit+core");
const srcLock = row("source: session-lock");

const section = `<!-- floor:start (written by floor.mjs; compare.mjs keeps it) -->
## Startup floor vs bytecode size

Generated by \`node benchmarks/session-lock/floor.mjs\`. Every script here exits as
soon as it runs, in the same transaction as "args too short" above, under the
same ckb-js-vm (the one ckb-testtool ${testtool} ships, ${fmt(BigInt(statSync(VM).size))} B, sha256
\`${vmSha.slice(0, 16)}…\`) and ${debuggerVersion}. CKB-VM is deterministic, so each
number is one run.

| Script, exiting at once | Bytecode | Cycles |
|---|---:|---:|
${tableRow("ckb-js-vm `-h`: ELF loaded, no JS engine", row("ckb-js-vm -h (no JS engine)"))}
${tableRow('ckb-js-vm `-e ""`: engine up, empty script, no code cell', row('ckb-js-vm -e "" (engine, empty script)'))}
${tableRow("`exit(10)`", minExit)}
${tableRow("`throw new Error()`", row("min-throw"))}
${tableRow("empty module", row("min-empty"))}
${[1, 10, 30, 50, 100].map((kb) => tableRow(`\`exit(10)\` + ~${kb} KB of never-called code`, row(`pad-${kb}k`))).join("\n")}
${tableRow("`exit(10)` + `import { HighLevel } from \"@ckb-js-std/core\"`", withCore)}
${tableRow("**session lock, bad args** (as compare.mjs builds it)", lockRow)}
${tableRow("session lock, not minified", row("session-lock, not minified"))}
${tableRow("session lock, `U128_MAX` as a hex literal", literal128)}
${tableRow("session lock, both BigInt limits as hex literals", literalBoth)}
${tableRow("the lock's bad-args check on the raw bindings, no library", raw)}
| \`exit(10)\` as JS source in the code cell | ${B(row("source: min-exit").bytes)} source | ${fmt(row("source: min-exit").cycles)} |
| session lock as JS source in the code cell | ${B(srcLock.bytes)} source | ${fmt(srcLock.cycles)} |

**Bytecode size alone is cheap.** Dead code costs about ${perByte.toFixed(0)} cycles per byte
of bytecode to load (never run): 100 KB adds ${fmt(pad100.cycles - minExit.cycles)}. At the lock's size that is
about ${fmt(Math.round(perByte * lockRow.bytes))}. A tiny script that exits at once costs
${fmt(row("min-empty").cycles)} to ${fmt(row("min-throw").cycles)} however it exits: that is the real floor of ckb-js-vm here.

**What the lock's ${fmt(lockRow.cycles)} is made of.** The same rejection, with
\`bindings.currentCycles()\` markers added in memory (they add ${fmt(marked.cycles - lockRow.cycles)} cycles;
js/index.ts is unchanged):

| Stage | Cycles | Share |
|---|---:|---:|
${stages.map(([s, c]) => `| ${s} | ${fmt(c)} | ${share(c)} |`).join("\n")}
| **total** | **${fmt(marked.cycles)}** | |

Inside @ckb-js-std/core, the modules whose top-level code costs most (a marker
after every module, about 7,500 cycles each included):
${bigModules.map(([k, c]) => `\`${k}\` ${fmt(c)}`).join(", ")}; the other ${otherModules.length} modules
${fmt(otherModules.reduce((a, [, c]) => a + c, 0))} together.

So for this lock about a quarter of the floor is ckb-js-vm itself, a fifth is
loading the bytecode, and over half is JavaScript that runs before \`main()\`:
the library's module initialisation and two BigInt constants. Without the
library, the same args check exits at ${fmt(raw.cycles)}. Writing the two limits
as hex literals saves ${fmt(lockRow.cycles - literalBoth.cycles)}. The 128-bit one, added with token sessions,
alone costs ${fmt(lockRow.cycles - literal128.cycles)}: that, not the larger bytecode, is most of the
${fmt(OCT8_FLOOR_INCREASE)} start-up increase since 8 Oct noted above (the
${fmt(OCT8_BYTES_INCREASE)} extra bytes account for about ${fmt(Math.round(perByte * OCT8_BYTES_INCREASE))}).
Reading the lock's bytecode (${fmt(m.start - vmStart)}) also costs more than the same size of dead code;
the difference is most likely module setup, such as linking imports and creating
the top-level functions.
Shipping JS source instead of bytecode costs ${fmt(srcLock.cycles)}: compiling on chain is
far more expensive than reading bytecode.

ckb-debugger's flamegraph cannot split this further: the ckb-js-vm binary is
stripped, so the whole run is one frame.
<!-- floor:end -->
`;
const resultsPath = join(here, "RESULTS.md");
const results = readFileSync(resultsPath, "utf8");
const block = /<!-- floor:start[\s\S]*?<!-- floor:end -->\n/;
writeFileSync(resultsPath, block.test(results) ? results.replace(block, section) : `${results.trimEnd()}\n\n${section}`);
console.log(`\n${section}`);

/**
 * ckb-js-vm vs Rust, like for like: one session lock, two implementations, the
 * same scenarios. Each scenario runs the lock in the real CKB-VM via
 * ckb-testtool + ckb-debugger and records the lock's exit code and cycles.
 *
 * The comparison is only meaningful if both implementations make the same
 * decisions, so it exits non-zero unless every scenario returns the expected
 * code from BOTH implementations.
 *
 * Rust binary: $SESSION_LOCK_BIN, default ../ckb-session-kit/contracts/session-lock/…
 * JS bytecode: benchmarks/session-lock/dist/session-lock.bc (npm run bench:build)
 *
 * Writes benchmarks/session-lock/RESULTS.md.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDebugger } from "../../dist/index.js";
import { buildScenario, SCENARIOS } from "./scenarios.mjs";

// One CommonJS copy of CCC for everything, so ckb-testtool's classes and ours match.
const require = createRequire(import.meta.url);
const { ccc } = require("@ckb-ccc/core");
const { DEFAULT_SCRIPT_CKB_JS_VM, Verifier } = require("ckb-testtool");

const here = dirname(fileURLToPath(import.meta.url));
const RUST_BIN =
  process.env.SESSION_LOCK_BIN ??
  join(here, "../../../ckb-session-kit/contracts/session-lock/target/riscv64imac-unknown-none-elf/release/session-lock");
const JS_BC = join(here, "dist", "session-lock.bc");

/** The ckb-session-kit commit CI builds the Rust lock from (.github/workflows/ci.yml). */
const SESSION_KIT_COMMIT = "49227cd";

/**
 * The 8 Oct run (session-kit 3745aa0, rules 10-15 only), for comparison. Its
 * 20 scenarios are still the first 20 here, unchanged.
 */
const OCT8 = {
  rustBytes: 4_344n,
  jsBytes: 29_118n,
  rustAccepted: 12_263n,
  jsAccepted: 14_573_318n,
  rustFloor: 2_318n,
  jsFloor: 13_916_789n,
  median: 2027,
};

for (const [what, path] of [["Rust binary", RUST_BIN], ["JS bytecode (npm run bench:build)", JS_BC]]) {
  if (!existsSync(path)) {
    console.error(`missing ${what}: ${path}`);
    process.exit(2);
  }
}
// ckb-testtool spawns ckb-debugger by bare name: put the real executable's directory on PATH.
process.env.PATH = `${dirname(resolveDebugger())}${delimiter}${process.env.PATH ?? ""}`;

/** How each implementation turns user args into a lock script inside a mock tx. */
const IMPLEMENTATIONS = {
  rust(resource, tx, userArgs) {
    const code = resource.deployCell(ccc.hexFrom(readFileSync(RUST_BIN)), tx, false);
    return ccc.Script.from({ codeHash: code.codeHash, hashType: code.hashType, args: userArgs });
  },
  js(resource, tx, userArgs) {
    const vm = resource.deployCell(ccc.hexFrom(readFileSync(DEFAULT_SCRIPT_CKB_JS_VM)), tx, false);
    const bc = resource.deployCell(ccc.hexFrom(readFileSync(JS_BC)), tx, false);
    // ckb-js-vm args: 2 flag bytes | bytecode code hash | its hash type | user args
    const args =
      "0x0000" + bc.codeHash.slice(2) + ccc.hexFrom(ccc.hashTypeToBytes(bc.hashType)).slice(2) + userArgs.slice(2);
    return ccc.Script.from({ codeHash: vm.codeHash, hashType: vm.hashType, args });
  },
};

async function run(impl, scenario) {
  const { resource, tx, session } = buildScenario(scenario, IMPLEMENTATIONS[impl]);
  // ckb-testtool's `codeHash` filter matches the full script hash.
  const [result] = await Verifier.from(resource, tx).verify({ codeHash: session.hash() });
  return { code: result.scriptErrorCode, cycles: BigInt(result.stdoutCycles) };
}

const fmt = (n) => n.toLocaleString("en-US");
const rows = [];
let failures = 0;
for (const s of SCENARIOS) {
  const rust = await run("rust", s);
  const js = await run("js", s);
  const ok = rust.code === s.expected && js.code === s.expected;
  if (!ok) failures++;
  rows.push({ ...s, rust, js, ok });
}

const ratio = (r) => Number(r.js.cycles) / Number(r.rust.cycles);
const medianRatio = (rs) => {
  const sorted = rs.map(ratio).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0n) / BigInt(xs.length);
const accepted = (rs) => rs.filter((r) => r.expected === 0);
const meanAccepted = (rs, impl) => meanOf(accepted(rs).map((r) => r[impl].cycles));
// The bad-args scenarios return almost immediately, so they measure what it costs
// to start each runtime at all.
const floor = (rs, impl) => rs.reduce((m, r) => (r[impl].cycles < m ? r[impl].cycles : m), rs[0][impl].cycles);

const plain = rows.filter((r) => r.mode === "plain");
const token = rows.filter((r) => r.mode === "token");
const original = rows.filter((r) => !r.added);
const rustBytes = BigInt(statSync(RUST_BIN).size);
const jsBytes = BigInt(statSync(JS_BC).size);
const vmBytes = BigInt(statSync(DEFAULT_SCRIPT_CKB_JS_VM).size);
const rustOk = meanAccepted(plain, "rust");
const jsOk = meanAccepted(plain, "js");
const rustFloor = floor(rows, "rust");
const jsFloor = floor(rows, "js");
const jsLogic = jsOk - jsFloor;

const pct = (now, then) => {
  const p = ((Number(now) - Number(then)) / Number(then)) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(p > -1 && p < 1 ? 1 : 0)}%`;
};
const expected = (r) => (r.expected === 0 ? "accept" : `reject ${r.expected}`);
const table = (rs) =>
  [
    "| Scenario | Expected | Rust | ckb-js-vm | × |",
    "|---|---|---:|---:|---:|",
    ...rs.map(
      (r) =>
        `| ${r.name} | ${expected(r)}` +
        ` | ${r.rust.code === r.expected ? "" : `**got ${r.rust.code}** `}${fmt(r.rust.cycles)}` +
        ` | ${r.js.code === r.expected ? "" : `**got ${r.js.code}** `}${fmt(r.js.cycles)}` +
        ` | ${ratio(r).toFixed(0)} |`,
    ),
  ].join("\n");

const o = {
  rustOk: meanAccepted(original, "rust"),
  jsOk: meanAccepted(original, "js"),
  rustFloor: floor(original, "rust"),
  jsFloor: floor(original, "js"),
  median: medianRatio(original),
};

const report = `# Session lock: Rust vs ckb-js-vm

Generated by \`npm run bench:session-lock\` against the ckb-session-kit lock at
commit ${SESSION_KIT_COMMIT} (rules and error codes 10-20). Both implementations
run the same ${SCENARIOS.length} scenarios in the real CKB-VM (ckb-testtool + ckb-debugger) and
${failures === 0 ? "**agree on every accept/reject decision**" : `**disagree on ${failures} scenario(s)**`}.
The scenarios cover plain CKB sessions (${plain.length}) and token sessions (${token.length}); the
token is a stand-in type script, since the lock only compares its type hash and
reads the amount from the cell data.

| | Rust | ckb-js-vm |
|---|---:|---:|
| Code deployed | ${fmt(rustBytes)} B binary | ${fmt(jsBytes)} B bytecode + ${fmt(vmBytes)} B VM |
| Mean cycles, accepted plain CKB spends | ${fmt(rustOk)} | ${fmt(jsOk)} |
| Mean cycles, accepted token spends | ${fmt(meanAccepted(token, "rust"))} | ${fmt(meanAccepted(token, "js"))} |
| Median ratio, all scenarios | 1× | ${medianRatio(rows).toFixed(0)}× |
| Cheapest run (bad args: start-up cost) | ${fmt(rustFloor)} | ${fmt(jsFloor)} |

**Where the ckb-js-vm cycles go.** The cheapest run — args rejected almost
immediately — still costs ${fmt(jsFloor)} cycles: that is the price of starting
the JavaScript VM and loading the bytecode. An accepted plain CKB spend averages
${fmt(jsOk)}, so the lock's own logic is only about ${fmt(jsLogic)} of it
(${((Number(jsLogic) / Number(jsOk)) * 100).toFixed(0)}%). For a script this small, ckb-js-vm's cost is almost
entirely fixed start-up, and the logic itself runs at roughly
${(Number(jsLogic) / Number(rustOk - rustFloor)).toFixed(0)}× the Rust logic's cycles.

## Compared with the 8 Oct version

The 8 Oct run measured session-kit 3745aa0, before the lock gained no
splitting (16), the key-cell rule (17), no type scripts (18) and token sessions
(19, 20). Its 20 scenarios are the first 20 below, unchanged, so this is the
same transactions against both versions:

| Same 20 scenarios | Rust, 8 Oct | Rust, now | ckb-js-vm, 8 Oct | ckb-js-vm, now |
|---|---:|---:|---:|---:|
| Code deployed | ${fmt(OCT8.rustBytes)} B | ${fmt(rustBytes)} B | ${fmt(OCT8.jsBytes)} B | ${fmt(jsBytes)} B |
| Mean cycles, accepted spends | ${fmt(OCT8.rustAccepted)} | ${fmt(o.rustOk)} (${pct(o.rustOk, OCT8.rustAccepted)}) | ${fmt(OCT8.jsAccepted)} | ${fmt(o.jsOk)} (${pct(o.jsOk, OCT8.jsAccepted)}) |
| Cheapest run (start-up cost) | ${fmt(OCT8.rustFloor)} | ${fmt(o.rustFloor)} | ${fmt(OCT8.jsFloor)} | ${fmt(o.jsFloor)} |
| Median ratio | | | ${OCT8.median}× | ${o.median.toFixed(0)}× |

For ckb-js-vm, most of the increase is start-up: the 8 Oct TypeScript port,
rebuilt with today's toolchain, still costs exactly its 8 Oct cycles, so the
extra ${fmt(o.jsFloor - OCT8.jsFloor)} cycles before any logic runs come from loading the larger
bytecode. The Rust lock grew more in relative terms (a larger binary to load,
and the extra checks on every output), which is why the ratio fell.

## The 8 Oct scenarios

${table(original)}

## Added: plain CKB rules (16, 17, 18)

${table(rows.filter((r) => r.added && r.mode === "plain"))}

## Added: token sessions (128/160-byte args)

${table(token)}

Cycles are the session lock's own script group only. For scale, a standard
secp256k1 lock costs about 1.6M cycles per transaction.
`;
writeFileSync(join(here, "RESULTS.md"), report);
console.log(report);
if (failures) {
  // On GitHub Actions, name each disagreement in the run's annotations.
  if (process.env.GITHUB_ACTIONS)
    for (const r of rows.filter((r) => !r.ok))
      console.log(`::error title=${r.name}::expected ${r.expected}, Rust returned ${r.rust.code}, ckb-js-vm returned ${r.js.code}`);
  console.error(`${failures} scenario(s) did not return the expected code from both implementations`);
  process.exit(1);
}

/**
 * ckb-js-vm vs Rust, like for like: one session lock, two implementations, the
 * same 20 scenarios. Each scenario runs the lock in the real CKB-VM via
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

// One CommonJS copy of CCC for everything, so ckb-testtool's classes and ours match.
const require = createRequire(import.meta.url);
const { ccc } = require("@ckb-ccc/core");
const { DEFAULT_SCRIPT_ALWAYS_SUCCESS, DEFAULT_SCRIPT_CKB_JS_VM, Resource, Verifier } = require("ckb-testtool");

const here = dirname(fileURLToPath(import.meta.url));
const RUST_BIN =
  process.env.SESSION_LOCK_BIN ??
  join(here, "../../../ckb-session-kit/contracts/session-lock/target/riscv64imac-unknown-none-elf/release/session-lock");
const JS_BC = join(here, "dist", "session-lock.bc");

for (const [what, path] of [["Rust binary", RUST_BIN], ["JS bytecode (npm run bench:build)", JS_BC]]) {
  if (!existsSync(path)) {
    console.error(`missing ${what}: ${path}`);
    process.exit(2);
  }
}
// ckb-testtool spawns ckb-debugger by bare name: put the real executable's directory on PATH.
process.env.PATH = `${dirname(resolveDebugger())}${delimiter}${process.env.PATH ?? ""}`;

const CKB = 100_000_000n;
const u64le = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return ccc.hexFrom(b).slice(2);
};

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

const E = { OK: 0, BAD_ARGS: 10, NOT_AUTHORIZED: 11, OUTFLOW: 12, RECIPIENT: 13, RATE_LIMITED: 14 };
const KEY = { lock: "key", capacity: 61n * CKB };
const S500 = { lock: "session", capacity: 500n * CKB };
const relative = (n) => (1n << 63n) | n;
const pay100 = [{ lock: "stranger", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY];

/** The same scenarios as ckb-session-kit/test/session-lock.test.ts. */
const SCENARIOS = [
  ["neither owner nor session key present", E.NOT_AUTHORIZED, { max: 100n }, [S500], [{ lock: "stranger", capacity: 500n * CKB }]],
  ["stranger input posing as authorisation", E.NOT_AUTHORIZED, { max: 100n }, [S500, { lock: "stranger", capacity: 61n * CKB }], [{ lock: "stranger", capacity: 561n * CKB }]],
  ["owner sweeps, ignoring the scope", E.OK, { max: 100n, recipient: true, interval: 10n }, [S500, { lock: "owner", capacity: 61n * CKB }], [{ lock: "stranger", capacity: 561n * CKB }]],
  ["spend exactly max_per_tx", E.OK, { max: 100n }, [S500, KEY], pay100],
  ["one shannon over max_per_tx", E.OUTFLOW, { max: 100n }, [S500, KEY], [{ lock: "stranger", capacity: 100n * CKB + 1n }, { lock: "session", capacity: 400n * CKB - 1n }, KEY]],
  ["fee counted as outflow", E.OUTFLOW, { max: 100n }, [S500, KEY], [{ lock: "stranger", capacity: 100n * CKB }, { lock: "session", capacity: 350n * CKB }, KEY]],
  ["sums every session cell", E.OUTFLOW, { max: 100n }, [{ lock: "session", capacity: 300n * CKB }, { lock: "session", capacity: 300n * CKB }, KEY], [{ lock: "stranger", capacity: 200n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY]],
  ["change to another session is not change", E.OUTFLOW, { max: 100n }, [S500, KEY], [{ lock: "other-session", capacity: 500n * CKB }, KEY]],
  ["top-up is zero outflow", E.OK, { max: 100n }, [{ lock: "session", capacity: 100n * CKB }, { lock: "key", capacity: 461n * CKB }], [{ lock: "session", capacity: 500n * CKB }, KEY]],
  ["pays the allowed recipient", E.OK, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "recipient", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY]],
  ["returns funds to the owner", E.OK, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "owner", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY]],
  ["pays anyone else", E.RECIPIENT, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "stranger", capacity: 61n * CKB }, { lock: "session", capacity: 439n * CKB }, KEY]],
  ["aged input passes the rate limit", E.OK, { max: 100n, interval: 10n }, [{ ...S500, since: relative(10n) }, KEY], pay100],
  ["no since under a rate limit", E.RATE_LIMITED, { max: 100n, interval: 10n }, [S500, KEY], pay100],
  ["input one block too young", E.RATE_LIMITED, { max: 100n, interval: 10n }, [{ ...S500, since: relative(9n) }, KEY], pay100],
  ["absolute since", E.RATE_LIMITED, { max: 100n, interval: 10n }, [{ ...S500, since: 10_000_000n }, KEY], pay100],
  ["relative epoch since", E.RATE_LIMITED, { max: 100n, interval: 10n }, [{ ...S500, since: (1n << 63n) | (1n << 61n) | 10n }, KEY], pay100],
  ["args too short", E.BAD_ARGS, { raw: 79 }, [S500, KEY], [KEY]],
  ["args between valid lengths", E.BAD_ARGS, { raw: 96 }, [S500, KEY], [KEY]],
  ["args too long", E.BAD_ARGS, { raw: 113 }, [S500, KEY], [KEY]],
].map(([name, expected, scope, inputs, outputs]) => ({ name, expected, scope, inputs, outputs }));

async function run(impl, scenario) {
  const resource = Resource.default();
  const tx = ccc.Transaction.default();
  const always = resource.deployCell(ccc.hexFrom(readFileSync(DEFAULT_SCRIPT_ALWAYS_SUCCESS)), tx, false);
  const plain = (args) => ccc.Script.from({ codeHash: always.codeHash, hashType: always.hashType, args });
  const owner = plain("0x01");
  const key = plain("0x02");
  const recipient = plain("0x03");
  const { scope } = scenario;
  const userArgs =
    scope.raw !== undefined
      ? "0x" + "00".repeat(scope.raw)
      : "0x" +
        owner.hash().slice(2) +
        key.hash().slice(2) +
        u64le(scope.max * CKB) +
        u64le(scope.interval ?? 0n) +
        (scope.recipient ? recipient.hash().slice(2) : "");
  const session = IMPLEMENTATIONS[impl](resource, tx, userArgs);
  const other = ccc.Script.from({ ...session, args: session.args.slice(0, -2) + (session.args.endsWith("ff") ? "00" : "ff") });
  const locks = { session, owner, key, recipient, stranger: plain("0x04"), "other-session": other };

  for (const c of scenario.inputs) {
    const input = Resource.createCellInput(resource.mockCell(locks[c.lock], undefined, "0x", c.capacity));
    if (c.since !== undefined) input.since = c.since;
    tx.inputs.push(input);
  }
  for (const c of scenario.outputs) {
    tx.outputs.push(Resource.createCellOutput(locks[c.lock], undefined, c.capacity));
    tx.outputsData.push("0x");
  }
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

const ratios = rows.map((r) => Number(r.js.cycles) / Number(r.rust.cycles)).sort((a, b) => a - b);
const median = ratios[Math.floor(ratios.length / 2)];
const accepted = rows.filter((r) => r.expected === 0);
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0n) / BigInt(xs.length);
const rustOk = meanOf(accepted.map((r) => r.rust.cycles));
const jsOk = meanOf(accepted.map((r) => r.js.cycles));
const vmBytes = statSync(DEFAULT_SCRIPT_CKB_JS_VM).size;
// The bad-args scenarios return almost immediately, so they measure what it costs
// to start each runtime at all.
const floor = (impl) => rows.reduce((m, r) => (r[impl].cycles < m ? r[impl].cycles : m), rows[0][impl].cycles);
const jsFloor = floor("js");
const jsLogic = jsOk - jsFloor;

const table = [
  "| Scenario | Expected | Rust | ckb-js-vm | × |",
  "|---|---|---:|---:|---:|",
  ...rows.map(
    (r) =>
      `| ${r.name} | ${r.expected === 0 ? "accept" : `reject ${r.expected}`}` +
      ` | ${r.rust.code === r.expected ? "" : `**got ${r.rust.code}** `}${fmt(r.rust.cycles)}` +
      ` | ${r.js.code === r.expected ? "" : `**got ${r.js.code}** `}${fmt(r.js.cycles)}` +
      ` | ${(Number(r.js.cycles) / Number(r.rust.cycles)).toFixed(0)} |`,
  ),
].join("\n");

const report = `# Session lock: Rust vs ckb-js-vm

Generated by \`npm run bench:session-lock\`. Both implementations run the same
${SCENARIOS.length} scenarios in the real CKB-VM (ckb-testtool + ckb-debugger) and
${failures === 0 ? "**agree on every accept/reject decision**" : `**disagree on ${failures} scenario(s)**`}.

| | Rust | ckb-js-vm |
|---|---:|---:|
| Code deployed | ${fmt(BigInt(statSync(RUST_BIN).size))} B binary | ${fmt(BigInt(statSync(JS_BC).size))} B bytecode + ${fmt(BigInt(vmBytes))} B VM |
| Mean cycles, accepted spends | ${fmt(rustOk)} | ${fmt(jsOk)} |
| Median ratio, all scenarios | 1× | ${median.toFixed(0)}× |
| Cheapest run (bad args: start-up cost) | ${fmt(floor("rust"))} | ${fmt(jsFloor)} |

**Where the ckb-js-vm cycles go.** The cheapest run — args rejected almost
immediately — still costs ${fmt(jsFloor)} cycles: that is the price of starting
the JavaScript VM and loading the bytecode. An accepted spend averages
${fmt(jsOk)}, so the lock's own logic is only about ${fmt(jsLogic)} of it
(${((Number(jsLogic) / Number(jsOk)) * 100).toFixed(0)}%). For a script this small, ckb-js-vm's cost is almost
entirely fixed start-up, and the logic itself runs at roughly
${(Number(jsLogic) / Number(rustOk - floor("rust"))).toFixed(0)}× the Rust logic's cycles.

${table}

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

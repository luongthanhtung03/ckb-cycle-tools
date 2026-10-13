/**
 * The 20 session-lock scenarios, and how to build each as a ckb-testtool
 * transaction. Shared by compare.mjs (Rust vs ckb-js-vm) and mocks.mjs (the
 * mock transactions the PR cycle report replays).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// One CommonJS copy of CCC for everything, so ckb-testtool's classes and ours match.
const require = createRequire(import.meta.url);
const { ccc } = require("@ckb-ccc/core");
const { DEFAULT_SCRIPT_ALWAYS_SUCCESS, Resource } = require("ckb-testtool");

export const CKB = 100_000_000n;
const u64le = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return ccc.hexFrom(b).slice(2);
};

export const E = { OK: 0, BAD_ARGS: 10, NOT_AUTHORIZED: 11, OUTFLOW: 12, RECIPIENT: 13, RATE_LIMITED: 14 };
const KEY = { lock: "key", capacity: 61n * CKB };
const S500 = { lock: "session", capacity: 500n * CKB };
const relative = (n) => (1n << 63n) | n;
const pay100 = [{ lock: "stranger", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY];

/** The same scenarios as ckb-session-kit/test/session-lock.test.ts. */
export const SCENARIOS = [
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

/**
 * Builds one scenario: deploys always-success for the plain locks, asks
 * `deploySession(resource, tx, userArgs)` for the session lock script, and adds
 * the inputs and outputs. Returns the transaction and the session lock.
 */
export function buildScenario(scenario, deploySession) {
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
  const session = deploySession(resource, tx, userArgs);
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
  return { resource, tx, session };
}

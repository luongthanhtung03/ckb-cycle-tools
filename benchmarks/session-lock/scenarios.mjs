/**
 * The session-lock scenarios, and how to build each as a ckb-testtool
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
/** u128 LE, no 0x: an xUDT amount (RFC 0052). */
const u128le = (v) => u64le(v & ((1n << 64n) - 1n)) + u64le(v >> 64n);

export const E = {
  OK: 0,
  BAD_ARGS: 10,
  NOT_AUTHORIZED: 11,
  OUTFLOW: 12,
  RECIPIENT: 13,
  RATE_LIMITED: 14,
  OVERFLOW: 15,
  TOO_MANY_CHANGE_CELLS: 16,
  KEY_CELL_GREW: 17,
  TYPED_CELL: 18,
  TOKEN_DATA: 19,
  TOKEN_OUTFLOW: 20,
};
const KEY = { lock: "key", capacity: 61n * CKB };
const KEY_FEE = { lock: "key", capacity: 61n * CKB - 1000n };
const S500 = { lock: "session", capacity: 500n * CKB };
const relative = (n) => (1n << 63n) | n;
const pay100 = [{ lock: "stranger", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY];
const mature = (capacity) => ({ lock: "session", capacity, since: relative(10n) });
const huge = { lock: "key", capacity: (1n << 63n) + 1n };
const T = 1_000_000n; // token units
const tokenCell = (lock, amount, capacity = 200n * CKB) => ({ lock, capacity, token: amount });
const tok = { max: 100n, token: 10n * T };
const tokRecipient = { ...tok, recipient: true };

/**
 * The 20 scenarios measured on 8 Oct (session-kit 3745aa0), unchanged, so the
 * like-for-like comparison runs the same transactions against both lock
 * versions. One rename: 113-byte args used to be "args too long", but 128 and
 * 160 bytes are valid lengths now.
 */
const ORIGINAL = [
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
  ["args between the plain and token lengths", E.BAD_ARGS, { raw: 113 }, [S500, KEY], [KEY]],
];

/** Plain-CKB scenarios for the rules the lock gained after 3745aa0. */
const ADDED_PLAIN = [
  // Rule 3, no splitting (16).
  ["splitting one session cell into two", E.TOO_MANY_CHANGE_CELLS, { max: 100n, interval: 10n }, [mature(500n * CKB), KEY], [{ lock: "session", capacity: 250n * CKB }, { lock: "session", capacity: 250n * CKB }, KEY]],
  ["a payment that also splits the change", E.TOO_MANY_CHANGE_CELLS, { max: 100n }, [S500, KEY], [{ lock: "stranger", capacity: 100n * CKB }, { lock: "session", capacity: 200n * CKB }, { lock: "session", capacity: 200n * CKB }, KEY]],
  ["merging two mature cells into one", E.OK, { max: 100n, interval: 10n }, [mature(300n * CKB), mature(300n * CKB), KEY], [{ lock: "stranger", capacity: 100n * CKB }, { lock: "session", capacity: 500n * CKB }, KEY]],
  ["two mature cells over max_per_tx together", E.OUTFLOW, { max: 100n, interval: 10n }, [mature(300n * CKB), mature(300n * CKB), KEY], [{ lock: "stranger", capacity: 200n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY]],
  ["owner may split", E.OK, { max: 100n, interval: 10n }, [S500, { lock: "owner", capacity: 100n * CKB }], [{ lock: "session", capacity: 250n * CKB }, { lock: "session", capacity: 250n * CKB }, { lock: "owner", capacity: 100n * CKB }]],
  // Rule 4, the key cell may not grow (17).
  ["1 CKB top-up of the recipient's cell", E.OK, { max: 100n, recipient: true }, [S500, { lock: "recipient", capacity: 200n * CKB }, KEY], [{ lock: "recipient", capacity: 201n * CKB }, { lock: "session", capacity: 499n * CKB }, KEY]],
  ["recipient top-up over max_per_tx", E.OUTFLOW, { max: 100n, recipient: true }, [S500, { lock: "recipient", capacity: 61n * CKB }, KEY], [{ lock: "recipient", capacity: 162n * CKB }, { lock: "session", capacity: 399n * CKB }, KEY]],
  ["key cell comes back smaller (paid the fee)", E.OK, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "recipient", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY_FEE]],
  ["session funds moved into the key cell", E.KEY_CELL_GREW, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "session", capacity: 400n * CKB }, { lock: "key", capacity: 161n * CKB }]],
  ["new key-locked cell funded from the session", E.KEY_CELL_GREW, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "key", capacity: 100n * CKB }, { lock: "session", capacity: 400n * CKB }, KEY]],
  ["owner mode ignores key cells overflowing u64", E.OK, { max: 100n, recipient: true }, [S500, huge, huge, { lock: "owner", capacity: 61n * CKB }], [{ lock: "owner", capacity: 561n * CKB }]],
  // Rules 4 and 5, no type scripts (18).
  ["paying the recipient in a typed cell", E.TYPED_CELL, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "recipient", capacity: 100n * CKB, typed: true }, { lock: "session", capacity: 400n * CKB }, KEY]],
  ["change given a type script", E.TYPED_CELL, { max: 100n, recipient: true }, [S500, KEY], [{ lock: "session", capacity: 500n * CKB, typed: true }, KEY_FEE]],
  ["spending a typed session cell", E.TYPED_CELL, { max: 100n }, [{ lock: "session", capacity: 200n * CKB, typed: true }, KEY], [{ lock: "session", capacity: 200n * CKB }, { lock: "stranger", capacity: 61n * CKB, typed: true }]],
  ["owner sweeps a typed cell", E.OK, { max: 100n }, [{ lock: "session", capacity: 200n * CKB, typed: true }, { lock: "owner", capacity: 61n * CKB }], [{ lock: "owner", capacity: 261n * CKB, typed: true }]],
  ["plain session refuses a token cell", E.TYPED_CELL, { max: 100n }, [tokenCell("session", 100n * T), KEY], [{ lock: "session", capacity: 200n * CKB }, KEY]],
  // Args: 128 and 160 bytes are valid now, so the gaps around them are tested.
  ["args between the two token lengths", E.BAD_ARGS, { raw: 144 }, [S500, KEY], [KEY]],
  ["args too long", E.BAD_ARGS, { raw: 161 }, [S500, KEY], [KEY]],
];

/** Token sessions (128/160-byte args, errors 19 and 20), as in ckb-session-kit's token tests. */
const ADDED_TOKEN = [
  ["token: pays max_per_tx_token", E.OK, tokRecipient, [tokenCell("session", 100n * T), tokenCell("recipient", 5n * T), KEY], [tokenCell("recipient", 15n * T), tokenCell("session", 90n * T), KEY_FEE]],
  ["token: one unit over max_per_tx_token", E.TOKEN_OUTFLOW, tok, [tokenCell("session", 100n * T), tokenCell("stranger", 0n), KEY], [tokenCell("stranger", 10n * T + 1n), tokenCell("session", 90n * T - 1n), KEY]],
  ["token: sums every session cell", E.TOKEN_OUTFLOW, tok, [tokenCell("session", 50n * T), tokenCell("session", 50n * T), KEY], [tokenCell("stranger", 20n * T, 1n * CKB), tokenCell("session", 80n * T, 399n * CKB), KEY]],
  ["token: all tokens dropped into untyped change", E.TOKEN_OUTFLOW, tok, [tokenCell("session", 100n * T), KEY], [tokenCell("stranger", 100n * T, 1n * CKB), { lock: "session", capacity: 199n * CKB }, KEY]],
  ["token: spends the last tokens, untyped change", E.OK, tok, [tokenCell("session", 10n * T), KEY], [tokenCell("stranger", 10n * T, 1n * CKB), { lock: "session", capacity: 199n * CKB }, KEY]],
  ["token: no amount read from untyped change", E.TOKEN_OUTFLOW, tok, [tokenCell("session", 100n * T), KEY], [tokenCell("stranger", 100n * T, 1n * CKB), { lock: "session", capacity: 199n * CKB, data: "0x" + "ff".repeat(16) }, KEY]],
  ["token: top-up is zero outflow", E.OK, tok, [tokenCell("session", 10n * T), tokenCell("key", 50n * T, 261n * CKB)], [tokenCell("session", 60n * T, 400n * CKB), KEY]],
  ["token: CKB outflow still capped", E.OUTFLOW, tok, [tokenCell("session", 100n * T, 500n * CKB), KEY], [{ lock: "stranger", capacity: 101n * CKB }, tokenCell("session", 100n * T, 399n * CKB), KEY]],
  ["token: change typed by another script", E.TYPED_CELL, tok, [tokenCell("session", 100n * T), KEY], [{ lock: "session", capacity: 200n * CKB, typed: true }, tokenCell("stranger", 100n * T, 1n * CKB), KEY_FEE]],
  ["token: session cell typed by another script", E.TYPED_CELL, tok, [{ lock: "session", capacity: 200n * CKB, typed: true }, KEY], [{ lock: "session", capacity: 200n * CKB }, KEY]],
  ["token: change with extension data", E.TOKEN_DATA, tok, [tokenCell("session", 100n * T), KEY], [{ lock: "session", capacity: 200n * CKB, token: 100n * T, data: "0x" + u128le(100n * T) + "00" }, KEY]],
  ["token: change under 16 data bytes", E.TOKEN_DATA, tok, [tokenCell("session", 100n * T), KEY], [{ lock: "session", capacity: 200n * CKB, token: 0n, data: "0x" + "00".repeat(15) }, tokenCell("stranger", 100n * T), KEY]],
  ["token: input under 16 data bytes", E.TOKEN_DATA, tok, [{ lock: "session", capacity: 200n * CKB, token: 0n, data: "0x00" }, KEY], [{ lock: "session", capacity: 200n * CKB }, KEY]],
  ["token: moved into the key cell", E.KEY_CELL_GREW, tokRecipient, [tokenCell("session", 100n * T), KEY], [tokenCell("session", 95n * T), { ...KEY_FEE, token: 5n * T }]],
  ["token: key output with short data", E.TOKEN_DATA, tokRecipient, [tokenCell("session", 100n * T), KEY], [tokenCell("session", 95n * T), tokenCell("recipient", 5n * T), { ...KEY_FEE, token: 0n, data: "0x01" }]],
  ["token: key cell keeps the tokens it held", E.OK, tokRecipient, [tokenCell("session", 100n * T), tokenCell("key", 3n * T, 200n * CKB)], [tokenCell("session", 95n * T), tokenCell("recipient", 5n * T), tokenCell("key", 3n * T, 200n * CKB - 1000n)]],
  ["token: recipient paid in a foreign-typed cell", E.TYPED_CELL, tokRecipient, [tokenCell("session", 100n * T), KEY], [{ lock: "recipient", capacity: 100n * CKB, typed: true }, tokenCell("session", 100n * T, 100n * CKB), KEY]],
  ["token: splitting the change", E.TOO_MANY_CHANGE_CELLS, tok, [tokenCell("session", 100n * T, 400n * CKB), KEY], [tokenCell("session", 50n * T), tokenCell("session", 50n * T), KEY]],
  ["token: amounts overflowing u128", E.OVERFLOW, tok, [tokenCell("session", (1n << 128n) - 1n), tokenCell("session", 1n), KEY], [tokenCell("session", 0n), KEY]],
  ["token: owner sweeps malformed and foreign-typed cells", E.OK, tokRecipient, [{ lock: "session", capacity: 200n * CKB, token: 0n, data: "0x01" }, { lock: "session", capacity: 200n * CKB, typed: true }, { lock: "owner", capacity: 61n * CKB }], [{ lock: "owner", capacity: 461n * CKB }]],
];

const shape = (mode, added) => ([name, expected, scope, inputs, outputs]) => ({ name, expected, scope, inputs, outputs, mode, added });

/**
 * Every scenario: the 8 Oct set, then plain-CKB and token scenarios for the
 * newer rules. The same cases as ckb-session-kit/test/session-lock.test.ts.
 */
export const SCENARIOS = [
  ...ORIGINAL.map(shape("plain", false)),
  ...ADDED_PLAIN.map(shape("plain", true)),
  ...ADDED_TOKEN.map(shape("token", true)),
];

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
  // Stand-ins: the session's token, and a type script the session key controls.
  const tokenType = plain("0x7171");
  const anyType = plain("0x7070");
  const typeOf = (c) => (c.typed ? anyType : c.token !== undefined ? tokenType : undefined);
  const dataOf = (c) => c.data ?? (c.token !== undefined ? "0x" + u128le(c.token) : "0x");
  const { scope } = scenario;
  const userArgs =
    scope.raw !== undefined
      ? "0x" + "00".repeat(scope.raw)
      : "0x" +
        owner.hash().slice(2) +
        key.hash().slice(2) +
        u64le(scope.max * CKB) +
        u64le(scope.interval ?? 0n) +
        (scope.token !== undefined ? tokenType.hash().slice(2) + u128le(scope.token) : "") +
        (scope.recipient ? recipient.hash().slice(2) : "");
  const session = deploySession(resource, tx, userArgs);
  const other = ccc.Script.from({ ...session, args: session.args.slice(0, -2) + (session.args.endsWith("ff") ? "00" : "ff") });
  const locks = { session, owner, key, recipient, stranger: plain("0x04"), "other-session": other };

  for (const c of scenario.inputs) {
    const input = Resource.createCellInput(resource.mockCell(locks[c.lock], typeOf(c), dataOf(c), c.capacity));
    if (c.since !== undefined) input.since = c.since;
    tx.inputs.push(input);
  }
  for (const c of scenario.outputs) {
    tx.outputs.push(Resource.createCellOutput(locks[c.lock], typeOf(c), c.capacity));
    tx.outputsData.push(dataOf(c));
  }
  return { resource, tx, session };
}

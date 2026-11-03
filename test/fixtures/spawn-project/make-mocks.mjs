/**
 * Writes the spawn fixture's mock transactions with ckb-testtool (the npm
 * one), as a test suite would leave them: both binaries deployed the way
 * ckb-testtool deploys them (a code cell with a Type ID type script), the
 * parent used as a lock by its type hash, and its input cell's data naming the
 * child by its data2 hash, as a match cell names its game. Each mock embeds
 * the stripped builds in build/release. The Rust tests in tests/ build the
 * same transactions on Rust ckb-testtool. Run from the repo root after
 * `make build`:
 *   node test/fixtures/spawn-project/make-mocks.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// One CommonJS copy of CCC, so ckb-testtool's classes and ours match.
const require = createRequire(import.meta.url);
const { ccc } = require("@ckb-ccc/core");
const { Resource, Verifier } = require("ckb-testtool");

const here = dirname(fileURLToPath(import.meta.url));
const bin = (name) => ccc.hexFrom(readFileSync(join(here, "build", "release", name)));

function spend(child, rounds) {
  const resource = Resource.default();
  const tx = ccc.Transaction.default();
  const parent = resource.deployCell(bin("spawn-parent"), tx, true);
  resource.deployCell(bin("spawn-child"), tx, true);
  const lock = ccc.Script.from({ codeHash: parent.codeHash, hashType: parent.hashType, args: "0x" });
  const data = ccc.hexFrom(ccc.bytesConcat(child, [rounds]));
  tx.inputs.push(Resource.createCellInput(resource.mockCell(lock, undefined, data, 1000n)));
  tx.outputs.push(Resource.createCellOutput(lock, undefined, 1000n));
  tx.outputsData.push("0x");
  return Verifier.from(resource, tx).txFile();
}

const child = ccc.hashCkb(bin("spawn-child"));
const SCENARIOS = {
  "tests.test_spawn_light": spend(child, 1),
  "tests.test_spawn_heavy": spend(child, 40),
  "tests.test_spawn_child_rejects": spend(child, 0xff),
  "tests.test_spawn_no_such_child": spend(`0x${"de".repeat(32)}`, 1),
};
const out = join(here, "mocks");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const [name, mock] of Object.entries(SCENARIOS)) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(mock, null, 1) + "\n");
  console.log(`wrote mocks/${name}.json`);
}

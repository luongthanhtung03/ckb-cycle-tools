/**
 * Writes a few session-lock scenarios as ckb-debugger mock transactions, for
 * the PR cycle report (cycles.json at the repo root): a pull request that
 * changes the ckb-js-vm session lock shows what that did to its cycles.
 *
 * ckb-js-vm and the session-lock bytecode are deployed with a type script
 * (hash_type "type"), so cycles.json can swap in the bytecode built from the
 * commit under test without changing any script in the transaction. Their cell
 * data is left empty here: cycles.json always supplies both (the bytecode from
 * `npm run bench:build`, ckb-js-vm from ckb-testtool), which keeps each file a
 * few kilobytes instead of 800.
 *
 * Run after changing the scenarios: node benchmarks/session-lock/mocks.mjs
 * It prints the code hashes cycles.json matches the two binaries by.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenario, SCENARIOS } from "./scenarios.mjs";

const require = createRequire(import.meta.url);
const { ccc } = require("@ckb-ccc/core");
const { Verifier } = require("ckb-testtool");

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "mocks");
mkdirSync(out, { recursive: true });

/** A stand-in for the bytecode while building: only its cell's type script matters. */
const PLACEHOLDER = "0x00";

const PICK = [
  "spend exactly max_per_tx",
  "one shannon over max_per_tx",
  "pays the allowed recipient",
  "aged input passes the rate limit",
  "args too short",
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let hashes;
for (const name of PICK) {
  const scenario = SCENARIOS.find((s) => s.name === name);
  let vm, bc;
  const { resource, tx } = buildScenario(scenario, (resource, tx, userArgs) => {
    vm = resource.deployCell(PLACEHOLDER, tx, true);
    bc = resource.deployCell(PLACEHOLDER, tx, true);
    const args = "0x0000" + bc.codeHash.slice(2) + ccc.hexFrom(ccc.hashTypeToBytes(bc.hashType)).slice(2) + userArgs.slice(2);
    return ccc.Script.from({ codeHash: vm.codeHash, hashType: vm.hashType, args });
  });
  const mock = Verifier.from(resource, tx).txFile();
  for (const dep of mock.mock_info.cell_deps) if (dep.data === PLACEHOLDER) dep.data = "0x";
  writeFileSync(join(out, `${slug(name)}.json`), JSON.stringify(mock, null, 1) + "\n");
  const now = { "ckb-js-vm": vm.codeHash, "session-lock-js": bc.codeHash };
  if (hashes && JSON.stringify(hashes) !== JSON.stringify(now)) throw new Error("code hashes differ between scenarios");
  hashes = now;
  console.log(`wrote mocks/${slug(name)}.json  (expects ${scenario.expected === 0 ? "accept" : `exit ${scenario.expected}`})`);
}
console.log("code hashes for cycles.json:", hashes);

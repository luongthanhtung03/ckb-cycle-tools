/**
 * Records real testnet transactions as mock transactions, with what the native
 * ckb-debugger and the node said about them, for test/wasm.test.ts. The test
 * then replays them in the WebAssembly ckb-debugger, offline, and requires the
 * same numbers. Read-only: it only fetches.
 *
 * Usage: npm run build && node scripts/record-wasm-fixture.mjs
 * Needs a native ckb-debugger (found as the CLI finds it).
 *
 * Brotli with a 16 MB window: both transactions carry the same 1 MB secp256k1
 * data cell, stored once that way.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { resolveDebugger } from "../dist/debugger.js";
import { planReplay, replayGroups } from "../dist/replay.js";

const TXS = [
  // Counter update: secp256k1 lock + a ckb-js-vm type script, VM v2.
  { hash: "0x64f695a23416d9a7b2d34bb7025140c90991b82e9f1dea98e103bc13a72b77ac" },
  // A 2023 transaction: type scripts must run on VM v1. testnet.ckb.dev does
  // not record its cycles (0x0); testnet.ckbapp.dev does.
  { hash: "0x6f31e5b87eef65c3ffb60ee6cf60554e4626afa2bbe18a63f9c9ac19b85a26f0", rpcUrl: "https://testnet.ckbapp.dev/" },
];
const OUT = "test/fixtures/replay-testnet.json.br";

const debuggerPath = resolveDebugger();
const version = execFileSync(debuggerPath, ["--version"], { encoding: "utf8" }).trim();
const dir = mkdtempSync(join(tmpdir(), "record-"));
const records = [];
try {
  for (const { hash, rpcUrl } of TXS) {
    const plan = await planReplay(hash, rpcUrl ? { rpcUrl } : {});
    if (plan.nodeCycles === undefined) throw new Error(`${hash}: the node did not record cycles`);
    const txFile = join(dir, "tx.json");
    writeFileSync(txFile, JSON.stringify(plan.mock));
    const native = await replayGroups(
      plan,
      async (args) => {
        try {
          return execFileSync(debuggerPath, args, { encoding: "utf8", maxBuffer: 64 << 20 });
        } catch (e) {
          return (e.stdout ?? "") + (e.stderr ?? "");
        }
      },
      { txFile, debugger: version },
    );
    if (native.measuredCycles !== plan.nodeCycles) throw new Error(`${hash}: native ckb-debugger does not match the node`);
    records.push({
      hash,
      status: plan.status,
      nodeCycles: String(plan.nodeCycles),
      scriptVersion: plan.scriptVersion,
      mock: plan.mock,
      native: {
        debugger: version,
        groups: native.groups.map((g) => ({ selector: g.selector, result: g.result, cycles: String(g.cycles), logs: g.logs })),
      },
    });
    console.log(`${hash}: ${native.groups.length} groups, ${native.measuredCycles} cycles (node ${plan.nodeCycles}), VM v${plan.scriptVersion}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const json = Buffer.from(JSON.stringify(records));
const packed = brotliCompressSync(json, {
  params: {
    [constants.BROTLI_PARAM_LGWIN]: 24,
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_SIZE_HINT]: json.length,
  },
});
writeFileSync(OUT, packed);
console.log(`${OUT}: ${packed.length} bytes (${json.length} uncompressed), recorded with ${version}`);
process.exit(0);

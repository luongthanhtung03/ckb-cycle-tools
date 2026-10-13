/**
 * The WebAssembly ckb-debugger (what the web page runs) against the native one
 * (what the CLI runs), offline: real testnet transactions recorded by
 * scripts/record-wasm-fixture.mjs, replayed through wasmRunner, must give the
 * node's total and the native debugger's per-group cycles, results and logs.
 */
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import type { MockTransaction } from "../src/mock.js";
import { groupsOf, nodeVerdict, replayGroups, type ReplayPlan } from "../src/replay.js";
import { runWasmDebugger, WASM_TX_FILE, wasmDebuggerVersion, wasmRunner } from "../src/wasm.js";

interface Recorded {
  hash: string;
  status: string;
  nodeCycles: string;
  scriptVersion: 0 | 1 | 2;
  mock: MockTransaction;
  native: { debugger: string; groups: { selector: string; result: number; cycles: string; logs: string[] }[] };
}

const records: Recorded[] = JSON.parse(
  brotliDecompressSync(readFileSync("test/fixtures/replay-testnet.json.br")).toString("utf8"),
);

let module: WebAssembly.Module;
beforeAll(async () => {
  // ckb-testtool does not export the file, so it is read by path (as the demo copies it).
  module = await WebAssembly.compile(readFileSync("node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm"));
});

describe("WebAssembly ckb-debugger", () => {
  it("reports its version", async () => {
    expect(await wasmDebuggerVersion(module)).toMatch(/^ckb-debugger \d+\.\d+\.\d+/);
  });

  it("reports a missing tx file as a failed run, not a thrown error", async () => {
    const r = await runWasmDebugger(module, ["--tx-file", "/nope.json", "--script", "input.0.lock"]);
    expect(r.exitCode).not.toBe(0);
  });

  it.each(records.map((r) => [r.hash.slice(0, 10), r] as const))(
    "%s: same groups, results, cycles and logs as the native debugger, and the node's total",
    async (_, rec) => {
      const plan: ReplayPlan = {
        hash: rec.hash,
        status: rec.status,
        nodeCycles: BigInt(rec.nodeCycles),
        mock: rec.mock,
        groups: groupsOf(rec.mock),
        scriptVersion: rec.scriptVersion,
        network: "testnet",
        rpcUrl: "(recorded)",
      };
      const tx = new TextEncoder().encode(JSON.stringify(rec.mock));
      const seen: string[] = [];
      const profile = await replayGroups(plan, wasmRunner(module, tx), {
        txFile: WASM_TX_FILE,
        debugger: "wasm",
        onGroup: (_, s) => seen.push(s),
      });
      expect(profile.groups.map((g) => ({ selector: g.selector, result: g.result, cycles: String(g.cycles), logs: g.logs }))).toEqual(
        rec.native.groups,
      );
      expect(seen).toEqual(rec.native.groups.map((g) => g.selector));
      expect(profile.measuredCycles).toBe(BigInt(rec.nodeCycles));
      expect(nodeVerdict(profile)).toBe("match");
    },
    120_000,
  );
});

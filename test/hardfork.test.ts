/**
 * Replays across the CKB-VM hardforks (scripts/hardfork-check.ts, compat/HARDFORK.md).
 *
 * Offline: the real mainnet and testnet transactions recorded next to Mirana
 * (VM v1) and Meepo (VM v2), replayed from their saved mock transactions with
 * the WebAssembly ckb-debugger, must give the native debugger's per-group
 * cycles at every `--script-version`, and at the version the replay chooses the
 * recorded total. No network.
 *
 * Online, only with CKB_HARDFORK_NETWORK=1: the same transactions planned again
 * through the public nodes, as `ckb-cycles <hash>` plans them, must choose the
 * recorded VM version and rebuild the recorded mock.
 */
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { scriptVersionAt, type MockTransaction } from "../src/mock.js";
import { groupsOf, planReplay, selectorFor, type ReplayPlan } from "../src/replay.js";
import { WASM_TX_FILE, wasmRunner } from "../src/wasm.js";
import {
  judge,
  oracleOf,
  packFixture,
  runAtVersion,
  unpackFixture,
  vmOf,
  type HardforkData,
  type NodeCycles,
  type PackedFixture,
} from "../scripts/hardfork-lib.js";

const data = JSON.parse(readFileSync("compat/hardfork.json", "utf8")) as HardforkData;
const fixture = unpackFixture(
  JSON.parse(brotliDecompressSync(readFileSync("test/fixtures/hardfork-mocks.json.br")).toString("utf8")) as PackedFixture,
);
const VERSIONS = [0, 1, 2] as const;

describe("hardfork-lib", () => {
  it("selects the VM version per hash type as the node does", () => {
    expect([vmOf("data", 2), vmOf("data1", 0), vmOf("data2", 1), vmOf("type", 1)]).toEqual([0, 1, 2, 1]);
  });

  it("takes the node's total when it has one, and treats 0x0 as unknown", () => {
    const a = { url: "a", tx: "0x0", block: "0x0" };
    const b = { url: "b", tx: null, block: "0x10" };
    expect(oracleOf({ nodes: [a, b], explorerCycles: "16" })).toEqual({ oracle: "node", oracleUrl: "b", total: 16n, explorerAgrees: true });
    expect(oracleOf({ nodes: [a, { ...b, tx: "0x7" }], explorerCycles: "16" })).toMatchObject({ oracleUrl: "b", total: 7n, explorerAgrees: false });
    expect(oracleOf({ nodes: [a, { ...b, block: null }], explorerCycles: "7" })).toEqual({ oracle: "explorer", total: 7n });
    expect(oracleOf({ nodes: [a], explorerCycles: null })).toEqual({ oracle: null, total: undefined });
  });

  const base = {
    network: "mainnet",
    fork: "mirana",
    side: "after",
    kind: "type",
    hash: "0x" + "a".repeat(64),
    block: 1,
    epoch: 5414,
    index: 1,
    forkEpoch: 5414,
    nodes: [{ url: "https://mainnet.ckb.dev/", tx: "0x0", block: "0x0" }] as NodeCycles[],
    explorerCycles: "30",
    scriptVersion: 1,
  } as const;
  const group = (c: [number, number, number], result = [0, 0, 0]) => ({
    role: "lock" as const,
    codeHash: "0x" + "b".repeat(64),
    hashType: "type",
    selector: "input.0.lock",
    vm: 1 as const,
    runs: { "0": { cycles: String(c[0]), result: result[0] }, "1": { cycles: String(c[1]), result: result[1] }, "2": { cycles: String(c[2]), result: result[2] } },
  });

  it("judges the sum at the chosen version and lists the versions that would also match", () => {
    const r = judge({ ...base, groups: [group([20, 10, 10]), group([20, 20, 20])] });
    expect(r).toMatchObject({ sum: "30", verdict: "match", oracle: "explorer", total: "30", versionsMatching: [1, 2] });
    expect(judge({ ...base, explorerCycles: "40", groups: [group([20, 10, 10]), group([20, 20, 20])] })).toMatchObject({
      verdict: "mismatch",
      versionsMatching: [0],
    });
  });

  it("never calls a rejecting replay a match, whatever its cycles", () => {
    const r = judge({ ...base, groups: [group([10, 10, 10], [0, 1, 0]), group([20, 20, 20])] });
    expect(r).toMatchObject({ verdict: "mismatch", versionsMatching: [0, 2] });
  });

  it("packs large cell data once and unpacks it unchanged", () => {
    const big = "0x" + "ab".repeat(5000);
    const mock = {
      mock_info: {
        inputs: [{ input: {}, output: {}, data: big, header: null }],
        cell_deps: [{ cell_dep: {}, output: {}, data: big, header: null }],
        header_deps: [],
      },
      tx: { outputs_data: ["0x", big] },
    } as unknown as MockTransaction;
    const rec = { ...judge({ ...base, groups: [] }), mock };
    const packed = packFixture([rec]);
    expect(Object.keys(packed.blobs)).toHaveLength(1);
    expect(JSON.stringify(packed).length).toBeLessThan(big.length * 2);
    expect(unpackFixture(packed)).toEqual([rec]);
  });
});

describe("recorded hardfork replays", () => {
  it("covers both forks on mainnet, before and after each", () => {
    for (const fork of ["mirana", "meepo"] as const) {
      for (const side of ["before", "after"] as const) {
        expect(data.cases.some((c) => c.network === "mainnet" && c.fork === fork && c.side === side)).toBe(true);
      }
    }
    expect(fixture.map((c) => c.hash)).toEqual(data.cases.map((c) => c.hash));
  });

  it.each(data.cases.map((c) => [c.hash.slice(0, 10), c] as const))(
    "%s: the block's epoch is on its side of the fork, and the replay chose that epoch's VM",
    (_, c) => {
      expect(c.side === "before" ? c.epoch < c.forkEpoch : c.epoch >= c.forkEpoch).toBe(true);
      const f = data.meta.forks[c.network];
      expect(scriptVersionAt([f.mirana.epoch, f.meepo.epoch], c.epoch)).toBe(c.scriptVersion);
      for (const g of c.groups) expect(g.vm).toBe(vmOf(g.hashType, c.scriptVersion));
    },
  );

  it("matches every total a node recorded, at the chosen version only, and the explorer agrees with each", () => {
    const withNode = data.cases.filter((c) => c.oracle === "node");
    expect(withNode.length).toBeGreaterThan(0);
    for (const c of withNode) {
      expect(c.verdict, c.hash).toBe("match");
      expect(c.versionsMatching, c.hash).toEqual([c.scriptVersion]);
      expect(c.explorerAgrees, c.hash).toBe(true);
    }
  });

  // No node asked has cycles for blocks before Mirana; the explorer's number for
  // them is the VM v1 sum, not the v0 one the node ran (see HARDFORK.md). Pinned
  // here so that a change on either side shows up.
  it("before Mirana: no node total, and the explorer's equals the v1 sum, not the chosen v0", () => {
    const before = data.cases.filter((c) => c.fork === "mirana" && c.side === "before");
    expect(before.length).toBeGreaterThan(0);
    for (const c of before) {
      expect(c.oracle, c.hash).toBe("explorer");
      expect(c.scriptVersion, c.hash).toBe(0);
      expect(c.versionsMatching, c.hash).toEqual([1]);
    }
    expect(data.cases.filter((c) => c.oracle !== "node").every((c) => c.fork === "mirana" && c.side === "before")).toBe(true);
  });
});

describe("hardfork replays, offline, with the WebAssembly ckb-debugger", () => {
  let module: WebAssembly.Module;
  beforeAll(async () => {
    module = await WebAssembly.compile(readFileSync("node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm"));
  });

  it.each(fixture.map((c) => [`${c.network} ${c.fork} ${c.side} ${c.kind} ${c.hash.slice(0, 10)}`, c] as const))(
    "%s: the native debugger's cycles at every --script-version, and the total at the chosen one",
    async (_, rec) => {
      const tx = new TextEncoder().encode(JSON.stringify(rec.mock));
      const groups = groupsOf(rec.mock);
      expect(groups.map((g) => [g.hashType, selectorFor(g)])).toEqual(rec.groups.map((g) => [g.hashType, g.selector]));
      for (const v of VERSIONS) {
        const key = String(v) as "0" | "1" | "2";
        const plan: ReplayPlan = {
          hash: rec.hash,
          status: "committed",
          mock: rec.mock,
          groups: groupsOf(rec.mock),
          scriptVersion: v,
          network: rec.network,
          rpcUrl: "(recorded)",
        };
        const runs = await runAtVersion(plan, v, wasmRunner(module, tx), { txFile: WASM_TX_FILE, debugger: "wasm" });
        expect(runs.map((r) => ({ cycles: r.cycles, result: r.result, failed: r.error !== undefined }))).toEqual(
          rec.groups.map((g) => ({ cycles: g.runs[key].cycles, result: g.runs[key].result, failed: g.runs[key].error !== undefined })),
        );
        const sum = runs.reduce((s, r) => s + BigInt(r.cycles), 0n);
        expect(String(sum)).toBe(rec.sums[key]);
        if (v === rec.scriptVersion && rec.verdict === "match") expect(String(sum)).toBe(rec.total);
      }
    },
    300_000,
  );
});

describe.skipIf(!process.env.CKB_HARDFORK_NETWORK)("hardfork replays, planned again through the public nodes", () => {
  it.each(fixture.map((c) => [`${c.network} ${c.hash.slice(0, 10)}`, c] as const))(
    "%s: same VM version and the same mock transaction",
    async (_, rec) => {
      const plan = await planReplay(rec.hash, { network: rec.network, timeoutMs: 60_000 });
      expect(plan.scriptVersion).toBe(rec.scriptVersion);
      expect(plan.mock).toEqual(rec.mock);
    },
    180_000,
  );
});

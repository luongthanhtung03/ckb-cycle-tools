/**
 * The web page's split of a spawning group (children.ts profileSpawns over
 * wasm.ts wasmFiles), against test/fixtures/spawn-project: with a fake
 * debugger, and with the WebAssembly ckb-debugger 1.1.2 the page runs when it
 * is in the cache (`npm run compat -- fetch`, or the demo's copy-wasm script).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { MAX_CHILD_PROFILES, olderDebuggerNote, profileSpawns, serverExit, SERVER_EXIT_NOTE, type FlameChild } from "../src/children.js";
import { foldedTotal } from "../src/flame.js";
import type { MockTransaction } from "../src/mock.js";
import { SERVER_EXIT_NOTE as REPORT_SERVER_EXIT_NOTE } from "../src/report.js";
import { debuggerArgs, groupsOf, replayGroups, selectorFor, type DebuggerOutput, type ReplayPlan } from "../src/replay.js";
import { runWasmDebugger, WASM_TX_FILE, wasmDebuggerVersion, wasmFiles, wasmRunner, type RunWithFiles, type WasmRun } from "../src/wasm.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RUN_112 = readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8");
const CHILD_HASH = ccc.hashCkb(new Uint8Array(readFileSync(join(PROJECT, "build/release/spawn-child"))));
const mockOf = (name: string): MockTransaction => JSON.parse(readFileSync(join(PROJECT, "mocks", `tests.test_spawn_${name}.json`), "utf8"));
const enc = (s: string) => new TextEncoder().encode(s);
const ROOT_FOLDED = "??:func_0x12514 14974";
const CHILD_FOLDED = "??:func_0x12174 635605";
const CHILD_REPLAY = RUN_112.replace(/All cycles: 18801\(18\.4K\)\s*$/, "All cycles: 638327(623.4K)\n");

/** A WebAssembly-style run (files come back with it) that answers like 1.1.2 on the heavy scenario. */
function fakeWasm(child: (args: string[]) => Promise<WasmRun> = async () => ({ ...out(CHILD_REPLAY), files: { "vm1.folded": enc(CHILD_FOLDED) } })) {
  const calls: string[][] = [];
  const run = async (args: string[]): Promise<WasmRun> => {
    calls.push(args);
    if (args.includes("--vm-id")) return child(args);
    if (args.includes("--enable-flamegraph")) return { ...out(RUN_112), files: { "vm0.folded": enc(ROOT_FOLDED) } };
    return { ...out("Run result: 0\nAll cycles: 761957(744.1K)\n"), files: {} };
  };
  return { run, calls };
}
const out = (stdout: string, exitCode = 0): DebuggerOutput & { exitCode: number } => ({ stdout, stderr: "", exitCode });

const heavy = mockOf("heavy");
const [GROUP] = groupsOf(heavy);
const ctx = (run: RunWithFiles, version = "ckb-debugger 1.1.2") => ({
  version,
  base: debuggerArgs(WASM_TX_FILE, selectorFor(GROUP), 2),
  ...wasmFiles(run),
  mock: heavy,
  group: GROUP,
});

describe("wasmFiles", () => {
  it("reads back what the last run wrote, by the path the debugger was given", async () => {
    const f = wasmFiles(async () => ({ ...out(""), files: { "vm3.folded": enc("a 1") } }));
    expect(f.out(3)).toBe("/vm3.folded");
    await f.exec([]);
    expect(await f.readFile("/vm3.folded")).toBe("a 1");
  });

  it("never reads an earlier run's file", async () => {
    let first = true;
    const f = wasmFiles(async () => {
      const files: Record<string, Uint8Array> = first ? { "vm0.folded": enc("a 1") } : {};
      first = false;
      return { ...out(""), files };
    });
    await f.exec([]);
    await f.exec([]);
    await expect(f.readFile("/vm0.folded")).rejects.toThrow("not written by the last run");
  });
});

describe("profileSpawns", () => {
  it("splits a spawning group: the spawning script's own frames, and each spawned VM from its own --vm-id replay", async () => {
    const d = fakeWasm();
    const split = await profileSpawns(ctx(d.run));
    expect(split?.spawned).toBe(1);
    expect(foldedTotal(split!.own)).toBe(14_974n);
    expect(split!.childrenNote).toBeUndefined();
    const [c] = split!.children!;
    expect(c).toMatchObject({ vm: 1, parent: 0, locator: "cell_dep[1][0..11552]", codeHash: CHILD_HASH, result: 0, cycles: 638_327n });
    expect(foldedTotal(c.folded)).toBe(635_605n);
    expect(d.calls[0]).toEqual([...ctx(d.run).base, "--enable-flamegraph", "--flamegraph-output", "/vm0.folded"]);
    expect(d.calls[1]).toEqual([...ctx(d.run).base, "--vm-id", "1", "--enable-flamegraph", "--flamegraph-output", "/vm1.folded"]);
  });

  it("is undefined for a group whose script spawned nothing, after one run", async () => {
    const calls: string[][] = [];
    const split = await profileSpawns(ctx(async (args) => (calls.push(args), { ...out("Run result: 0\nAll cycles: 100(0.1K)\n"), files: {} })));
    expect(split).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("runs nothing with a debugger older than 1.1.2, and says why", async () => {
    const d = fakeWasm();
    await expect(profileSpawns(ctx(d.run, "ckb-debugger 0.200.1"))).rejects.toThrow(olderDebuggerNote("ckb-debugger 0.200.1"));
    expect(olderDebuggerNote("ckb-debugger 0.200.1")).toBe("ckb-debugger 0.200.1 cannot profile a spawned script on its own (ckb-debugger 1.1.2 or later can)");
    expect(d.calls).toEqual([]);
  });

  it("keeps the split when a child's replay fails: the reason is on the child", async () => {
    const d = fakeWasm(async () => {
      throw new Error("a ckb-debugger run took more than 180 s; stopped");
    });
    const split = await profileSpawns(ctx(d.run));
    expect(foldedTotal(split!.own)).toBe(14_974n);
    expect(split!.children![0].failed).toBe("the replay of VM 1 failed: a ckb-debugger run took more than 180 s; stopped");
  });

  it("says the check failed, rather than that nothing was spawned, when the profiled run did not finish", async () => {
    const trapped = { stdout: "Pre gather: collect vm creation\n", stderr: "RuntimeError: unreachable", exitCode: -1, files: {} };
    await expect(profileSpawns(ctx(async () => trapped))).rejects.toThrow(
      /^the spawn check \(a profiled run of the group\) failed: ckb-debugger crashed: RuntimeError: unreachable/,
    );
    await expect(profileSpawns(ctx(async () => ({ stdout: "", stderr: "", exitCode: null, files: {} })))).rejects.toThrow(
      "the spawn check (a profiled run of the group) failed: ckb-debugger was killed before it finished",
    );
    await expect(profileSpawns(ctx(async () => ({ ...out("Pre gather: collect vm creation\n", 2), files: {} })))).rejects.toThrow(
      /^the spawn check \(a profiled run of the group\) failed: unexpected ckb-debugger output/,
    );
    // A spawn tree, but the spawning script's own run never came.
    const cut = RUN_112.slice(0, RUN_112.indexOf("Pre gather: collect syscalls")) + "Run result: 0\nAll cycles: 761957(744.1K)\n";
    await expect(profileSpawns(ctx(async () => ({ ...out(cut), files: {} })))).rejects.toThrow(
      "the spawn check (a profiled run of the group) failed: no profiled run of the spawning script in ckb-debugger's output",
    );
  });

  it("is not a failed check when the script rejects: its run still says it spawned nothing", async () => {
    const split = await profileSpawns(ctx(async () => ({ ...out("Run result: 7\nAll cycles: 2186(2.1K)\n", 7), files: {} })));
    expect(split).toBeUndefined();
  });

  it("leaves the frames empty when no folded stacks were written (the page says no profile written)", async () => {
    const split = await profileSpawns(
      ctx(async (args) => (args.includes("--vm-id") ? { ...out(CHILD_REPLAY), files: {} } : { ...out(RUN_112), files: {} })),
    );
    expect(split!.own.size).toBe(0);
    expect(split!.children![0]).toMatchObject({ result: 0, cycles: 638_327n });
    expect(split!.children![0].folded.size).toBe(0);
  });

  it(`replays at most ${MAX_CHILD_PROFILES} spawned VMs, and says how many there were`, async () => {
    const n = MAX_CHILD_PROFILES + 2;
    const tree = ["Spawn tree: 0                    cell_dep[0][0..15992]", ...Array.from({ length: n }, (_, i) => `Spawn tree: ├── ${i + 1}                cell_dep[1][0..11552]`)];
    const root = `Pre gather: collect vm creation\nRun result: 0\nAll cycles: 1(0.0K)\n${tree.join("\n")}\nActual run: start\nRun result: 0\nAll cycles: 1(0.0K)\n`;
    const calls: string[][] = [];
    const split = await profileSpawns(
      ctx(async (args) => {
        calls.push(args);
        return args.includes("--vm-id") ? { ...out(CHILD_REPLAY), files: {} } : { ...out(root), files: {} };
      }),
    );
    expect(split!.spawned).toBe(n);
    expect(split!.children).toHaveLength(MAX_CHILD_PROFILES);
    expect(calls.filter((a) => a.includes("--vm-id"))).toHaveLength(MAX_CHILD_PROFILES);
    expect(split!.childrenNote).toBe(`${n} spawned scripts: the first ${MAX_CHILD_PROFILES} are profiled`);
  });
});

describe("serverExit", () => {
  const child = (c: Partial<FlameChild>) => ({ result: 0, ...c });
  it("flags a child whose own replay ended non-zero in a group that verified, as the CLI does", () => {
    expect(serverExit(child({ result: -1 }), true)).toBe(true);
    expect(serverExit(child({ result: -1, error: "cycles exceeded" }), true)).toBe(true);
    expect(serverExit(child({ result: 0 }), true)).toBe(false);
    expect(serverExit(child({ result: 9 }), false)).toBe(false);
    expect(serverExit(child({ result: -1, failed: "the replay of VM 1 failed: x" }), true)).toBe(false);
  });
  it("is the same note the report prints", () => {
    expect(SERVER_EXIT_NOTE).toBe(REPORT_SERVER_EXIT_NOTE);
    expect(SERVER_EXIT_NOTE).toMatch(/ckb-script-ipc run_server/);
  });
});

const WASM_112 = resolve(".cache/ckb-debugger/1.1.2/wasm/ckb-debugger.wasm");

describe.skipIf(!existsSync(WASM_112))("the spawn fixture in the WebAssembly ckb-debugger 1.1.2 (what the page runs)", { timeout: 180_000 }, () => {
  it("returns the files a run wrote", async () => {
    const module = await WebAssembly.compile(readFileSync(WASM_112));
    const tx = enc(JSON.stringify(heavy));
    const r = await runWasmDebugger(module, [...ctx(fakeWasm().run).base, "--enable-flamegraph", "--flamegraph-output", "/vm0.folded"], { "tx.json": tx });
    expect(Object.keys(r.files)).toEqual(["vm0.folded"]);
  });

  it("gives the CLI's numbers: group totals from plain runs, the split from --vm-id replays", async () => {
    const module = await WebAssembly.compile(readFileSync(WASM_112));
    const version = await wasmDebuggerVersion(module);
    expect(version).toBe("ckb-debugger 1.1.2");
    const results: Record<string, unknown> = {};
    for (const name of ["light", "heavy", "child_rejects", "no_such_child"]) {
      const mock = mockOf(name);
      const tx = enc(JSON.stringify(mock));
      const plan: ReplayPlan = { hash: name, status: "not on chain", mock, groups: groupsOf(mock), scriptVersion: 2, network: "testnet", rpcUrl: "" };
      const run = wasmRunner(module, tx) as (args: string[]) => Promise<WasmRun>;
      const p = await replayGroups(plan, run, { txFile: WASM_TX_FILE, debugger: version });
      const g = plan.groups[0];
      const split = await profileSpawns({ version, base: debuggerArgs(WASM_TX_FILE, selectorFor(g), 2), ...wasmFiles(run), mock, group: g });
      results[name] = {
        group: [p.groups[0].result, p.groups[0].cycles],
        own: split && foldedTotal(split.own),
        children: split?.children?.map((c) => [c.vm, c.codeHash === CHILD_HASH, c.result, foldedTotal(c.folded)]),
      };
    }
    expect(results).toEqual({
      light: expect.objectContaining({ children: [[1, true, 0, 19_093n]] }),
      heavy: { group: [0, 761_957n], own: 14_974n, children: [[1, true, 0, 635_605n]] },
      child_rejects: expect.objectContaining({ group: [7, 126_154n], children: [[1, true, 9, 1_420n]] }),
      no_such_child: expect.objectContaining({ children: undefined }),
    });
  });
});

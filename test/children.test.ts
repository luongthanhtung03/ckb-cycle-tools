/**
 * Per-child profiles of a script that spawns others: ckb-debugger 1.1.2's
 * `--vm-id` replay of each spawned VM, against test/fixtures/spawn-project
 * (spawn-parent spawns spawn-child, found by data hash in its input's data).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { childDeltas, diffReports, formatMarkdown, formatText, type ChildResult, type CycleReport, type GroupResult } from "../src/diff.js";
import { sameCode } from "../src/elf.js";
import { foldedTotal, functionCosts, profilesChildren, spawnTree } from "../src/flame.js";
import type { MockTransaction } from "../src/mock.js";
import { flameTransaction, type DebuggerOutput } from "../src/profile.js";
import { childResult, formatReport, runReport } from "../src/report.js";
import { resolvedCellDeps, spawnedBinary } from "../src/spawn.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RELEASE = join(PROJECT, "build/release");
const file = (n: string) => new Uint8Array(readFileSync(join(RELEASE, n)));
const CHILD = file("spawn-child");
const PARENT = file("spawn-parent");
const CHILD_HASH = ccc.hashCkb(CHILD);
const PARENT_HASH = ccc.hashCkb(PARENT);
const RUN_112 = readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8");
const mockOf = (name: string): MockTransaction => JSON.parse(readFileSync(join(PROJECT, "mocks", `${name}.json`), "utf8"));

describe("spawnTree", () => {
  it("reads the spawn tree of the fixture's run", () => {
    expect(spawnTree(RUN_112)).toEqual([
      { vm: 0, generation: 0, parent: 0, locator: "cell_dep[0][0..15992]", source: "cell_dep", index: 0, start: 0, end: 15992 },
      { vm: 1, generation: 0, parent: 0, locator: "cell_dep[1][0..11552]", source: "cell_dep", index: 1, start: 0, end: 11552 },
    ]);
  });

  it("follows nesting, exec generations and every locator kind", () => {
    const out = [
      "Spawn tree: 0                    input[0][0..100]",
      "Spawn tree: ├── 1                cell_dep[2][8..108]",
      "Spawn tree: │   └── 3            group_input[0][0..50]",
      "Spawn tree: │       └── 4        output[1][0..7]",
      "Spawn tree: └── 2                group_output[0][0..9]",
      "Spawn tree:     └── 2/1          cell_dep[3][0..10]",
      "Script log: Spawn tree: └── 9    cell_dep[0][0..1]",
      "Spawn tree: nonsense",
    ].join("\n");
    expect(spawnTree(out).map((v) => [v.vm, v.generation, v.parent, v.source, v.index])).toEqual([
      [0, 0, 0, "input", 0],
      [1, 0, 0, "cell_dep", 2],
      [3, 0, 1, "group_input", 0],
      [4, 0, 3, "output", 1],
      [2, 0, 0, "group_output", 0],
      [2, 1, 2, "cell_dep", 3],
    ]);
    expect(spawnTree("Run result: 0\nAll cycles: 100(0.0K)\n")).toEqual([]);
  });

  it("keeps a VM whose locator it cannot parse, without a source", () => {
    const [, v] = spawnTree("Spawn tree: 0    cell_dep[0][0..1]\nSpawn tree: └── 1    witness?[0]\n");
    expect(v).toEqual({ vm: 1, generation: 0, parent: 0, locator: "witness?[0]" });
  });
});

describe("profilesChildren", () => {
  it("needs ckb-debugger 1.1.2 or later", () => {
    expect(profilesChildren("ckb-debugger 1.1.2")).toBe(true);
    expect(profilesChildren("ckb-debugger 1.2.0")).toBe(true);
    expect(profilesChildren("ckb-debugger 2.0.0")).toBe(true);
    expect(profilesChildren("ckb-debugger 1.1.1")).toBe(false);
    expect(profilesChildren("ckb-debugger 0.200.2")).toBe(false);
    expect(profilesChildren("unknown")).toBe(false);
  });
});

describe("spawnedBinary", () => {
  const mock = mockOf("tests.test_spawn_heavy");
  const group = { inputs: [0], outputs: [] };

  it("finds the binary the child ran, by the locator, with its data hash", () => {
    const [, child] = spawnTree(RUN_112);
    const b = spawnedBinary(mock, child, group)!;
    expect(b.dataHash).toBe(CHILD_HASH);
    expect(b.data.length).toBe(11_552);
    // The fixture deploys it in a Type ID cell: the binary is the whole data, so the type hash is offered too.
    expect(b.typeHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("counts cell_dep[i] over the cells a dep group lists, not the group cell", () => {
    const m = structuredClone(mock);
    const [code0, code1] = m.mock_info.cell_deps;
    const outPoint = (i: number) => ccc.bytesConcat(ccc.bytesFrom(code0.cell_dep.out_point.tx_hash), ccc.numLeToBytes(i, 4));
    const groupData = ccc.hexFrom(ccc.bytesConcat(ccc.numLeToBytes(2, 4), outPoint(1), outPoint(0)));
    const groupOutPoint = { tx_hash: "0x" + "ab".repeat(32), index: "0x0" };
    m.mock_info.cell_deps.push({ cell_dep: { out_point: groupOutPoint, dep_type: "dep_group" }, output: code0.output, data: groupData, header: null });
    m.tx.cell_deps = [{ out_point: groupOutPoint, dep_type: "dep_group" }];
    expect(resolvedCellDeps(m).map((c) => c.data)).toEqual([code1.data, code0.data]);
    const [, child] = spawnTree("Spawn tree: 0  cell_dep[1][0..15992]\nSpawn tree: └── 1  cell_dep[0][0..11552]\n");
    expect(spawnedBinary(m, child, group)!.dataHash).toBe(CHILD_HASH);
  });

  it("reads inputs and group inputs, and a slice of the data without a type hash", () => {
    const m = structuredClone(mock);
    m.mock_info.inputs[0].data = ccc.hexFrom(ccc.bytesConcat([1, 2, 3], CHILD));
    const [, , a, b] = spawnTree(
      ["Spawn tree: 0  cell_dep[0][0..1]", "Spawn tree: ├── 1  input[0][3..11555]", "Spawn tree: ├── 2  group_input[0][3..11555]", "Spawn tree: └── 3  group_input[5][0..1]"].join("\n"),
    );
    const one = spawnTree(["Spawn tree: 0  cell_dep[0][0..1]", "Spawn tree: └── 1  input[0][3..11555]"].join("\n"))[1];
    expect(spawnedBinary(m, one, group)).toMatchObject({ dataHash: CHILD_HASH });
    expect(spawnedBinary(m, one, group)!.typeHash).toBeUndefined();
    expect(spawnedBinary(m, a, group)!.dataHash).toBe(CHILD_HASH);
    expect(spawnedBinary(m, b, group)).toBeUndefined();
  });

  it("gives up on a range past the data or a locator it cannot read", () => {
    const [v] = spawnTree("Spawn tree: 0  cell_dep[1][0..999999]\n");
    expect(spawnedBinary(mock, v, group)).toBeUndefined();
    expect(spawnedBinary(mock, { vm: 1, generation: 0, parent: 0, locator: "?" }, group)).toBeUndefined();
    expect(spawnedBinary(mock, { ...v, index: 7, end: 1 }, group)).toBeUndefined();
  });
});

describe("sameCode", () => {
  it("matches a build with its stripped copy, and nothing else", () => {
    expect(sameCode(file("spawn-child.debug"), CHILD)).toBe(true);
    expect(sameCode(file("spawn-parent.debug"), PARENT)).toBe(true);
    expect(sameCode(file("spawn-parent.debug"), CHILD)).toBe(false);
    expect(sameCode(new Uint8Array([1, 2, 3]), CHILD)).toBeUndefined();
  });
});

/**
 * A ckb-debugger that answers like 1.1.2 (or `version`) on the heavy scenario,
 * writing nothing to disk: the folded stacks come back through `readFile`.
 */
const ok = (stdout: string): DebuggerOutput => ({ stdout, stderr: "", exitCode: 0 });
function fakeDebugger(version = "1.1.2", child: (args: string[]) => DebuggerOutput | Promise<DebuggerOutput> = () => ok(CHILD_REPLAY)) {
  const calls: string[][] = [];
  const run = async (args: string[]): Promise<DebuggerOutput> => {
    calls.push(args);
    if (args[0] === "--version") return ok(`ckb-debugger ${version}\n`);
    if (args.includes("--vm-id")) return child(args);
    if (args.includes("--enable-flamegraph")) return ok(RUN_112);
    return ok("Run result: 0\nAll cycles: 761957(744.1K)\n");
  };
  return { run, calls };
}
const CHILD_REPLAY = RUN_112.replace(/All cycles: 18801\(18\.4K\)\s*$/, "All cycles: 638327(623.4K)\n");
const ROOT_FOLDED = "??:func_0x12514;main.rs:spawn_parent::parent_work 7180\n??:func_0x12514 7794";
const CHILD_FOLDED = "??:func_0x12174;??:func_0x121bc;main.rs:spawn_child::child_work 606720\n??:func_0x12174;??:func_0x121bc 26869\n??:func_0x12174 509";
const readFolded = async (path: string) => (/\.vm1\.folded$/.test(path) ? CHILD_FOLDED : ROOT_FOLDED);
const readBinary = async (path: string) => file(path.split(/[\\/]/).pop()!);

describe("flameTransaction on a spawning script", () => {
  const mock = mockOf("tests.test_spawn_heavy");
  // The parent's lock names its code by type hash; the child is found by the data hash of what it ran.
  const LOCK = mock.mock_info.inputs[0].output.lock.code_hash;
  const bins = { [LOCK]: join(RELEASE, "spawn-parent.debug"), [CHILD_HASH]: join(RELEASE, "spawn-child.debug") };

  it("replays each spawned VM with --vm-id, names its frames with --vm-symbols, and keeps the group's total", async () => {
    const d = fakeDebugger();
    const { groups } = await flameTransaction(mock, {
      runDebugger: d.run,
      bins,
      scriptNames: { [`${CHILD_HASH}:data2`]: "spawn-child" },
      readFile: readFolded,
      readBinary,
    });
    const [g] = groups;
    expect(g.cycles).toBe(761_957n);
    expect(foldedTotal(g.folded)).toBe(14_974n);
    expect(g.childrenNote).toBeUndefined();
    expect(g.children).toHaveLength(1);
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, parent: 0, locator: "cell_dep[1][0..11552]", codeHash: CHILD_HASH, name: "spawn-child", result: 0, cycles: 638_327n });
    expect(c.symbols).toBe(bins[CHILD_HASH]);
    expect(foldedTotal(c.folded)).toBe(634_098n);
    // func_0x frames named from the child's own symbol table.
    expect(functionCosts(c.folded).map((f) => f.name).slice(0, 3)).toEqual(["spawn_child::child_work", "__ckb_std_main", "_start"]);
    const replay = d.calls.find((a) => a.includes("--vm-id"))!;
    expect(replay).toEqual(expect.arrayContaining(["--vm-id", "1", "--vm-symbols", bins[CHILD_HASH], "--bin", bins[LOCK], "--enable-flamegraph"]));
  });

  it("says so, and replays nothing, with a debugger older than 1.1.2", async () => {
    const d = fakeDebugger("1.1.1");
    const { groups } = await flameTransaction(mock, { runDebugger: d.run, bins, readFile: readFolded, readBinary });
    expect(groups[0].children).toBeUndefined();
    expect(groups[0].childrenNote).toMatch(/^ckb-debugger 1\.1\.1 cannot profile a spawned script on its own \(ckb-debugger 1\.1\.2 or later can\)/);
    expect(d.calls.some((a) => a.includes("--vm-id"))).toBe(false);
    expect(groups[0].cycles).toBe(761_957n);
  });

  it("keeps the group when a child's replay fails, with the reason on the child", async () => {
    const d = fakeDebugger("1.1.2", () => {
      throw new Error("cannot run ckb-debugger at x: EACCES");
    });
    const { groups } = await flameTransaction(mock, { runDebugger: d.run, bins, readFile: readFolded, readBinary });
    expect(groups[0].children![0].failed).toBe("the replay of VM 1 failed: cannot run ckb-debugger at x: EACCES");
    expect(groups[0].children![0].folded.size).toBe(0);
    expect(foldedTotal(groups[0].folded)).toBe(14_974n);
  });

  it("does not trust a replay whose output has no replay in it", async () => {
    const d = fakeDebugger("1.1.2", () => ({ stdout: "Run result: 0\nAll cycles: 5(0.0K)\n", stderr: "", exitCode: 0 }));
    const { groups } = await flameTransaction(mock, { runDebugger: d.run, bins, readFile: readFolded, readBinary });
    expect(groups[0].children![0].failed).toMatch(/no replay of VM 1/);
  });

  it("leaves a child's frames unnamed when its symbols build is other code", async () => {
    const d = fakeDebugger();
    const wrong = { ...bins, [CHILD_HASH]: join(RELEASE, "spawn-parent.debug") };
    const { groups } = await flameTransaction(mock, { runDebugger: d.run, bins: wrong, readFile: readFolded, readBinary });
    const [c] = groups[0].children!;
    expect(c.symbols).toBeUndefined();
    expect(c.symbolsWarning).toMatch(/is not the same code as the binary VM 1 ran/);
    expect(d.calls.find((a) => a.includes("--vm-id"))).not.toContain("--vm-symbols");
  });

  it("can be turned off", async () => {
    const d = fakeDebugger();
    const { groups } = await flameTransaction(mock, { runDebugger: d.run, bins, readFile: readFolded, readBinary, children: false });
    expect(groups[0].children).toBeUndefined();
    expect(groups[0].childrenNote).toBeUndefined();
    expect(groups[0].spawned).toBe(1);
  });
});

describe("childResult", () => {
  const base = { vm: 1, parent: 0, locator: "cell_dep[1][0..11552]", codeHash: CHILD_HASH, result: 0, cycles: 638_327n };
  it("records profiled frames and, with symbols, the costliest functions", () => {
    const folded = new Map([["_start;spawn_child::child_work", 606_720n], ["_start", 509n]]);
    expect(childResult({ ...base, name: "spawn-child", symbols: "x.debug", folded })).toEqual({
      vm: 1,
      parent: 0,
      script: "spawn-child",
      codeHash: CHILD_HASH,
      result: 0,
      profiled: 607_229,
      functions: [
        { name: "spawn_child::child_work", self: 606_720, total: 606_720 },
        { name: "_start", self: 509, total: 607_229 },
      ],
    });
  });
  it("says why there are no functions, or no profile", () => {
    expect(childResult({ ...base, folded: new Map([["func_0x1", 5n]]) })).toMatchObject({ script: "0x907733…00774d", profiled: 5, functionsWarning: expect.stringMatching(/no symbols build/) });
    expect(childResult({ ...base, folded: new Map(), failed: "the replay of VM 1 failed: x" })).toEqual({
      vm: 1,
      parent: 0,
      script: "0x907733…00774d",
      codeHash: CHILD_HASH,
      failed: "the replay of VM 1 failed: x",
    });
  });
});

describe("children in a diff", () => {
  const child = (profiled: number, extra: Partial<ChildResult> = {}): ChildResult => ({
    vm: 1,
    parent: 0,
    script: "spawn-child",
    result: 0,
    profiled,
    functions: [{ name: "spawn_child::child_work", self: profiled - 1_000, total: profiled - 1_000 }],
    ...extra,
  });
  const group = (cycles: number, extra: Partial<GroupResult> = {}): GroupResult => ({
    selector: "input.0.lock",
    role: "lock",
    script: "spawn-parent",
    codeHash: "0x" + "77".repeat(32),
    hashType: "type",
    result: 0,
    cycles,
    functions: [{ name: "spawn_parent::parent_work", self: 7_180, total: 7_180 }],
    spawned: 1,
    profiled: 14_974,
    ...extra,
  });
  const report = (g: GroupResult): CycleReport => ({ tool: "ckb-cycles", version: 1, scenarios: [{ name: "heavy", groups: [g] }] });

  it("says which spawned script changed, and its functions", () => {
    const d = diffReports(report(group(145_528, { children: [child(19_093)] })), report(group(761_957, { children: [child(635_605)] })));
    expect(d.rows[0].children).toEqual([
      {
        vm: 1,
        script: "spawn-child",
        base: { result: "ok", profiled: 19_093 },
        head: { result: "ok", profiled: 635_605 },
        delta: 616_512,
        changed: true,
        functions: [{ name: "spawn_child::child_work", base: 18_093, head: 634_605, delta: 616_512 }],
      },
    ]);
    const text = formatText(d);
    expect(text).toContain("functions in heavy input.0.lock: none of its own changed. This script spawned 1 other script");
    expect(text).toContain("Its own profile is listed separately.");
    expect(text).toContain("  spawned vm 1 (spawn-child): profiled 19,093 → 635,605 (+616,512); spawn_child::child_work +616,512");
    const md = formatMarkdown(d);
    expect(md).toContain("<summary>Spawned scripts in heavy · <code>input.0.lock</code> (spawn-parent): vm 1 spawn-child +616,512</summary>");
    expect(md).toContain("| 1 | spawn-child | 19,093 | 635,605 | +616,512 |");
    expect(md).toContain("| spawn\\_child::child\\_work | 18,093 | 634,605 | +616,512 |");
    expect(md).toMatch(/Profiled frames of each spawned script/);
  });

  it("shows the head's children when the base has none to compare (an older report or debugger)", () => {
    const d = diffReports(report(group(145_528)), report(group(761_957, { children: [child(635_605)] })));
    expect(d.rows[0].children![0]).toMatchObject({ changed: false, head: { profiled: 635_605 } });
    expect(d.rows[0].children![0].base).toBeUndefined();
    expect(formatText(d)).toContain("  spawned vm 1 (spawn-child): profiled 635,605");
    expect(formatMarkdown(d)).toContain("Spawned scripts in heavy · <code>input.0.lock</code> (spawn-parent): 1 profiled");
  });

  it("reports a new, gone, failed or result-changed child, and the head's note", () => {
    const k = childDeltas([child(10), child(20, { vm: 2 })], [child(10, { result: 9 }), child(30, { vm: 3 }), { vm: 4, parent: 0, script: "x", failed: "the replay of VM 4 failed: y" }]);
    expect(k.map((c) => [c.vm, c.changed, c.base?.result, c.head?.result])).toEqual([
      [1, true, "ok", "exit 9"],
      [2, true, "ok", undefined],
      [3, true, undefined, "ok"],
      [4, true, undefined, "not profiled"],
    ]);
    expect(k[3].note).toBe("the replay of VM 4 failed: y");
    const d = diffReports(report(group(100)), report(group(200, { childrenNote: "ckb-debugger 1.1.1 cannot profile a spawned script on its own" })));
    expect(formatText(d)).toContain("  spawned scripts: ckb-debugger 1.1.1 cannot profile");
    expect(formatMarkdown(d)).toContain("Spawned scripts in heavy · <code>input.0.lock</code> (spawn-parent): not profiled");
  });

  it("never compares two different scripts at the same VM id: both names, changed, no delta", () => {
    const a = child(1_000, { script: "child-a", codeHash: "0x" + "aa".repeat(32), functions: [{ name: "a::work", self: 900, total: 900 }] });
    const b = child(1_000, { script: "child-b", codeHash: "0x" + "bb".repeat(32), functions: [{ name: "b::work", self: 900, total: 900 }] });
    const [k] = childDeltas([a], [b]);
    expect(k).toEqual({
      vm: 1,
      script: "child-a → child-b",
      baseScript: "child-a",
      base: { result: "ok", profiled: 1_000 },
      head: { result: "ok", profiled: 1_000 },
      changed: true,
      functions: [{ name: "b::work", head: 900 }],
    });
    const d = diffReports(report(group(761_957, { children: [a] })), report(group(761_990, { children: [b] })));
    expect(formatText(d)).toMatch(/^ {2}spawned vm 1 \(child-a → child-b\): profiled 1,000 → 1,000$/m);
    const md = formatMarkdown(d);
    expect(md).toContain("(spawn-parent): vm 1 child-a → child-b ok</summary>");
    expect(md).toContain("| 1 | child-a → child-b | 1,000 | 1,000 |  |");
    // The same script rebuilt (another data hash, the same name) is still one script's change.
    const rebuilt = childDeltas([a], [{ ...a, codeHash: "0x" + "cc".repeat(32), profiled: 1_200 }]);
    expect(rebuilt[0]).toMatchObject({ script: "child-a", delta: 200, changed: true });
    expect(rebuilt[0].baseScript).toBeUndefined();
  });

  it("reads children defensively: a malformed entry is dropped, not a crash", () => {
    const bad = group(200, { children: [null, { vm: "1" }, { vm: 1, script: "ok", profiled: "x", functions: [null, { name: "f", self: 3, total: 3 }] }] as unknown as ChildResult[] });
    const d = diffReports(report(group(100)), report(bad));
    expect(d.rows[0].children).toEqual([{ vm: 1, script: "ok", head: { result: "not profiled" }, changed: false, functions: [{ name: "f", head: 3 }] }]);
  });

  it("adds nothing for an unchanged group", () => {
    const g = group(761_957, { children: [child(635_605)] });
    expect(formatMarkdown(diffReports(report(g), report(g)))).not.toContain("Spawned scripts");
  });
});

describe("the terminal report", () => {
  it("lists each spawned script under its group, and the note when there is none", () => {
    const g: GroupResult = {
      selector: "input.0.lock",
      role: "lock",
      script: "spawn-parent",
      codeHash: PARENT_HASH,
      hashType: "data2",
      result: 0,
      cycles: 761_957,
      functions: [{ name: "spawn_parent::parent_work", self: 7_180, total: 7_180 }],
      spawned: 1,
      profiled: 14_974,
      children: [
        { vm: 1, parent: 0, script: "spawn-child", result: 0, profiled: 635_605, functions: [{ name: "spawn_child::child_work", self: 606_720, total: 606_720 }] },
        { vm: 2, parent: 1, script: "other", failed: "the replay of VM 2 failed: z" },
      ],
    };
    const out = formatReport({ tool: "ckb-cycles", version: 1, scenarios: [{ name: "heavy", groups: [g] }] });
    expect(out).toContain("  spawned vm 1 (spawn-child): ok, 635,605 cycles in its profiled frames; costliest (self): spawn_child::child_work 606,720");
    expect(out).toContain("  spawned vm 2 (other): not profiled: the replay of VM 2 failed: z");
    const old = formatReport({ tool: "ckb-cycles", version: 1, scenarios: [{ name: "heavy", groups: [{ ...g, children: undefined, childrenNote: "ckb-debugger 1.1.1 cannot" }] }] });
    expect(old).toContain("  spawned scripts: ckb-debugger 1.1.1 cannot");
  });

  it("explains a spawned server that ends non-zero in its own replay when the group verified", () => {
    const server: ChildResult = { vm: 1, parent: 0, script: "game", result: -1, profiled: 115_556_444 };
    const g: GroupResult = {
      selector: "input.0.type",
      role: "type",
      script: "live-match",
      codeHash: PARENT_HASH,
      hashType: "data2",
      result: 0,
      cycles: 123_718_667,
      spawned: 1,
      profiled: 7_993_759,
      children: [server],
    };
    const ok = formatReport({ tool: "ckb-cycles", version: 1, scenarios: [{ name: "race", groups: [g] }] });
    expect(ok).toContain("spawned vm 1 (game): exit -1, 115,556,444 cycles in its profiled frames (the group verified, so this is the spawned script's own exit code, not a failure: ");
    expect(ok).toContain("ckb-script-ipc run_server");
    // The group rejects too: the child's exit is a real failure, no note.
    const bad = formatReport({ tool: "ckb-cycles", version: 1, scenarios: [{ name: "race", groups: [{ ...g, result: 7 }] }] });
    expect(bad).toContain("spawned vm 1 (game): exit -1, 115,556,444 cycles in its profiled frames");
    expect(bad).not.toContain("run_server");
  });
});

/** A native ckb-debugger 1.1.2 or later: the resolved one, or the one `npm run compat -- fetch` caches. */
const debugger112 = (() => {
  const version = (path: string) => {
    try {
      return execFileSync(path, ["--version"], { encoding: "utf8" });
    } catch {
      return "";
    }
  };
  const candidates: string[] = [];
  try {
    candidates.push(resolveDebugger());
  } catch {
    // not installed: try the cache
  }
  candidates.push(resolve(".cache/ckb-debugger/1.1.2/native", process.platform === "win32" ? "ckb-debugger.exe" : "ckb-debugger"));
  return candidates.find((p) => existsSync(p) && profilesChildren(version(p)));
})();

describe.skipIf(!debugger112)("report on the spawn fixture, with ckb-debugger 1.1.2", { timeout: 180_000 }, () => {
  it("profiles the child on its own, the group's total unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ckb-children-"));
    const bin = (n: string) => ({ path: join(RELEASE, n), symbols: join(RELEASE, `${n}.debug`), codeHash: ccc.hashCkb(file(n)) });
    const scenarios = ["light", "heavy", "child_rejects", "no_such_child"].map((s) => ({ name: s, mock: join(PROJECT, "mocks", `tests.test_spawn_${s}.json`) }));
    const config = join(dir, "cycles.json");
    writeFileSync(config, JSON.stringify({ functions: true, binaries: { "spawn-parent": bin("spawn-parent"), "spawn-child": bin("spawn-child") }, scenarios }));
    const r = await runReport(config, { debuggerPath: debugger112! });
    expect(r.errors).toEqual([]);
    const by = Object.fromEntries(r.scenarios.map((s) => [s.name, s.groups[0]]));
    expect(by.heavy).toMatchObject({ cycles: 761_957, spawned: 1, profiled: 14_974 });
    expect(by.heavy.childrenNote).toBeUndefined();
    expect(by.heavy.children).toEqual([
      expect.objectContaining({ vm: 1, parent: 0, script: "spawn-child", codeHash: CHILD_HASH, result: 0, profiled: 635_605 }),
    ]);
    expect(by.heavy.children![0].functions![0]).toEqual({ name: "spawn_child::child_work", self: 606_720, total: 606_720 });
    expect(by.light.children![0]).toMatchObject({ result: 0, profiled: 19_093 });
    expect(by.light.children![0].functions![0]).toMatchObject({ name: "spawn_child::child_work", self: 15_168 });
    // The child rejects in the group too (exit 9): its replay says so.
    expect(by.child_rejects).toMatchObject({ result: 7, cycles: 126_154 });
    expect(by.child_rejects.children![0]).toMatchObject({ result: 9, profiled: 1_420 });
    expect(by.no_such_child.children).toBeUndefined();
    // Parent and child frames together stay under the group total: loading and the spawn are in no frame.
    expect(by.heavy.profiled! + by.heavy.children![0].profiled!).toBeLessThan(by.heavy.cycles);
    expect(formatReport(r)).toContain("spawned vm 1 (spawn-child): ok, 635,605 cycles in its profiled frames; costliest (self): spawn_child::child_work 606,720");
  });
});

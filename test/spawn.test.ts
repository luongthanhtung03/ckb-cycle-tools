/**
 * A script that spawns another (CKB2023 spawn, VM version 2), against
 * test/fixtures/spawn-project: spawn-parent, a lock, spawns spawn-child,
 * which it finds by the data2 hash in its input cell's data, as a match
 * script finds its game. ckb-debugger runs the whole group, the child
 * included, but profiles only the root script. See the fixture's Makefile.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { diffReports, formatMarkdown, formatText, spawnNote, type CycleReport } from "../src/diff.js";
import { profiledCycles, spawnedScripts } from "../src/flame.js";
import type { MockTransaction } from "../src/mock.js";
import { formatReport, runReport } from "../src/report.js";
import { substituteBinaries } from "../src/substitute.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RUN = readFileSync(join(PROJECT, "flamegraph-run.txt"), "utf8");
const CHILD = readFileSync(join(PROJECT, "build/release/spawn-child"));
const mockOf = (name: string): MockTransaction => JSON.parse(readFileSync(join(PROJECT, "mocks", `${name}.json`), "utf8"));

describe("ckb-debugger's flamegraph run of a spawning script (1.1.1, recorded)", () => {
  it("profiled cycles are the root script's run, the last All cycles line, not the group's total", () => {
    expect(profiledCycles(RUN)).toBe(14_974n);
  });

  it("counts the spawned scripts from the spawn tree", () => {
    expect(spawnedScripts(RUN)).toBe(1);
    expect(spawnedScripts("Run result: 0\nAll cycles: 19187(18.7K)\n")).toBe(0);
    const three = "Spawn tree: 0    cell_dep[0]\nSpawn tree: ├── 1    cell_dep[1]\nSpawn tree: │   └── 2    cell_dep[1]\nSpawn tree: └── 3    cell_dep[2]\n";
    expect(spawnedScripts(three)).toBe(3);
    expect(spawnedScripts("Script log: Spawn tree: 0 x\nSpawn tree: nonsense\n")).toBe(0);
  });
});

describe("swapping in a new build of a spawned script", () => {
  it("warns that the spawning cell's data still names the old hash", () => {
    const mock = mockOf("tests.test_spawn_light");
    const { mock: out, applied } = substituteBinaries(mock, [
      { name: "spawn-child", data: ccc.bytesConcat(CHILD, [0]), codeHash: ccc.hashCkb(CHILD) },
    ]);
    expect(applied[0].warnings.join("\n")).toMatch(/old code hash still appears in the data of 1 cell\(s\); cell data is not rewritten/);
    // Data is left as it was: rewriting outputs_data would change the transaction.
    expect(out.mock_info.inputs[0].data).toBe(mock.mock_info.inputs[0].data);
  });

  it("says nothing about data when no cell names the binary", () => {
    const mock = mockOf("tests.test_spawn_no_such_child");
    const { applied } = substituteBinaries(mock, [
      { name: "spawn-child", data: ccc.bytesConcat(CHILD, [0]), codeHash: ccc.hashCkb(CHILD) },
    ]);
    expect(applied[0].warnings.join("\n")).not.toMatch(/in the data of/);
  });
});

describe("the diff of a spawning script", () => {
  const group = (cycles: number, extra: object = {}) => ({
    selector: "input.0.lock",
    role: "lock" as const,
    script: "spawn-parent",
    codeHash: "0x" + "77".repeat(32),
    hashType: "type",
    result: 0,
    cycles,
    functions: [{ name: "spawn_parent::parent_work", self: 7_180, total: 7_180 }],
    ...extra,
  });
  const report = (cycles: number, extra: object = {}): CycleReport => ({
    tool: "ckb-cycles",
    version: 1,
    scenarios: [{ name: "heavy", groups: [group(cycles, extra)] }],
  });

  it("says the change is outside the spawning script's own functions", () => {
    const d = diffReports(report(761_957, { spawned: 1, profiled: 14_974 }), report(905_317, { spawned: 1, profiled: 14_974 }));
    const md = formatMarkdown(d);
    expect(md).toContain("none of its own changed");
    expect(md).toContain("This script spawned 1 other script");
    expect(md).toContain("the profile covers 14,974 of its 905,317 cycles");
    expect(formatText(d)).toMatch(/functions in heavy input\.0\.lock: none of its own changed\. This script spawned 1/);
  });

  it("adds nothing for a script that spawns nothing", () => {
    const d = diffReports(report(761_957), report(905_317));
    expect(formatMarkdown(d)).not.toContain("spawned");
    expect(formatText(d)).not.toContain("spawned");
  });

  it("words the note for several spawned scripts", () => {
    expect(spawnNote({ spawned: 2 })).toMatch(/^This script spawned 2 other scripts: their cycles/);
  });
});

const ready = (() => {
  try {
    resolveDebugger();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!ready)("report on the spawn fixture, with ckb-debugger", { timeout: 120_000 }, () => {
  it("counts the child in the parent's group, and says its functions leave it out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ckb-spawn-"));
    const bin = (n: string) => ({
      path: join(PROJECT, "build/release", n),
      symbols: join(PROJECT, "build/release", `${n}.debug`),
      codeHash: ccc.hashCkb(readFileSync(join(PROJECT, "build/release", n))),
    });
    const scenarios = ["light", "heavy", "child_rejects", "no_such_child"].map((s) => ({
      name: s,
      mock: join(PROJECT, "mocks", `tests.test_spawn_${s}.json`),
    }));
    const config = join(dir, "cycles.json");
    writeFileSync(config, JSON.stringify({ functions: true, binaries: { "spawn-parent": bin("spawn-parent"), "spawn-child": bin("spawn-child") }, scenarios }));
    const r = await runReport(config);
    expect(r.errors).toEqual([]);
    const by = Object.fromEntries(r.scenarios.map((s) => [s.name, s.groups]));
    // One group each: the child is no group of its own. Totals as ckb-debugger prints them.
    for (const s of Object.values(by)) expect(s).toHaveLength(1);
    expect(by.light[0]).toMatchObject({ script: "spawn-parent", result: 0, cycles: 145_528, spawned: 1 });
    expect(by.heavy[0]).toMatchObject({ result: 0, cycles: 761_957, spawned: 1, profiled: 14_974 });
    expect(by.child_rejects[0]).toMatchObject({ result: 7, cycles: 126_154, spawned: 1 });
    expect(by.no_such_child[0]).toMatchObject({ result: 5, cycles: 17_943 });
    expect(by.no_such_child[0].spawned).toBeUndefined();
    // The functions are the parent's: the child's work is in no frame.
    const names = by.heavy[0].functions!.map((f) => f.name);
    expect(names[0]).toBe("spawn_parent::parent_work");
    expect(names.some((n) => n.includes("child_work"))).toBe(false);
    expect(formatReport(r)).toContain("the profile covers 14,974 of its 761,957 cycles");
  });
});

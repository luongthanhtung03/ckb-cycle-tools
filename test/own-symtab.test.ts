/**
 * A deployed binary that kept its own `.symtab` (only DWARF stripped), profiled
 * with no `--bin` and no `--map`. ckb-debugger's profiler (ckb-vm-pprof) opens
 * a frame at each function start its `.symtab` lists, but names a frame only
 * from DWARF: without it every frame is `??:func_0x<address>`. flame names them
 * from the deployed binary's own symbol table, for the group's script and for
 * each spawned one.
 *
 * The binaries: test/fixtures/spawn-project's stripped builds given a .symtab
 * from their linker maps (addSymbolTable), put in the heavy scenario as the
 * deployed code (the input cell's data names the child by its data2 hash, so
 * that is rewritten too). With a fake debugger, and with ckb-debugger 1.1.2
 * when it is on PATH or in the cache.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { elfFunctionNames } from "../src/elf.js";
import { addSymbolTable } from "../src/elfsym.js";
import { functionCosts, profilesChildren } from "../src/flame.js";
import { linkerMapFunctionNames, readLinkerMap } from "../src/linkmap.js";
import type { MockTransaction } from "../src/mock.js";
import { flameTransaction, type DebuggerOutput } from "../src/profile.js";
import { childResult, formatReport, runReport } from "../src/report.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RELEASE = join(PROJECT, "build/release");
/** The stripped build with its map's functions as its own .symtab: what a release build without debug info is. */
const withSymtab = (bin: string, map: string) => {
  const text = readFileSync(map, "utf8");
  const { text: t, start } = readLinkerMap(text);
  return addSymbolTable(new Uint8Array(readFileSync(join(RELEASE, bin))), linkerMapFunctionNames(text), {
    ...(t && { text: t }),
    ...(start !== undefined && { start }),
  }).elf;
};
const PARENT = withSymtab("spawn-parent", "test/fixtures/linkmap/spawn-parent-text.lld.map");
const CHILD = withSymtab("spawn-child", "test/fixtures/linkmap/spawn-child-text.lld.map");
const CHILD_HASH = ccc.hashCkb(CHILD);
const heavy: MockTransaction = JSON.parse(readFileSync(join(PROJECT, "mocks/tests.test_spawn_heavy.json"), "utf8"));
heavy.mock_info.cell_deps[0].data = ccc.hexFrom(PARENT);
heavy.mock_info.cell_deps[1].data = ccc.hexFrom(CHILD);
heavy.mock_info.inputs[0].data = CHILD_HASH + heavy.mock_info.inputs[0].data.slice(66);
const LOCK = heavy.mock_info.inputs[0].output.lock.code_hash;

// What ckb-debugger 1.1.2 wrote for these binaries (the heads of its real .folded files).
const ROOT_FOLDED = "??:func_0x12514;??:func_0x1258e 7180\n??:func_0x12514 7794";
const CHILD_FOLDED = "??:func_0x12174;??:func_0x121bc;??:func_0x1218a 606720\n??:func_0x12174 509";
const RUN_112 = readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8")
  .replace("cell_dep[0][0..15992]", `cell_dep[0][0..${PARENT.length}]`)
  .replace("cell_dep[1][0..11552]", `cell_dep[1][0..${CHILD.length}]`);

function fakeDebugger() {
  const calls: string[][] = [];
  const ok = (stdout: string): DebuggerOutput => ({ stdout, stderr: "", exitCode: 0 });
  const run = async (args: string[]): Promise<DebuggerOutput> => {
    calls.push(args);
    if (args[0] === "--version") return ok("ckb-debugger 1.1.2\n");
    if (args.includes("--enable-flamegraph")) return ok(RUN_112);
    return ok("Run result: 0\nAll cycles: 761957(744.1K)\n");
  };
  return { run, calls };
}
const readFolded = async (path: string) => (/\.vm1\.folded$/.test(path) ? CHILD_FOLDED : ROOT_FOLDED);

describe("a deployed binary with its own .symtab", () => {
  it("has the functions the profiler opens frames at", () => {
    expect(elfFunctionNames(PARENT).get(0x1258en)).toBe("spawn_parent::parent_work");
    expect(elfFunctionNames(CHILD).get(0x1218an)).toBe("spawn_child::child_work");
  });

  it("names the group's and the spawned script's frames with no --bin or --map", async () => {
    const d = fakeDebugger();
    const { groups } = await flameTransaction(heavy, { runDebugger: d.run, readFile: readFolded });
    const [g] = groups;
    expect(g).toMatchObject({ ownSymbols: true, result: 0, cycles: 761_957n });
    expect(g.bin).toBeUndefined();
    expect(functionCosts(g.folded).map((f) => f.name)).toEqual(["_start", "spawn_parent::parent_work"]);
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, codeHash: CHILD_HASH, ownSymbols: true, result: 0 });
    expect(c.symbols).toBeUndefined();
    expect(functionCosts(c.folded).map((f) => f.name)).toEqual(["spawn_child::child_work", "_start", "__ckb_std_main"]);
    // Nothing substituted: the deployed binaries ran, nothing given as --bin or --vm-symbols.
    expect(d.calls.some((a) => a.includes("--bin") || a.includes("--vm-symbols"))).toBe(false);
  });

  it("is named from --bin, not its own table, when a build is given", async () => {
    const d = fakeDebugger();
    const { groups } = await flameTransaction(heavy, {
      runDebugger: d.run,
      bins: { [LOCK]: join(RELEASE, "spawn-parent.debug") },
      readFile: readFolded,
      readBinary: async (p) => new Uint8Array(readFileSync(p)),
    });
    expect(groups[0].ownSymbols).toBeUndefined();
    expect(groups[0].bin).toBe(join(RELEASE, "spawn-parent.debug"));
  });

  it("leaves a stripped binary's frames as addresses", async () => {
    const stripped: MockTransaction = JSON.parse(readFileSync(join(PROJECT, "mocks/tests.test_spawn_heavy.json"), "utf8"));
    const { groups } = await flameTransaction(stripped, {
      runDebugger: async (args) =>
        args[0] === "--version"
          ? { stdout: "ckb-debugger 1.1.2\n", stderr: "", exitCode: 0 }
          : { stdout: args.includes("--enable-flamegraph") ? readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8") : "Run result: 0\nAll cycles: 761957(744.1K)\n", stderr: "", exitCode: 0 },
      readFile: readFolded,
    });
    expect(groups[0].ownSymbols).toBeUndefined();
    expect(groups[0].children![0].ownSymbols).toBeUndefined();
    expect(functionCosts(groups[0].children![0].folded)[0].name).toBe("func_0x1218a");
  });
});

/**
 * A report scenario on the heavy mock: spawn-parent given a symbols build (what
 * `report` needs to record functions), spawn-child the deployed binary with its
 * own .symtab and no build.
 */
function reportConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "ckb-own-symtab-"));
  writeFileSync(join(dir, "spawn-parent"), PARENT);
  writeFileSync(join(dir, "heavy.json"), JSON.stringify(heavy));
  const config = join(dir, "cycles.json");
  writeFileSync(
    config,
    JSON.stringify({
      functions: true,
      binaries: { "spawn-parent": { path: "spawn-parent", symbols: join(RELEASE, "spawn-parent.debug"), codeHash: ccc.hashCkb(PARENT) } },
      scenarios: [{ name: "heavy", mock: "heavy.json" }],
    }),
  );
  return config;
}

describe("report: a spawned binary with its own .symtab", () => {
  const base = { vm: 1, parent: 0, locator: "cell_dep[1][0..11552]", codeHash: CHILD_HASH, result: 0, cycles: 638_327n };
  const folded = new Map([["_start;spawn_child::child_work", 606_720n], ["_start", 509n]]);

  it("records its functions, with no symbols-build warning", () => {
    const r = childResult({ ...base, ownSymbols: true, folded });
    expect(r).toMatchObject({ ownSymbols: true, profiled: 607_229 });
    expect(r.functions![0]).toEqual({ name: "spawn_child::child_work", self: 606_720, total: 606_720 });
    expect(r.functionsWarning).toBeUndefined();
  });

  it("still warns for a binary with neither a build nor a .symtab", () => {
    const r = childResult({ ...base, folded: new Map([["func_0x1218a", 5n]]) });
    expect(r.ownSymbols).toBeUndefined();
    expect(r.functions).toBeUndefined();
    expect(r.functionsWarning).toMatch(/no symbols build/);
  });

  it("names the child in a report run (fake debugger)", async () => {
    const d = fakeDebugger();
    // The flamegraph runs write their .folded files where they are told.
    const runDebugger = async (args: string[]) => {
      const i = args.indexOf("--flamegraph-output");
      if (i >= 0) writeFileSync(args[i + 1], /\.vm1\.folded$/.test(args[i + 1]) ? CHILD_FOLDED : "_start;spawn_parent::parent_work 7180\n_start 7794");
      return d.run(args);
    };
    const r = await runReport(reportConfig(), { runDebugger });
    expect(r.errors).toEqual([]);
    const [g] = r.scenarios[0].groups;
    expect(g.functionsWarning).toBeUndefined();
    expect(g.functions![0].name).toBe("_start");
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, codeHash: CHILD_HASH, ownSymbols: true, result: 0 });
    expect(c.functionsWarning).toBeUndefined();
    expect(c.functions!.map((f) => f.name)).toEqual(["spawn_child::child_work", "_start", "__ckb_std_main"]);
    expect(formatReport(r)).toContain("costliest (self): spawn_child::child_work 606,720");
    // The child ran as deployed: no build for it was passed.
    expect(d.calls.some((a) => a.includes("--vm-symbols"))).toBe(false);
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

describe.skipIf(!debugger112)("own .symtab with ckb-debugger 1.1.2", { timeout: 180_000 }, () => {
  it("opens frames at the binary's functions but names none; flame names them from its table", async () => {
    const raw: Record<string, string> = {};
    const { groups } = await flameTransaction(heavy, {
      debuggerPath: debugger112!,
      readFile: async (p) => (raw[/\.vm1\.folded$/.test(p) ? "child" : "root"] = readFileSync(p, "utf8")),
    });
    const [g] = groups;
    // The debugger's own output: frames opened (many stacks), every one an address.
    for (const text of [raw.root, raw.child]) {
      const frames = text.trim().split("\n").flatMap((l) => l.replace(/\s+\d+$/, "").split(";").map((f) => f.trim()));
      expect(text.trim().split("\n").length).toBeGreaterThan(10);
      expect(frames.every((f) => /^\?\?:func_0x[0-9a-f]+$/.test(f))).toBe(true);
    }
    expect(g).toMatchObject({ ownSymbols: true, result: 0, cycles: 761_957n });
    expect(functionCosts(g.folded)[0].name).toBe("spawn_parent::parent_work");
    const [c] = g.children!;
    expect(c).toMatchObject({ ownSymbols: true, result: 0, cycles: 638_327n });
    expect(functionCosts(c.folded)[0]).toMatchObject({ name: "spawn_child::child_work", self: 606_720n });
    // Every frame is named: the table has a function at every address the profiler opened one.
    const names = [...g.folded.keys(), ...c.folded.keys()].flatMap((s) => s.split(";"));
    expect(names.some((n) => n.startsWith("func_0x"))).toBe(false);
  });
});

describe.skipIf(!debugger112)("report: own .symtab with ckb-debugger 1.1.2", { timeout: 180_000 }, () => {
  it("names the spawned binary's functions from its own table", async () => {
    const r = await runReport(reportConfig(), { debuggerPath: debugger112! });
    expect(r.errors).toEqual([]);
    const [g] = r.scenarios[0].groups;
    expect(g).toMatchObject({ cycles: 761_957, spawned: 1 });
    expect(g.functionsWarning).toBeUndefined();
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, codeHash: CHILD_HASH, ownSymbols: true, result: 0 });
    expect(c.functionsWarning).toBeUndefined();
    expect(c.functions![0]).toEqual({ name: "spawn_child::child_work", self: 606_720, total: 606_720 });
    expect(c.functions!.some((f) => f.name.startsWith("func_0x"))).toBe(false);
  });
});

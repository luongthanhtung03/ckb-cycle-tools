/**
 * `report` naming functions from a binary's linker map (`"map"` in cycles.json),
 * as `flame --map` does: the binary itself runs, and a copy of it with the
 * map's functions as a symbol table is only read for where functions start
 * (`--vm-symbols`). Against test/fixtures/spawn-project, whose stripped
 * binaries were rebuilt byte for byte with the maps in test/fixtures/linkmap:
 * with a fake debugger, and with ckb-debugger 1.1.2 when it is on PATH or in
 * the cache.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { diffReports, formatMarkdown, formatText, type CycleReport } from "../src/diff.js";
import { addSymbolTable } from "../src/elfsym.js";
import { profilesChildren } from "../src/flame.js";
import { linkerMapFunctionNames, readLinkerMap } from "../src/linkmap.js";
import type { MockTransaction } from "../src/mock.js";
import type { DebuggerOutput } from "../src/profile.js";
import { formatReport, parseCyclesConfig, runReport } from "../src/report.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RELEASE = join(PROJECT, "build/release");
const PARENT_MAP = resolve("test/fixtures/linkmap/spawn-parent-text.lld.map");
const CHILD_MAP = resolve("test/fixtures/linkmap/spawn-child-text.lld.map");
const PARENT = new Uint8Array(readFileSync(join(RELEASE, "spawn-parent")));
const CHILD = new Uint8Array(readFileSync(join(RELEASE, "spawn-child")));
const PARENT_HASH = ccc.hashCkb(PARENT);
const CHILD_HASH = ccc.hashCkb(CHILD);
const heavy: MockTransaction = JSON.parse(readFileSync(join(PROJECT, "mocks/tests.test_spawn_heavy.json"), "utf8"));
const RUN_112 = readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8");

// What the profiler writes for the binaries read with the maps' symbols: frames at the functions' starts, no DWARF names.
const ROOT_FOLDED = "??:func_0x12514;??:func_0x1258e 7180\n??:func_0x12514 7794";
const CHILD_FOLDED = "??:func_0x12174;??:func_0x121bc;??:func_0x1218a 606720\n??:func_0x12174 509";

/** A ckb-debugger that answers like 1.1.2 on the heavy scenario, writing the .folded files it is told to, and recording each call. */
function fakeDebugger(version = "ckb-debugger 1.1.2") {
  const calls: string[][] = [];
  const ok = (stdout: string): DebuggerOutput => ({ stdout, stderr: "", exitCode: 0 });
  const run = async (args: string[]): Promise<DebuggerOutput> => {
    calls.push(args);
    if (args[0] === "--version") return ok(`${version}\n`);
    const i = args.indexOf("--flamegraph-output");
    if (i >= 0) writeFileSync(args[i + 1], /\.vm1\.folded$/.test(args[i + 1]) ? CHILD_FOLDED : ROOT_FOLDED);
    if (args.includes("--vm-id")) return ok(RUN_112.replace(/All cycles: 18801\(18\.4K\)\s*$/, "All cycles: 638327(623.4K)\n"));
    if (args.includes("--enable-flamegraph")) return ok(RUN_112);
    return ok("Run result: 0\nAll cycles: 761957(744.1K)\n");
  };
  return { run, calls };
}

interface Setup {
  parent?: { bytes?: Uint8Array; map?: string; symbols?: string };
  child?: { map?: string; symbols?: string } | false;
}

/**
 * A cycles.json on the heavy mock in a temporary directory, with the stripped
 * binaries swapped in (the same bytes the mock holds) and the maps copied next
 * to it as parent.map and child.map: the report names them by those paths.
 */
function config({ parent = { map: "parent.map" }, child = { map: "child.map" } }: Setup = {}): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ckb-report-map-"));
  copyFileSync(PARENT_MAP, join(dir, "parent.map"));
  copyFileSync(CHILD_MAP, join(dir, "child.map"));
  writeFileSync(join(dir, "spawn-parent"), parent.bytes ?? PARENT);
  writeFileSync(join(dir, "spawn-child"), CHILD);
  writeFileSync(join(dir, "heavy.json"), JSON.stringify(heavy));
  const binaries: Record<string, object> = {
    "spawn-parent": { path: "spawn-parent", codeHash: PARENT_HASH, ...(parent.map && { map: parent.map }), ...(parent.symbols && { symbols: parent.symbols }) },
  };
  if (child) binaries["spawn-child"] = { path: "spawn-child", codeHash: CHILD_HASH, ...child };
  const path = join(dir, "cycles.json");
  writeFileSync(path, JSON.stringify({ functions: true, binaries, scenarios: [{ name: "heavy", mock: "heavy.json" }] }));
  return { path, dir };
}

const flameCalls = (calls: string[][]) => ({
  root: calls.find((a) => a.includes("--enable-flamegraph") && !a.includes("--vm-id"))!,
  replay: calls.find((a) => a.includes("--vm-id")),
});

describe("cycles.json \"map\"", () => {
  const H = `0x${"11".repeat(32)}`;
  it("must be a path", () => {
    expect(() => parseCyclesConfig(JSON.stringify({ binaries: { x: { path: "p", codeHash: H, map: "" } }, scenarios: [] }))).toThrow(/binary "x": "map" must be a path/);
    expect(() => parseCyclesConfig(JSON.stringify({ binaries: { x: { path: "p", codeHash: H, map: 3 } }, scenarios: [] }))).toThrow(/"map" must be a path/);
  });

  it("is enough for \"functions\"; neither symbols nor map is not", () => {
    expect(parseCyclesConfig(JSON.stringify({ functions: true, binaries: { x: { path: "p", codeHash: H, map: "p.map" } }, scenarios: [{ name: "a", tx: H }] })).binaries!.x.map).toBe("p.map");
    expect(() => parseCyclesConfig(JSON.stringify({ functions: true, binaries: { x: { path: "p", codeHash: H } }, scenarios: [{ name: "a", tx: H }] }))).toThrow(
      /"functions" needs a binary with "symbols" \(an unstripped build of the same code\) or "map"/,
    );
  });
});

describe("report with linker maps (fake debugger)", () => {
  it("names the group's and the spawned script's functions from their maps, the binaries themselves running", async () => {
    const d = fakeDebugger();
    const r = await runReport(config().path, { runDebugger: d.run });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe(1);
    const [g] = r.scenarios[0].groups;
    expect(g).toMatchObject({ cycles: 761_957, spawned: 1, map: "parent.map" });
    expect(g.functionsWarning).toBeUndefined();
    expect(g.mapNote).toBeUndefined();
    expect(g.ownSymbols).toBeUndefined();
    expect(g.functions!.map((f) => f.name)).toEqual(["_start", "spawn_parent::parent_work"]);
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, codeHash: CHILD_HASH, script: "spawn-child", map: "child.map", result: 0 });
    expect(c.functionsWarning).toBeUndefined();
    expect(c.functions!.map((f) => f.name)).toEqual(["spawn_child::child_work", "_start", "__ckb_std_main"]);
    // No build ran in place of the binaries: each copy with a map's symbols was only read, as --vm-symbols.
    expect(d.calls.some((a) => a.includes("--bin"))).toBe(false);
    const { root, replay } = flameCalls(d.calls);
    expect(root[root.indexOf("--vm-symbols") + 1]).toMatch(/map-\d+\.elf$/);
    expect(replay![replay!.indexOf("--vm-symbols") + 1]).toMatch(/map-\d+\.elf$/);
    // The report names the maps as the config does, never by the runner's paths.
    expect(JSON.stringify(r)).not.toContain(PARENT_MAP);
    const text = formatReport(r);
    expect(text).toContain("costliest functions (self cycles): _start 7,794, spawn_parent::parent_work 7,180");
    expect(text).toContain("  names from the linker map parent.map (the binary itself ran): the map is not checked against the code; frames sit where the map says");
    expect(text).toContain("costliest (self): spawn_child::child_work 606,720");
    expect(text).toContain("; names from the linker map child.map (the binary itself ran)");
  });

  it("refuses another build's map, as flame does, and keeps the spawned script's profile", async () => {
    const r = await runReport(config({ parent: { map: "child.map" } }).path, { runDebugger: fakeDebugger().run });
    const [g] = r.scenarios[0].groups;
    const why = "map child.map not used: the map's .text (0x12174, 0x183c bytes) is not the binary's (0x12514, 0x25ee bytes): the map is for another build";
    expect(g).toMatchObject({ cycles: 761_957, functionsWarning: why, mapNote: why });
    expect(g.functions).toBeUndefined();
    expect(g.map).toBeUndefined();
    expect(g.children![0]).toMatchObject({ map: "child.map" });
    const text = formatReport(r);
    expect(text).toContain(`heavy input.0.lock: functions not recorded: ${why}`);
    expect(text.split(why)).toHaveLength(2); // said once, not again as a note
  });

  it("prefers a symbols build, and says the map was ignored", async () => {
    const debug = join(RELEASE, "spawn-parent.debug");
    const d = fakeDebugger();
    const r = await runReport(config({ parent: { map: "parent.map", symbols: debug } }).path, { runDebugger: d.run });
    const [g] = r.scenarios[0].groups;
    expect(g.mapNote).toBe(`map parent.map ignored: the symbols build ${debug} is given for the same binary`);
    expect(g.map).toBeUndefined();
    expect(g.functions?.length).toBeGreaterThan(0);
    const { root } = flameCalls(d.calls);
    expect(root[root.indexOf("--bin") + 1]).toBe(debug);
    expect(root).not.toContain("--vm-symbols");
    // The child, with only its map, is still named from it.
    expect(g.children![0]).toMatchObject({ map: "child.map" });
    expect(formatReport(r)).toContain(`  map parent.map ignored: the symbols build ${debug} is given for the same binary`);
  });

  it("names nothing from a map with a debugger older than 1.1.2, and says why", async () => {
    const d = fakeDebugger("ckb-debugger 1.1.1");
    const r = await runReport(config().path, { runDebugger: d.run });
    const [g] = r.scenarios[0].groups;
    expect(g.functionsWarning).toBe(
      "map parent.map not used: naming frames from a map needs ckb-debugger 1.1.2 or later (--vm-symbols); this is ckb-debugger 1.1.1",
    );
    expect(g.functions).toBeUndefined();
    expect(d.calls.some((a) => a.includes("--vm-symbols") || a.includes("--bin"))).toBe(false);
  });

  it("says when the map is not there, and measures the cycles all the same", async () => {
    const r = await runReport(config({ parent: { map: "missing.map" }, child: false }).path, { runDebugger: fakeDebugger().run });
    expect(r.scenarios[0].groups[0]).toMatchObject({ cycles: 761_957, functionsWarning: "cannot read the linker map missing.map: build it first" });
  });

  it("does not read a map outside --root", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "ckb-report-map-out-")));
    copyFileSync(PARENT_MAP, join(outside, "parent.map"));
    const { path, dir } = config({ parent: { map: join(outside, "parent.map") }, child: false });
    const r = await runReport(path, { runDebugger: fakeDebugger().run, roots: [dir] });
    expect(r.scenarios[0].groups[0].functionsWarning).toMatch(/parent\.map is outside the checkout .*: not read/);
  });

  it("names a binary that kept its own .symtab from that table: its map is not needed", async () => {
    const text = readFileSync(PARENT_MAP, "utf8");
    const { text: t, start } = readLinkerMap(text);
    const withSymtab = addSymbolTable(PARENT, linkerMapFunctionNames(text), { ...(t && { text: t }), ...(start !== undefined && { start }) }).elf;
    const r = await runReport(config({ parent: { bytes: withSymtab, map: "parent.map" } }).path, { runDebugger: fakeDebugger().run });
    const [g] = r.scenarios[0].groups;
    expect(g).toMatchObject({ ownSymbols: true });
    expect(g.mapNote).toMatch(/^map parent\.map not used: .*already has a symbol table.*no map is needed/);
    expect(g.functionsWarning).toBeUndefined();
    expect(g.map).toBeUndefined();
    expect(g.functions!.map((f) => f.name)).toEqual(["_start", "spawn_parent::parent_work"]);
    const out = formatReport(r);
    expect(out).toContain("  names from the binary's own symbol table");
    expect(out).toContain(`  ${g.mapNote}`);
  });

  it("diffs against a report named from symbols builds, and through JSON", async () => {
    const base = await runReport(config({ parent: { symbols: join(RELEASE, "spawn-parent.debug") }, child: { symbols: join(RELEASE, "spawn-child.debug") } }).path, {
      runDebugger: fakeDebugger().run,
    });
    const head = JSON.parse(JSON.stringify(await runReport(config().path, { runDebugger: fakeDebugger().run }))) as CycleReport;
    const d = diffReports(base, head);
    const [row] = d.rows;
    expect(row).toMatchObject({ kind: "same", delta: 0 });
    expect(row.functions).toBeDefined();
    expect(row.children).toHaveLength(1);
    expect(row.children![0]).toMatchObject({ vm: 1, delta: 0, changed: false });
    expect(row.functionsWarning).toBeUndefined();
    expect(formatText(d)).toContain("input.0.lock");
    expect(formatMarkdown(d)).toContain("input.0.lock");
    // And the other way round, the map-named report as the base.
    expect(diffReports(head, base).rows[0]).toMatchObject({ kind: "same", delta: 0 });
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

describe.skipIf(!debugger112)("report with linker maps, ckb-debugger 1.1.2", { timeout: 180_000 }, () => {
  it("records the same functions from the maps as from the unstripped builds", async () => {
    const built = await runReport(
      config({ parent: { symbols: join(RELEASE, "spawn-parent.debug") }, child: { symbols: join(RELEASE, "spawn-child.debug") } }).path,
      { debuggerPath: debugger112! },
    );
    const mapped = await runReport(config().path, { debuggerPath: debugger112! });
    expect(built.errors).toEqual([]);
    expect(mapped.errors).toEqual([]);
    const [b] = built.scenarios[0].groups;
    const [m] = mapped.scenarios[0].groups;
    expect(b.functionsWarning).toBeUndefined();
    expect(m.functionsWarning).toBeUndefined();
    // The stripped binary ran: the group's cycles, and what its profile covers, are the same.
    expect(m).toMatchObject({ cycles: 761_957, spawned: 1, map: "parent.map", profiled: b.profiled });
    expect(m.functions![0].name).toBe("spawn_parent::parent_work");
    // The same frames, so the same costliest functions; lld writes some names demangled where the
    // build's symbol table keeps the mangled symbol (README), so further down a name can differ.
    expect(m.functions!.slice(0, 3)).toEqual(b.functions!.slice(0, 3));
    expect(b.functions!.some((f) => f.name.startsWith("_RNv"))).toBe(true);
    expect(m.functions!.some((f) => f.name.startsWith("_RNv"))).toBe(false);
    const [mc] = m.children!;
    expect(mc).toMatchObject({ vm: 1, map: "child.map", result: 0, profiled: b.children![0].profiled });
    expect(mc.functions![0]).toEqual({ name: "spawn_child::child_work", self: 606_720, total: 606_720 });
    expect(mc.functions!.slice(0, 3)).toEqual(b.children![0].functions!.slice(0, 3));
    expect([...m.functions!, ...mc.functions!].some((f) => f.name.startsWith("func_0x"))).toBe(false);
    // So a diff between the two finds no cycle changed (only names lld demangled can differ).
    const [row] = diffReports(built, mapped).rows;
    expect(row).toMatchObject({ kind: "same", delta: 0 });
    expect(row.functionsWarning).toBeUndefined();
    expect(row.children![0]).toMatchObject({ changed: false, delta: 0 });
  });

  it("refuses another build's map, the cycles still the binary's own", async () => {
    const r = await runReport(config({ parent: { map: "child.map" }, child: false }).path, { debuggerPath: debugger112! });
    const [g] = r.scenarios[0].groups;
    expect(g).toMatchObject({ cycles: 761_957 });
    expect(g.functionsWarning).toMatch(/^map child\.map not used: the map's \.text .* is not the binary's .*: the map is for another build$/);
    expect(g.functions).toBeUndefined();
  });
});

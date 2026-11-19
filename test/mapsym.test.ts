/**
 * `--map`: a stripped binary given a symbol table from its linker map
 * (elfsym.ts), so ckb-debugger's profiler sees its functions. Against
 * test/fixtures/spawn-project, whose binaries were rebuilt byte for byte with
 * `-C link-arg=-Map=…` to write the maps (the .text part of each kept in
 * test/fixtures/linkmap): with a fake debugger, and with ckb-debugger 1.1.2
 * when it is on PATH or in the cache.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { elfFunctionNames, sameCode } from "../src/elf.js";
import { addSymbolTable } from "../src/elfsym.js";
import { functionCosts, profilesChildren } from "../src/flame.js";
import { linkerMapFunctionNames } from "../src/linkmap.js";
import type { MockTransaction } from "../src/mock.js";
import { flameTransaction, type DebuggerOutput } from "../src/profile.js";
import { groupBinary } from "../src/spawn.js";
import { groupsOf } from "../src/replay.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RELEASE = join(PROJECT, "build/release");
const file = (n: string) => new Uint8Array(readFileSync(join(RELEASE, n)));
const CHILD = file("spawn-child");
const PARENT = file("spawn-parent");
const CHILD_HASH = ccc.hashCkb(CHILD);
const CHILD_MAP = "test/fixtures/linkmap/spawn-child-text.lld.map";
const PARENT_MAP = "test/fixtures/linkmap/spawn-parent-text.lld.map";
const namesIn = (path: string) => linkerMapFunctionNames(readFileSync(path, "utf8"));
const RUN_112 = readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8");
const heavy: MockTransaction = JSON.parse(readFileSync(join(PROJECT, "mocks/tests.test_spawn_heavy.json"), "utf8"));
const LOCK = heavy.mock_info.inputs[0].output.lock.code_hash;

describe("addSymbolTable", () => {
  it("gives the stripped binary the map's functions, the loaded bytes unchanged", () => {
    for (const [bin, map, debug] of [
      [CHILD, CHILD_MAP, "spawn-child.debug"],
      [PARENT, PARENT_MAP, "spawn-parent.debug"],
    ] as const) {
      const names = namesIn(map);
      const { elf, symbols } = addSymbolTable(bin, names);
      expect(symbols).toBe(names.size);
      expect(sameCode(elf, bin)).toBe(true);
      expect(elf.subarray(0, bin.length).subarray(0x40)).toEqual(bin.subarray(0x40)); // only the ELF header's section fields change
      expect(elfFunctionNames(elf)).toEqual(names);
      // The same function starts as the unstripped build's own symbol table.
      expect([...elfFunctionNames(elf).keys()].sort()).toEqual([...elfFunctionNames(file(debug)).keys()].sort());
    }
  });

  it("writes only the functions inside the code, and refuses a map with none there", () => {
    const names = new Map([
      [0x12174n, "_start"],
      [0x10000n, "in_rodata"],
      [0xdead0000n, "nowhere"],
    ]);
    expect([...elfFunctionNames(addSymbolTable(CHILD, names).elf)]).toEqual([[0x12174n, "_start"]]);
    expect(() => addSymbolTable(CHILD, new Map([[0xdead0000n, "nowhere"]]))).toThrow(/none of the map's functions is inside the binary's code/);
  });

  it("refuses what it cannot safely extend, with a reason", () => {
    const names = namesIn(CHILD_MAP);
    const patched = (at: number, bytes: number[]) => {
      const b = CHILD.slice();
      b.set(bytes, at);
      return b;
    };
    expect(() => addSymbolTable(new Uint8Array(10), names)).toThrow(/not an ELF/);
    expect(() => addSymbolTable(patched(4, [1]), names)).toThrow(/not a 64-bit little-endian ELF/);
    expect(() => addSymbolTable(patched(0x12, [0x3e, 0]), names)).toThrow(/not RISC-V \(e_machine 62\)/);
    expect(() => addSymbolTable(file("spawn-child.debug"), names)).toThrow(/already has a symbol table: pass it with --bin/);
    expect(() => addSymbolTable(patched(0x3c, [0, 0]), names)).toThrow(/no section headers/);
    expect(() => addSymbolTable(patched(0x28, [0xff, 0xff, 0xff, 0x7f]), names)).toThrow(/section header table is malformed/);
    expect(() => addSymbolTable(CHILD.subarray(0, 4000), names)).toThrow(/no loadable code|malformed/);
    expect(() => addSymbolTable(new Uint8Array(17 << 20), names)).toThrow(/over the 16777216-byte limit/);
  });
});

describe("groupBinary", () => {
  it("finds the binary a group runs, by type hash or data hash", () => {
    const [g] = groupsOf(heavy);
    expect(sameCode(groupBinary(heavy, g)!.data, PARENT)).toBe(true);
    expect(groupBinary(heavy, { codeHash: CHILD_HASH, hashType: "data2" })!.dataHash).toBe(CHILD_HASH);
    expect(groupBinary(heavy, { codeHash: `0x${"00".repeat(32)}`, hashType: "data" })).toBeUndefined();
  });
});

/** A ckb-debugger that answers like 1.1.2 on the heavy scenario, recording each call. */
function fakeDebugger() {
  const calls: string[][] = [];
  const ok = (stdout: string): DebuggerOutput => ({ stdout, stderr: "", exitCode: 0 });
  const run = async (args: string[]): Promise<DebuggerOutput> => {
    calls.push(args);
    if (args[0] === "--version") return ok("ckb-debugger 1.1.2\n");
    if (args.includes("--vm-id")) return ok(RUN_112.replace(/All cycles: 18801\(18\.4K\)\s*$/, "All cycles: 638327(623.4K)\n"));
    if (args.includes("--enable-flamegraph")) return ok(RUN_112);
    return ok("Run result: 0\nAll cycles: 761957(744.1K)\n");
  };
  return { run, calls };
}
// What the profiler writes for the symbolized binaries: frames at the functions' starts, named by no DWARF.
const ROOT_FOLDED = "??:func_0x12514;??:func_0x1258e 7180\n??:func_0x12514 7794";
const CHILD_FOLDED = "??:func_0x12174;??:func_0x121bc;??:func_0x1218a 606720\n??:func_0x12174 509";
const readFolded = async (path: string) => (/\.vm1\.folded$/.test(path) ? CHILD_FOLDED : ROOT_FOLDED);
const readMap = async (path: string) => readFileSync(path, "utf8");

describe("flameTransaction with maps", () => {
  it("runs the deployed binaries with the maps' symbols (--bin, --vm-symbols) and names the frames", async () => {
    const d = fakeDebugger();
    const { groups } = await flameTransaction(heavy, {
      runDebugger: d.run,
      maps: { [LOCK]: PARENT_MAP, [CHILD_HASH]: CHILD_MAP },
      readFile: readFolded,
      readMap,
    });
    const [g] = groups;
    expect(g).toMatchObject({ map: PARENT_MAP, cycles: 761_957n, deployedCycles: 761_957n, deployedResult: 0 });
    expect(g.bin).toBeUndefined();
    expect(g.mapNote).toBeUndefined();
    expect(functionCosts(g.folded).map((f) => f.name)).toEqual(["_start", "spawn_parent::parent_work"]);
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, map: CHILD_MAP, result: 0 });
    expect(c.symbols).toBeUndefined();
    expect(functionCosts(c.folded).map((f) => f.name)).toEqual(["spawn_child::child_work", "_start", "__ckb_std_main"]);
    // The root ran a written copy of its own binary as --bin; the child's replay used one as --vm-symbols.
    const root = d.calls.find((a) => a.includes("--enable-flamegraph") && !a.includes("--vm-id"))!;
    const binArg = root[root.indexOf("--bin") + 1];
    expect(binArg).toMatch(/map-\d+\.elf$/);
    const replay = d.calls.find((a) => a.includes("--vm-id"))!;
    expect(replay[replay.indexOf("--vm-symbols") + 1]).toMatch(/map-\d+\.elf$/);
    expect(replay).toEqual(expect.arrayContaining(["--bin", binArg]));
    // The deployed binary ran on its own too, for the cycles check.
    expect(d.calls.some((a) => a.length === 6 && a[0] === "--tx-file")).toBe(true);
  });

  it("prefers --bin and says the map was ignored", async () => {
    const d = fakeDebugger();
    const debugBin = join(RELEASE, "spawn-parent.debug");
    const { groups } = await flameTransaction(heavy, {
      runDebugger: d.run,
      bins: { [LOCK]: debugBin, [CHILD_HASH]: join(RELEASE, "spawn-child.debug") },
      maps: { [LOCK]: PARENT_MAP, [CHILD_HASH]: CHILD_MAP },
      readFile: readFolded,
      readMap,
      readBinary: async (p) => new Uint8Array(readFileSync(p)),
    });
    const [g] = groups;
    expect(g.bin).toBe(debugBin);
    expect(g.map).toBeUndefined();
    expect(g.mapNote).toBe(`--map ${PARENT_MAP} ignored: --bin ${debugBin} is given for the same script`);
    expect(g.children![0].map).toBeUndefined();
    expect(g.children![0].mapNote).toBe(`--map ${CHILD_MAP} ignored: a build is given for VM 1's binary`);
  });

  it("leaves the frames unnamed, with a note, for a map that cannot be used", async () => {
    const d = fakeDebugger();
    const { groups } = await flameTransaction(heavy, {
      runDebugger: d.run,
      maps: { [LOCK]: "missing.map", [CHILD_HASH]: "not-a-map.txt" },
      readFile: readFolded,
      readMap: async (p) => {
        if (p === "missing.map") throw new Error("ENOENT");
        return "hello";
      },
    });
    const [g] = groups;
    expect(g.mapNote).toBe("--map missing.map not used: cannot read it: ENOENT");
    expect(g.map).toBeUndefined();
    expect(g.deployedCycles).toBeUndefined();
    expect(d.calls.some((a) => a.includes("--bin"))).toBe(false);
    expect(g.children![0].mapNote).toBe("--map not-a-map.txt not used for VM 1: it lists no function in .text: not a GNU ld or lld map?");
    expect(functionCosts(g.children![0].folded)[0].name).toBe("func_0x1218a");
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

describe.skipIf(!debugger112)("--map on the spawn fixture, with ckb-debugger 1.1.2", { timeout: 180_000 }, () => {
  it("profiles the stripped binaries exactly as their unstripped builds do", async () => {
    // Each run's .folded files as the debugger wrote them, by root or child.
    const run = async (opts: { bins?: Record<string, string>; maps?: Record<string, string> }) => {
      const raw: Record<string, string> = {};
      const { groups } = await flameTransaction(heavy, {
        debuggerPath: debugger112!,
        ...opts,
        readFile: async (p) => (raw[/\.vm1\.folded$/.test(p) ? "child" : "root"] = readFileSync(p, "utf8")),
      });
      return { g: groups[0], raw };
    };
    const built = await run({ bins: { [LOCK]: join(RELEASE, "spawn-parent.debug"), [CHILD_HASH]: join(RELEASE, "spawn-child.debug") } });
    const mapped = await run({ maps: { [LOCK]: PARENT_MAP, [CHILD_HASH]: CHILD_MAP } });
    expect(mapped.raw.root).toBe(built.raw.root);
    expect(mapped.raw.child).toBe(built.raw.child);
    expect(mapped.raw.child.split("\n").length).toBeGreaterThan(1000);
    // The cycles check: the deployed binary costs what the symbolized copy does.
    expect(mapped.g).toMatchObject({ map: PARENT_MAP, cycles: 761_957n, deployedCycles: 761_957n, deployedResult: 0 });
    expect(mapped.g.children![0]).toMatchObject({ map: CHILD_MAP, result: 0, cycles: 638_327n });
    // Named from the maps, which lld writes demangled.
    expect(functionCosts(mapped.g.children![0].folded)[0]).toMatchObject({ name: "spawn_child::child_work", self: 606_720n });
    expect(functionCosts(mapped.g.folded)[0].name).toBe("spawn_parent::parent_work");
  });
});

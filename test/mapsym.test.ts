/**
 * `--map`: a stripped binary given a symbol table from its linker map
 * (elfsym.ts), so ckb-debugger's profiler sees its functions. Against
 * test/fixtures/spawn-project, whose binaries were rebuilt byte for byte with
 * `-C link-arg=-Map=…` to write the maps (the .text part of each kept in
 * test/fixtures/linkmap): with a fake debugger, and with ckb-debugger 1.1.2
 * when it is on PATH or in the cache. With 1.1.2, also a real deployed GNU ld
 * binary from test/fixtures/hardfork-mocks.json.br, with a map written from
 * the binary's own code.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { elfFunctionNames, sameCode } from "../src/elf.js";
import { addSymbolTable, MAX_SYMBOL_NAME } from "../src/elfsym.js";
import { functionCosts, profilesChildren } from "../src/flame.js";
import { linkerMapFunctionNames, readLinkerMap } from "../src/linkmap.js";
import type { MockTransaction } from "../src/mock.js";
import { flameTransaction, MAX_LINKER_MAP, type DebuggerOutput } from "../src/profile.js";
import { groupBinary } from "../src/spawn.js";
import { groupsOf } from "../src/replay.js";
import { unpackFixture, type PackedFixture } from "../scripts/hardfork-lib.js";

const PROJECT = resolve("test/fixtures/spawn-project");
const RELEASE = join(PROJECT, "build/release");
const file = (n: string) => new Uint8Array(readFileSync(join(RELEASE, n)));
const CHILD = file("spawn-child");
const PARENT = file("spawn-parent");
const CHILD_HASH = ccc.hashCkb(CHILD);
const CHILD_MAP = "test/fixtures/linkmap/spawn-child-text.lld.map";
const PARENT_MAP = "test/fixtures/linkmap/spawn-parent-text.lld.map";
const namesIn = (path: string) => linkerMapFunctionNames(readFileSync(path, "utf8"));
const claimsIn = (path: string) => {
  const { text, start } = readLinkerMap(readFileSync(path, "utf8"));
  return { ...(text && { text }), ...(start !== undefined && { start }) };
};
/** Bytes of `a` that differ from `b`, over `b`'s length. */
const changedBytes = (a: Uint8Array, b: Uint8Array) => [...b.keys()].filter((i) => a[i] !== b[i]);
/** The ELF header bytes a copy may change: e_shoff, e_shnum. */
const SECTION_FIELDS = [0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x3c, 0x3d, 0x3e, 0x3f];
const RUN_112 = readFileSync(join(PROJECT, "flamegraph-run-1.1.2.txt"), "utf8");
const heavy: MockTransaction = JSON.parse(readFileSync(join(PROJECT, "mocks/tests.test_spawn_heavy.json"), "utf8"));
const LOCK = heavy.mock_info.inputs[0].output.lock.code_hash;

describe("addSymbolTable", () => {
  it("gives the stripped binary the map's functions, changing only the ELF header's section fields", () => {
    for (const [bin, map, debug] of [
      [CHILD, CHILD_MAP, "spawn-child.debug"],
      [PARENT, PARENT_MAP, "spawn-parent.debug"],
    ] as const) {
      const names = namesIn(map);
      const { elf, symbols } = addSymbolTable(bin, names, claimsIn(map));
      expect(symbols).toBe(names.size);
      expect(sameCode(elf, bin)).toBe(true);
      // Only the ELF header's section fields change; the rest is appended.
      expect(changedBytes(elf, bin).every((i) => SECTION_FIELDS.includes(i))).toBe(true);
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
    expect(() => addSymbolTable(file("spawn-child.debug"), names)).toThrow(/already has a symbol table, so ckb-debugger opens its frames without a map: no map is needed/);
    expect(() => addSymbolTable(patched(0x3c, [0, 0]), names)).toThrow(/no section headers/);
    expect(() => addSymbolTable(patched(0x28, [0xff, 0xff, 0xff, 0x7f]), names)).toThrow(/section header table is malformed/);
    expect(() => addSymbolTable(CHILD.subarray(0, 4000), names)).toThrow(/no loadable code|malformed/);
    expect(() => addSymbolTable(new Uint8Array(17 << 20), names)).toThrow(/over the 16777216-byte limit/);
  });

  it("takes the GNU ld layout, where the ELF header is inside the executable segment (review, 24 Nov)", () => {
    // The child with its first PT_LOAD (offset 0: the ELF header) made executable, as GNU ld lays out a binary.
    const gnu = CHILD.slice();
    new DataView(gnu.buffer).setUint32(64 + 56 + 4, 5, true);
    const { elf } = addSymbolTable(gnu, namesIn(CHILD_MAP), claimsIn(CHILD_MAP));
    expect(changedBytes(elf, gnu).length).toBeGreaterThan(0);
    expect(changedBytes(elf, gnu).every((i) => SECTION_FIELDS.includes(i))).toBe(true);
    expect(elfFunctionNames(elf)).toEqual(namesIn(CHILD_MAP));
  });

  it("refuses a map whose .text or _start is not the binary's", () => {
    // The child's map on the parent: _start 0x12174, the parent's entry point 0x12514.
    expect(() => addSymbolTable(PARENT, namesIn(CHILD_MAP), claimsIn(CHILD_MAP))).toThrow(
      /the map's \.text \(0x12174, 0x183c bytes\) is not the binary's \(0x12514, 0x25ee bytes\): the map is for another build/,
    );
    expect(() => addSymbolTable(PARENT, namesIn(CHILD_MAP), { start: 0x12174n })).toThrow(
      /the map's _start \(0x12174\) is not the binary's entry point \(0x12514\): the map is for another build/,
    );
    // What a map does not give is not checked.
    expect(addSymbolTable(PARENT, namesIn(PARENT_MAP), {}).symbols).toBe(namesIn(PARENT_MAP).size);
  });

  it("cuts a long name at a character boundary", () => {
    for (const tail of ["é", "€", "😀"]) {
      const name = "x".repeat(MAX_SYMBOL_NAME - 1) + tail;
      const [written] = elfFunctionNames(addSymbolTable(CHILD, new Map([[0x12174n, name]])).elf).values();
      expect(written).toBe("x".repeat(MAX_SYMBOL_NAME - 1));
    }
    const fits = "x".repeat(MAX_SYMBOL_NAME - 2) + "é";
    expect([...elfFunctionNames(addSymbolTable(CHILD, new Map([[0x12174n, fits]])).elf).values()]).toEqual([fits]);
  });

  it("names only code: an allocated, executable section inside an executable segment", () => {
    const names = namesIn(CHILD_MAP);
    const view = new DataView(CHILD.buffer, CHILD.byteOffset, CHILD.byteLength);
    const shoff = Number(view.getBigUint64(0x28, true));
    const text = [...Array(view.getUint16(0x3c, true)).keys()].find((i) => view.getBigUint64(shoff + i * 64 + 8, true) & 4n)!;
    const flagsAt = shoff + text * 64 + 8;
    const withFlags = (flags: number) => {
      const b = CHILD.slice();
      new DataView(b.buffer).setUint32(flagsAt, flags, true);
      return b;
    };
    expect(() => addSymbolTable(withFlags(0x4), names)).toThrow(/none of the map's functions is inside the binary's code/); // not SHF_ALLOC
    // .text moved outside every executable segment by its header.
    const moved = CHILD.slice();
    new DataView(moved.buffer).setBigUint64(shoff + text * 64 + 0x10, 0x7000_0000n, true);
    expect(() => addSymbolTable(moved, names)).toThrow(/none of the map's functions is inside the binary's code/);
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
function fakeDebugger(version = "ckb-debugger 1.1.2") {
  const calls: string[][] = [];
  const ok = (stdout: string): DebuggerOutput => ({ stdout, stderr: "", exitCode: 0 });
  const run = async (args: string[]): Promise<DebuggerOutput> => {
    calls.push(args);
    if (args[0] === "--version") return ok(`${version}\n`);
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
  it("runs the deployed binaries, with copies holding the maps' symbols as --vm-symbols, and names the frames", async () => {
    const d = fakeDebugger();
    const { groups, notes } = await flameTransaction(heavy, {
      runDebugger: d.run,
      maps: { [LOCK]: PARENT_MAP, [CHILD_HASH]: CHILD_MAP },
      readFile: readFolded,
      readMap,
    });
    const [g] = groups;
    expect(g).toMatchObject({ map: PARENT_MAP, cycles: 761_957n, result: 0 });
    expect(notes).toBeUndefined();
    // The deployed binary ran: there is nothing to check against it.
    expect(g.bin).toBeUndefined();
    expect(g.deployedCycles).toBeUndefined();
    expect(g.mapNote).toBeUndefined();
    expect(functionCosts(g.folded).map((f) => f.name)).toEqual(["_start", "spawn_parent::parent_work"]);
    const [c] = g.children!;
    expect(c).toMatchObject({ vm: 1, map: CHILD_MAP, result: 0 });
    expect(c.symbols).toBeUndefined();
    expect(functionCosts(c.folded).map((f) => f.name)).toEqual(["spawn_child::child_work", "_start", "__ckb_std_main"]);
    // Nothing ran a written copy: the root's flamegraph run and the child's replay read one each as --vm-symbols.
    expect(d.calls.some((a) => a.includes("--bin"))).toBe(false);
    const root = d.calls.find((a) => a.includes("--enable-flamegraph") && !a.includes("--vm-id"))!;
    const replay = d.calls.find((a) => a.includes("--vm-id"))!;
    const rootSymbols = root[root.indexOf("--vm-symbols") + 1];
    expect(rootSymbols).toMatch(/map-\d+\.elf$/);
    expect(replay[replay.indexOf("--vm-symbols") + 1]).toMatch(/map-\d+\.elf$/);
    expect(replay[replay.indexOf("--vm-symbols") + 1]).not.toBe(rootSymbols);
    expect(replay.filter((a) => a === "--vm-symbols")).toHaveLength(1);
    // One plain run, of the deployed binary, for the result and cycles.
    expect(d.calls.filter((a) => a[0] === "--tx-file" && !a.includes("--enable-flamegraph"))).toEqual([root.slice(0, 6)]);
  });

  it("leaves the frames unnamed with a debugger older than 1.1.2 (no --vm-symbols)", async () => {
    const d = fakeDebugger("ckb-debugger 1.1.1");
    const { groups } = await flameTransaction(heavy, {
      runDebugger: d.run,
      maps: { [LOCK]: PARENT_MAP },
      readFile: readFolded,
      readMap,
    });
    const [g] = groups;
    expect(g.map).toBeUndefined();
    expect(g.mapNote).toBe(`--map ${PARENT_MAP} not used: naming frames from a map needs ckb-debugger 1.1.2 or later (--vm-symbols); this is ckb-debugger 1.1.1`);
    expect(d.calls.some((a) => a.includes("--bin") || a.includes("--vm-symbols"))).toBe(false);
    expect(functionCosts(g.folded)[0].name).toMatch(/^func_0x/);
  });

  it("refuses the child's map for the parent, and notes a map no script has the hash of", async () => {
    const d = fakeDebugger();
    const stray = `0x${"ab".repeat(32)}`;
    const { groups, notes } = await flameTransaction(heavy, {
      runDebugger: d.run,
      maps: { [LOCK]: CHILD_MAP, [stray]: PARENT_MAP },
      readFile: readFolded,
      readMap,
    });
    const [g] = groups;
    expect(g.map).toBeUndefined();
    expect(g.mapNote).toBe(
      `--map ${CHILD_MAP} not used: the map's .text (0x12174, 0x183c bytes) is not the binary's (0x12514, 0x25ee bytes): the map is for another build`,
    );
    expect(d.calls.some((a) => a.includes("--vm-symbols") && !a.includes("--vm-id"))).toBe(false);
    expect(notes).toEqual([`--map ${stray}=${PARENT_MAP}: no script profiled in this transaction has that hash`]);
  });

  it("checks a map's size before reading it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ckb-map-size-"));
    try {
      const big = join(dir, "big.map");
      writeFileSync(big, "");
      truncateSync(big, MAX_LINKER_MAP + 1); // sparse: only its size is looked at
      const { groups } = await flameTransaction(heavy, { runDebugger: fakeDebugger().run, maps: { [LOCK]: big }, readFile: readFolded });
      expect(groups[0].mapNote).toBe(`--map ${big} not used: it is ${MAX_LINKER_MAP + 1} bytes, over 64 MB: not a linker map?`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe.skipIf(!debugger112)("--map with ckb-debugger 1.1.2", { timeout: 180_000 }, () => {
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
    // The deployed binaries ran, so their cycles are the group's and the replay's own.
    expect(mapped.g).toMatchObject({ map: PARENT_MAP, cycles: 761_957n, result: 0 });
    expect(mapped.g.deployedCycles).toBeUndefined();
    expect(built.g).toMatchObject({ cycles: 761_957n, deployedCycles: 761_957n });
    expect(mapped.g.children![0]).toMatchObject({ map: CHILD_MAP, result: 0, cycles: 638_327n });
    // Named from the maps, which lld writes demangled.
    expect(functionCosts(mapped.g.children![0].folded)[0]).toMatchObject({ name: "spawn_child::child_work", self: 606_720n });
    expect(functionCosts(mapped.g.folded)[0].name).toBe("spawn_parent::parent_work");
  });

  /**
   * A real deployed GNU ld binary: the mainnet secp256k1-blake160 lock in
   * test/fixtures/hardfork-mocks.json.br, stripped, its ELF header inside the
   * executable segment (the layout every map copy was refused for before, review
   * 24 Nov). No map of its build exists, so one is written in GNU ld's format
   * from what the binary itself says: `.text` from its section header, `_start`
   * at its entry point, and a function at each address a `jal ra` in its code
   * calls (decoded in order through `.text`).
   */
  it("profiles a GNU ld binary from a GNU-format map, the deployed binary running", async () => {
    const packed = JSON.parse(brotliDecompressSync(readFileSync("test/fixtures/hardfork-mocks.json.br")).toString("utf8")) as PackedFixture;
    const { mock } = unpackFixture(packed)[0];
    const [g] = groupsOf(mock);
    const elf = groupBinary(mock, g)!.data;
    const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
    // GNU ld's layout: the first PT_LOAD starts at offset 0 and is executable.
    const phoff = Number(view.getBigUint64(0x20, true));
    expect([view.getUint32(phoff, true), Number(view.getBigUint64(phoff + 8, true)), view.getUint32(phoff + 4, true) & 1]).toEqual([1, 0, 1]);
    expect(elfFunctionNames(elf).size).toBe(0);
    const shoff = Number(view.getBigUint64(0x28, true));
    const textAt = [...Array(view.getUint16(0x3c, true)).keys()].map((i) => shoff + i * 64).find((o) => view.getBigUint64(o + 8, true) & 4n)!;
    const text = { addr: view.getBigUint64(textAt + 0x10, true), offset: Number(view.getBigUint64(textAt + 0x18, true)), size: view.getBigUint64(textAt + 0x20, true) };
    const entry = view.getBigUint64(0x18, true);
    const calls = new Set<bigint>();
    for (let at = 0; at < Number(text.size); ) {
      if ((view.getUint16(text.offset + at, true) & 3) !== 3) {
        at += 2; // a compressed instruction
        continue;
      }
      const ins = view.getUint32(text.offset + at, true);
      if ((ins & 0x7f) === 0x6f && ((ins >> 7) & 31) === 1) {
        // jal ra, imm[20|10:1|11|19:12]
        const imm = (((ins >>> 31) << 20) | (((ins >>> 21) & 0x3ff) << 1) | (((ins >>> 20) & 1) << 11) | (((ins >>> 12) & 0xff) << 12)) << 11 >> 11;
        const target = text.addr + BigInt(at) + BigInt(imm);
        if (target >= text.addr && target < text.addr + text.size) calls.add(target);
      }
      at += 4;
    }
    expect(calls.size).toBeGreaterThan(20);
    const at16 = (n: bigint) => `0x${n.toString(16).padStart(16, "0")}`;
    const mapText = [
      "Linker script and memory map",
      "",
      `.text           ${at16(text.addr)}     0x${text.size.toString(16)}`,
      ` .text          ${at16(text.addr)}     0x${text.size.toString(16)} secp256k1_blake160_sighash_all.o`,
      `                ${at16(entry)}                _start`,
      ...[...calls].map((c) => `                ${at16(c)}                fn_${c.toString(16)}`),
    ].join("\n");
    const names = linkerMapFunctionNames(mapText);
    expect(readLinkerMap(mapText)).toMatchObject({ text: { addr: text.addr, size: text.size }, start: entry });

    const dir = mkdtempSync(join(tmpdir(), "ckb-gnu-map-"));
    try {
      const mapFile = join(dir, "secp256k1.map");
      writeFileSync(mapFile, mapText);
      // The copy as --bin too, as the reviewer ran it: it executes, so its folded stacks and cycles must be the same.
      const copy = addSymbolTable(elf, names, { text, start: entry }).elf;
      expect(sameCode(copy, elf)).toBe(false); // the ELF header is in the code: why the old check refused every such binary
      const copyFile = join(dir, "secp256k1.sym.elf");
      writeFileSync(copyFile, copy);
      const run = async (opts: { bins?: Record<string, string>; maps?: Record<string, string> }) => {
        let raw = "";
        const { groups } = await flameTransaction(mock, { debuggerPath: debugger112!, ...opts, readFile: async (p) => (raw = readFileSync(p, "utf8")) });
        return { g: groups[0], raw };
      };
      const plain = await run({});
      const mapped = await run({ maps: { [g.codeHash]: mapFile } });
      const asBin = await run({ bins: { [g.codeHash]: copyFile } });
      expect(plain.raw.trim().split("\n")).toHaveLength(1); // stripped: one frame
      expect(mapped.g.mapNote).toBeUndefined();
      expect(mapped.g).toMatchObject({ map: mapFile, result: 0, cycles: plain.g.cycles });
      expect(asBin.g).toMatchObject({ result: 0, cycles: plain.g.cycles, deployedCycles: plain.g.cycles });
      expect(mapped.raw).toBe(asBin.raw);
      expect(mapped.raw.split("\n").length).toBeGreaterThan(100);
      // Every frame opened at an address the map gave, and is named by it.
      const frames = new Set([...mapped.g.folded.keys()].flatMap((s) => s.split(";")));
      expect([...frames].every((f) => [...names.values()].includes(f))).toBe(true);
      expect(frames.size).toBeGreaterThan(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

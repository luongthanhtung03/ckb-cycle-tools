import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { elfFunctionNames } from "../src/elf.js";
import { linkerMapFunctionNames, readLinkerMap } from "../src/linkmap.js";

const fixture = (name: string) => readFileSync(`test/fixtures/linkmap/${name}`, "utf8");
const hex = (m: Map<bigint, string>) => Object.fromEntries([...m].map(([a, n]) => [`0x${a.toString(16)}`, n]));

describe("linkerMapFunctionNames: lld", () => {
  it("names the functions of .text from symbols and section names, nothing else", () => {
    expect(hex(linkerMapFunctionNames(fixture("lld.map")))).toEqual({
      "0x111c8": "_start", // not __text_start, a section bound at the same address
      "0x111f4": "crowns::game::replay", // legacy name, hash dropped
      "0x11298": "crowns::game::step", // v0 name
      "0x112f6": "memcpy", // an alias listed after it does not win; the empty section before it gives nothing
      "0x11336": "crowns::helper", // no symbol listed: the -ffunction-sections section name
      "0x11396": "syscall_asm", // $x and .Ltmp0 skipped
    });
  });

  it("reads the older table without the LMA column", () => {
    const map = [
      "         Address     Size Align Out     In      Symbol",
      "           10000      100     4 .text",
      "           10000       20     4         a.o:(.text.main)",
      "           10000       20     1                 main",
      "           10020       e0     4         a.o:(.text)",
      "           10020        0     1                 helper",
    ].join("\n");
    expect(hex(linkerMapFunctionNames(map))).toEqual({ "0x10000": "main", "0x10020": "helper" });
  });

  it("keeps a demangled name with spaces and brackets, as lld prints it, and skips assignments", () => {
    const map = [
      "             VMA              LMA     Size Align Out     In      Symbol",
      "           10000            10000      100     4 .text",
      "           10000            10000       40     2         a.o:(.text._ZN4core3ptr4drop17h0123456789abcdefE)",
      "           10000            10000       40     1                 <alloc::vec::Vec<T> as core::ops::drop::Drop>::drop::h0123456789abcdef",
      "           10040            10040        0     1         PROVIDE_HIDDEN(__thing = .)",
      "           10040            10040       10     2         a.o:(.text._ZN1a1f17h0000000000000000E)",
      "           10040            10040       10     1                 a::f::h0000000000000000",
      "           10050            10050        0     1                 PROVIDE(x = .)",
      "           10050            10050        0     1                 y = .",
    ].join("\r\n");
    expect(hex(linkerMapFunctionNames(map))).toEqual({
      "0x10000": "<alloc::vec::Vec<T> as core::ops::drop::Drop>::drop",
      "0x10040": "a::f",
    });
  });

  it("gives the same functions at the same addresses as the unstripped build's symbol table (spawn fixture, rust-lld)", () => {
    // The .text part of the map rust-lld wrote for test/fixtures/spawn-project's spawn-child, rebuilt
    // byte for byte (elf.ts sameCode) with `cargo rustc --release -p spawn-child -- -C link-arg=-Map=…`.
    const map = linkerMapFunctionNames(fixture("spawn-child-text.lld.map"));
    const elf = elfFunctionNames(new Uint8Array(readFileSync("test/fixtures/spawn-project/build/release/spawn-child.debug")));
    expect([...map.keys()].sort()).toEqual([...elf.keys()].sort());
    // Where elf.ts can demangle the name, the two agree; lld demangles the rest (trait and inherent impls) itself.
    for (const [at, name] of elf) if (!/^_[RZ]/.test(name)) expect(map.get(at)).toBe(name);
    expect(map.get(0x12174n)).toBe("_start");
    expect(map.get(0x1218an)).toBe("spawn_child::child_work");
    expect(map.get(0x121bcn)).toBe("__ckb_std_main");
    expect(map.get(0x131fen)).toBe("<core::ffi::c_str::CStr>::to_str");
  });
});

describe("linkerMapFunctionNames: GNU ld", () => {
  it("names the functions of .text from global symbols and input sections, skipping discarded ones", () => {
    expect(hex(linkerMapFunctionNames(fixture("gnu-ld.map")))).toEqual({
      "0x10108": "_start",
      "0x10134": "crowns::game::replay", // section name on its own line, address on the next
      "0x101d8": "crowns_helper_alias", // a global symbol wins over the section name
      "0x10200": "cold_path", // GCC's .text.unlikely. prefix dropped
      "0x10212": "memcpy",
      "0x10252": "crowns::game::step", // not .text.empty: it holds nothing
    });
  });

  it("reads a map with no header (a snippet), ignoring lines it cannot read", () => {
    const map = [
      ".text           0x0000000000010000       0x40",
      " .text.main     0x0000000000010000       0x20 main.o",
      "                0x0000000000010000                main",
      "                0x0000000000010020                PROVIDE (etext = .)",
      "not a map line",
      " .text          0x0000000000010020       0x20 lib.o",
      "                0x0000000000010020                lib_fn",
      ".bss            0x0000000000011000       0x10",
      "                0x0000000000011000                counter",
    ].join("\n");
    expect(hex(linkerMapFunctionNames(map))).toEqual({ "0x10000": "main", "0x10020": "lib_fn" });
  });
});

describe("linkerMapFunctionNames: not a map", () => {
  it("gives nothing for empty or unrelated text", () => {
    expect(linkerMapFunctionNames("").size).toBe(0);
    expect(linkerMapFunctionNames("hello\n0x10 world\n  12 34 5 .text\n").size).toBe(0);
    expect(linkerMapFunctionNames(readFileSync("README.md", "utf8")).size).toBe(0);
  });
});

describe("readLinkerMap: what tells another build's map apart", () => {
  it("gives .text's address and size and _start's address, in both formats", () => {
    expect(readLinkerMap(fixture("lld.map"))).toMatchObject({ text: { addr: 0x111c8n, size: 0x3a4n }, start: 0x111c8n });
    expect(readLinkerMap(fixture("gnu-ld.map"))).toMatchObject({ text: { addr: 0x10108n, size: 0x1a2n }, start: 0x10108n });
    expect(readLinkerMap(fixture("spawn-child-text.lld.map"))).toMatchObject({ text: { addr: 0x12174n, size: 0x183cn }, start: 0x12174n });
    expect(readLinkerMap(fixture("spawn-parent-text.lld.map"))).toMatchObject({ text: { addr: 0x12514n, size: 0x25een }, start: 0x12514n });
  });

  it("leaves out what the map does not say", () => {
    const map = readLinkerMap("Linker script and memory map\n.text 0x10000 0x20\n .text 0x10000 0x20 a.o\n                0x10000                main\n");
    expect(map.text).toEqual({ addr: 0x10000n, size: 0x20n });
    expect(map.start).toBeUndefined();
    expect(readLinkerMap("").text).toBeUndefined();
  });
});

describe("linkerMapFunctionNames: time", () => {
  // `(\S.*?)\s*$` backtracked quadratically: 6.3 s for this row (review, 24 Nov).
  const H = "             VMA              LMA     Size Align Out     In      Symbol\n";
  const timed = (text: string) => {
    const t = performance.now();
    linkerMapFunctionNames(text);
    return performance.now() - t;
  };

  it("reads a row with a long run of spaces in linear time", () => {
    expect(timed(`${H}0 0 0 1 x${" ".repeat(40_000)}y\n`)).toBeLessThan(200);
    expect(timed(`${H}0 0 0 1 ${" \t".repeat(40_000)}\n`)).toBeLessThan(200);
    expect(timed(`${H}${"0 ".repeat(40_000)}\n`)).toBeLessThan(200);
    expect(timed(`Linker script and memory map\n.text 0x0 0x10\n ${"0x1 ".repeat(40_000)}\n${" ".repeat(40_000)}0x1${" ".repeat(40_000)}\n`)).toBeLessThan(200);
  });

  it("still reads a name with spaces, without its trailing blanks", () => {
    const map = `${H}           10000            10000      100     4 .text\n           10000            10000       20     2         a.o:(.text)\n           10000            10000        0     1                 <T as core::fmt::Debug>::fmt   \t\n`;
    expect(hex(linkerMapFunctionNames(map))).toEqual({ "0x10000": "<T as core::fmt::Debug>::fmt" });
  });
});

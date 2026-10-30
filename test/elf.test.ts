import { describe, expect, it } from "vitest";
import { demangle, elfFunctionNames } from "../src/elf.js";
import { nameAddresses, parseFolded } from "../src/flame.js";

/**
 * A minimal ELF64 little-endian file: a null section, .symtab, .strtab, .text
 * (executable) and .bss. `symbols`: [name, address, info, section index]
 * (info 0x12 = global function, 0x10 = global no type; section 3 = .text unless given).
 */
function elf(symbols: [string, bigint, number, number?][]): Uint8Array {
  const strtab = [0];
  const offsets = symbols.map(([name]) => {
    const at = strtab.length;
    strtab.push(...new TextEncoder().encode(name), 0);
    return at;
  });
  const symtabOff = 64;
  const symtabSize = 24 * (symbols.length + 1);
  const strtabOff = symtabOff + symtabSize;
  const shoff = strtabOff + strtab.length;
  const buf = new Uint8Array(shoff + 64 * 5);
  const v = new DataView(buf.buffer);
  buf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  v.setBigUint64(0x28, BigInt(shoff), true);
  v.setUint16(0x3a, 64, true);
  v.setUint16(0x3c, 5, true);
  symbols.forEach(([, addr, info, shndx = 3], i) => {
    const o = symtabOff + 24 * (i + 1);
    v.setUint32(o, offsets[i], true);
    buf[o + 4] = info;
    v.setUint16(o + 6, shndx, true);
    v.setBigUint64(o + 8, addr, true);
  });
  buf.set(strtab, strtabOff);
  const section = (i: number, type: number, off: number, size: number, link: number, entsize: number, flags = 0) => {
    const o = shoff + 64 * i;
    v.setUint32(o + 4, type, true);
    v.setBigUint64(o + 8, BigInt(flags), true);
    v.setBigUint64(o + 0x18, BigInt(off), true);
    v.setBigUint64(o + 0x20, BigInt(size), true);
    v.setUint32(o + 0x28, link, true);
    v.setBigUint64(o + 0x38, BigInt(entsize), true);
  };
  section(1, 2, symtabOff, symtabSize, 2, 24);
  section(2, 3, strtabOff, strtab.length, 0, 0);
  section(3, 1, 0, 0, 0, 0, 0x6); // .text: SHF_ALLOC | SHF_EXECINSTR
  section(4, 8, 0, 0, 0, 0, 0x3); // .bss: SHF_WRITE | SHF_ALLOC
  return buf;
}

describe("demangle", () => {
  it("follows v0 paths, as llvm-nm -C prints them", () => {
    // From a ckb-script-templates contract built with rustc 1.99.
    expect(demangle("_RNvCsdtSMxSA38aw_7___rustc35___rust_no_alloc_shim_is_unstable_v2")).toBe(
      "__rustc::__rust_no_alloc_shim_is_unstable_v2",
    );
    expect(demangle("_RNvNtCs1234_7ckb_std8syscalls4exit")).toBe("ckb_std::syscalls::exit");
  });

  it("drops the hash of a legacy name", () => {
    expect(demangle("_ZN4core9panicking5panic17h0123456789abcdefE")).toBe("core::panicking::panic");
  });

  it("leaves what it does not follow as it is", () => {
    const impl = "_RNvMs0_NtCsbaiYuaNGxW8_11buddy_alloc10fast_allocNtB5_9FastAlloc3new";
    expect(demangle(impl)).toBe(impl);
    expect(demangle("_start")).toBe("_start");
    expect(demangle("_ZN3foo")).toBe("_ZN3foo");
  });
});

describe("elfFunctionNames", () => {
  it("reads function symbols and assembly labels", () => {
    const names = elfFunctionNames(
      elf([
        ["_start", 0x130c4n, 0x10],
        ["_RNvCsdtSMxSA38aw_7___rustc35___rust_no_alloc_shim_is_unstable_v2", 0x1338en, 0x12],
        ["local_label", 0x14000n, 0x00], // local, no type: not a function
      ]),
    );
    expect([...names]).toEqual([
      [0x130c4n, "_start"],
      [0x1338en, "__rustc::__rust_no_alloc_shim_is_unstable_v2"],
    ]);
  });

  it("skips linker markers: absolute symbols, labels outside code, and section bounds", () => {
    const names = elfFunctionNames(
      elf([
        ["__text_start", 0x130c4n, 0x10], // listed first, at _start's address
        ["_start", 0x130c4n, 0x10],
        ["__global_pointer$", 0x14800n, 0x10, 0xfff1], // SHN_ABS
        ["__bss_start", 0x15000n, 0x10, 4],
        ["_etext", 0x14000n, 0x10],
      ]),
    );
    expect([...names]).toEqual([[0x130c4n, "_start"]]);
  });

  it("gives nothing for a file that is not an ELF64 or has no symbol table", () => {
    expect(elfFunctionNames(new Uint8Array(100)).size).toBe(0);
    expect(elfFunctionNames(elf([]).slice(0, 70)).size).toBe(0);
  });
});

describe("nameAddresses", () => {
  it("names func_0x frames and merges the stacks that become one", () => {
    const folded = parseFolded(["??:func_0x130c4;main.rs:alpha::run 10", "??:func_0x130c4 5", "??:func_0x99 1"].join("\n"));
    const named = nameAddresses(folded, new Map([[0x130c4n, "_start"]]));
    expect([...named]).toEqual([
      ["_start;alpha::run", 10n],
      ["_start", 5n],
      ["func_0x99", 1n],
    ]);
  });
});

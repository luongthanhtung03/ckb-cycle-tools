/**
 * Gives a stripped CKB binary a symbol table, so ckb-debugger's profiler can
 * see its functions. The profiler opens a frame only where a jump lands on a
 * function the ELF symbol table lists, so a stripped binary profiles as one
 * frame, and naming frames afterwards cannot split it. A linker map of the
 * same build (linkmap.ts) says where each function starts; written into the
 * binary as `.symtab`, it gives the profiler the frames an unstripped build
 * would. Every byte the VM loads stays the deployed binary's: the table, its
 * strings and a new section header table are appended after the end of the
 * file, where no segment reaches, and the result is checked with elf.ts
 * `sameCode` before it is returned. Plain TypeScript with no Node built-ins,
 * like elf.ts.
 */
import { elfCode, sameCode } from "./elf.js";

/** The largest binary taken: far over what a CKB cell can hold. */
export const MAX_SYMBOLIZED_ELF = 16 << 20;
/** The most functions written, and the longest name (longer ones are cut). */
export const MAX_SYMBOLS = 200_000;
export const MAX_SYMBOL_NAME = 4096;

const EM_RISCV = 243;
const SHT_SYMTAB = 2;
const SHT_STRTAB = 3;
const SHF_EXECINSTR = 0x4n;
const SHN_LORESERVE = 0xff00;
/** STB_GLOBAL, STT_FUNC. */
const GLOBAL_FUNC = 0x12;

/**
 * A copy of `elf` (a 64-bit little-endian RISC-V ELF, stripped) with a
 * symbol table listing `names` (start address → name) as functions. Only the
 * addresses inside an executable section are written; each function's size
 * runs to the next one, or to the end of its section. Throws, with a message
 * for a user, on anything else: not such an ELF, no section headers, a binary
 * that already has a symbol table (its own symbols are better; pass it with
 * `--bin`), no name inside the code, or a result whose loaded bytes differ
 * from the input's (never expected; checked all the same).
 */
export function addSymbolTable(elf: Uint8Array, names: Map<bigint, string>): { elf: Uint8Array; symbols: number } {
  if (elf.length > MAX_SYMBOLIZED_ELF) throw new Error(`the binary is ${elf.length} bytes, over the ${MAX_SYMBOLIZED_ELF}-byte limit`);
  if (elf.length < 64 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) throw new Error("the binary is not an ELF file");
  if (elf[4] !== 2 || elf[5] !== 1) throw new Error("the binary is not a 64-bit little-endian ELF (a CKB script is RISC-V 64)");
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  if (view.getUint16(0x12, true) !== EM_RISCV) throw new Error(`the binary is not RISC-V (e_machine ${view.getUint16(0x12, true)})`);
  const shoff = Number(view.getBigUint64(0x28, true));
  const shentsize = view.getUint16(0x3a, true);
  const shnum = view.getUint16(0x3c, true);
  const shstrndx = view.getUint16(0x3e, true);
  if (!elfCode(elf)) throw new Error("the binary has no loadable code (or its program headers are malformed)");
  if (!shnum || !shoff) throw new Error("the binary has no section headers to add a symbol table to");
  if (shentsize !== 64 || shoff + shnum * 64 > elf.length) throw new Error("the binary's section header table is malformed");
  if (shstrndx === 0 || shstrndx >= shnum) throw new Error("the binary has no section name table");
  if (shnum + 2 >= SHN_LORESERVE) throw new Error("the binary has too many sections");
  const header = (i: number) => {
    const o = shoff + i * 64;
    return {
      o,
      type: view.getUint32(o + 4, true),
      flags: view.getBigUint64(o + 8, true),
      addr: view.getBigUint64(o + 0x10, true),
      offset: Number(view.getBigUint64(o + 0x18, true)),
      size: view.getBigUint64(o + 0x20, true),
    };
  };
  const code: { index: number; addr: bigint; end: bigint }[] = [];
  for (let i = 1; i < shnum; i++) {
    const h = header(i);
    if (h.type === SHT_SYMTAB) throw new Error("the binary already has a symbol table: pass it with --bin instead of a map");
    if (h.flags & SHF_EXECINSTR) code.push({ index: i, addr: h.addr, end: h.addr + h.size });
  }
  const shstr = header(shstrndx);
  if (shstr.type !== SHT_STRTAB || shstr.offset + Number(shstr.size) > elf.length) throw new Error("the binary's section name table is malformed");

  const enc = new TextEncoder();
  const syms = [...names]
    .map(([addr, name]) => ({ addr, name: enc.encode(name).subarray(0, MAX_SYMBOL_NAME), section: code.find((c) => addr >= c.addr && addr < c.end) }))
    .filter((s): s is typeof s & { section: (typeof code)[number] } => s.section !== undefined && s.name.length > 0 && !s.name.includes(0))
    .sort((a, b) => (a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0))
    .slice(0, MAX_SYMBOLS);
  if (!syms.length) throw new Error("none of the map's functions is inside the binary's code: the map is not for this binary");

  // .strtab: a leading NUL, then each name. .symtab: the null symbol, then one per function.
  const strtab = new Uint8Array(1 + syms.reduce((n, s) => n + s.name.length + 1, 0));
  const symtab = new Uint8Array(24 * (syms.length + 1));
  const sv = new DataView(symtab.buffer);
  let at = 1;
  syms.forEach((s, k) => {
    const o = 24 * (k + 1);
    sv.setUint32(o, at, true);
    strtab.set(s.name, at);
    at += s.name.length + 1;
    symtab[o + 4] = GLOBAL_FUNC;
    sv.setUint16(o + 6, s.section.index, true);
    sv.setBigUint64(o + 8, s.addr, true);
    const next = syms[k + 1];
    sv.setBigUint64(o + 16, (next && next.section === s.section ? next.addr : s.section.end) - s.addr, true);
  });
  // The section names, old and new: the old table stays where it is, unused.
  const oldNames = elf.subarray(shstr.offset, shstr.offset + Number(shstr.size));
  const symtabName = oldNames.length;
  const strtabName = symtabName + 8;
  const shstrtab = new Uint8Array(oldNames.length + 16);
  shstrtab.set(oldNames);
  shstrtab.set(enc.encode(".symtab\0.strtab\0"), oldNames.length);

  const align8 = (n: number) => (n + 7) & ~7;
  const symtabOff = align8(elf.length);
  const strtabOff = symtabOff + symtab.length;
  const shstrtabOff = strtabOff + strtab.length;
  const headersOff = align8(shstrtabOff + shstrtab.length);
  const out = new Uint8Array(headersOff + (shnum + 2) * 64);
  out.set(elf);
  out.set(symtab, symtabOff);
  out.set(strtab, strtabOff);
  out.set(shstrtab, shstrtabOff);
  out.set(elf.subarray(shoff, shoff + shnum * 64), headersOff);
  const ov = new DataView(out.buffer);
  const h = (i: number) => headersOff + i * 64;
  ov.setBigUint64(h(shstrndx) + 0x18, BigInt(shstrtabOff), true);
  ov.setBigUint64(h(shstrndx) + 0x20, BigInt(shstrtab.length), true);
  const section = (i: number, name: number, type: number, offset: number, size: number, link: number, info: number, align: number, entsize: number) => {
    ov.setUint32(h(i), name, true);
    ov.setUint32(h(i) + 4, type, true);
    ov.setBigUint64(h(i) + 0x18, BigInt(offset), true);
    ov.setBigUint64(h(i) + 0x20, BigInt(size), true);
    ov.setUint32(h(i) + 0x28, link, true);
    ov.setUint32(h(i) + 0x2c, info, true);
    ov.setBigUint64(h(i) + 0x30, BigInt(align), true);
    ov.setBigUint64(h(i) + 0x38, BigInt(entsize), true);
  };
  // sh_info: the first global symbol (all are global, after the null one).
  section(shnum, symtabName, SHT_SYMTAB, symtabOff, symtab.length, shnum + 1, 1, 8, 24);
  section(shnum + 1, strtabName, SHT_STRTAB, strtabOff, strtab.length, 0, 0, 1, 0);
  ov.setBigUint64(0x28, BigInt(headersOff), true);
  ov.setUint16(0x3c, shnum + 2, true);
  if (sameCode(out, elf) !== true) throw new Error("adding the symbol table would change the code the VM loads: refused");
  return { elf: out, symbols: syms.length };
}

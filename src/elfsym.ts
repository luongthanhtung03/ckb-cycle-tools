/**
 * Gives a stripped CKB binary a symbol table, so ckb-debugger's profiler can
 * see its functions. The profiler opens a frame only where a jump lands on a
 * function the ELF symbol table lists, so a stripped binary profiles as one
 * frame, and naming frames afterwards cannot split it. A linker map of the
 * same build (linkmap.ts) says where each function starts; written into a
 * copy of the binary as `.symtab`, it gives the profiler the frames an
 * unstripped build would. The copy is for reading names from only
 * (`--vm-symbols`): the deployed binary is what runs. It is the input byte for
 * byte, with the table, its strings and a new section header table appended
 * after the end of the file and only the ELF header's e_shoff and e_shnum
 * changed to point at them; that is checked before it is returned. Plain
 * TypeScript with no Node built-ins, like elf.ts.
 */
import { elfCode } from "./elf.js";

/** The largest binary taken: far over what a CKB cell can hold. */
export const MAX_SYMBOLIZED_ELF = 16 << 20;
/** The most functions written, and the longest name in bytes (longer ones are cut at a character boundary). */
export const MAX_SYMBOLS = 200_000;
export const MAX_SYMBOL_NAME = 4096;

const EM_RISCV = 243;
const SHT_SYMTAB = 2;
const SHT_STRTAB = 3;
const SHF_ALLOC = 0x2n;
const SHF_EXECINSTR = 0x4n;
const SHN_LORESERVE = 0xff00;
const PT_LOAD = 1;
const PF_X = 1;
/** STB_GLOBAL, STT_FUNC. */
const GLOBAL_FUNC = 0x12;
/** The ELF header bytes the copy may change: e_shoff (0x28..0x2f), and e_shnum and e_shstrndx (0x3c..0x3f; e_shstrndx is kept). */
const changeable = (i: number) => (i >= 0x28 && i < 0x30) || (i >= 0x3c && i < 0x40);

/** What a map says about the build it came from (linkmap.ts readLinkerMap), checked against the binary. */
export interface MapClaims {
  /** The `.text` output section's address and size. */
  text?: { addr: bigint; size: bigint };
  /** `_start`'s address: the entry point. */
  start?: bigint;
}

const hex = (n: bigint) => `0x${n.toString(16)}`;

/** `name` as UTF-8, cut to at most MAX_SYMBOL_NAME bytes without splitting a character. */
function symbolName(enc: TextEncoder, name: string): Uint8Array {
  const bytes = enc.encode(name);
  if (bytes.length <= MAX_SYMBOL_NAME) return bytes;
  let n = MAX_SYMBOL_NAME;
  while (n > 0 && (bytes[n] & 0xc0) === 0x80) n--; // bytes[n] continues the character before it
  return bytes.subarray(0, n);
}

/**
 * A copy of `elf` (a 64-bit little-endian RISC-V ELF, stripped) with a
 * symbol table listing `names` (start address → name) as functions, for
 * ckb-debugger's `--vm-symbols`. Only the addresses inside code are written
 * (an allocated, executable section inside an executable PT_LOAD segment);
 * each function's size runs to the next one, or to the end of its section.
 * `claims`, what the map says about its build, must agree with the binary:
 * its `.text` address and size with the `.text` section header, its `_start`
 * with the entry point. Throws, with a message for a user, on anything else:
 * not such an ELF, no section headers, a binary that already has a symbol
 * table (no map is needed), a map for another build, no name inside the code,
 * or a copy that is not the input plus appended sections (never expected;
 * checked all the same).
 */
export function addSymbolTable(elf: Uint8Array, names: Map<bigint, string>, claims: MapClaims = {}): { elf: Uint8Array; symbols: number } {
  if (elf.length > MAX_SYMBOLIZED_ELF) throw new Error(`the binary is ${elf.length} bytes, over the ${MAX_SYMBOLIZED_ELF}-byte limit`);
  if (elf.length < 64 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) throw new Error("the binary is not an ELF file");
  if (elf[4] !== 2 || elf[5] !== 1) throw new Error("the binary is not a 64-bit little-endian ELF (a CKB script is RISC-V 64)");
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  if (view.getUint16(0x12, true) !== EM_RISCV) throw new Error(`the binary is not RISC-V (e_machine ${view.getUint16(0x12, true)})`);
  const entry = view.getBigUint64(0x18, true);
  const shoff = Number(view.getBigUint64(0x28, true));
  const shentsize = view.getUint16(0x3a, true);
  const shnum = view.getUint16(0x3c, true);
  const shstrndx = view.getUint16(0x3e, true);
  if (!elfCode(elf)) throw new Error("the binary has no loadable code (or its program headers are malformed)");
  if (!shnum || !shoff) throw new Error("the binary has no section headers to add a symbol table to");
  if (shentsize !== 64 || shoff + shnum * 64 > elf.length) throw new Error("the binary's section header table is malformed");
  if (shstrndx === 0 || shstrndx >= shnum) throw new Error("the binary has no section name table");
  if (shnum + 2 >= SHN_LORESERVE) throw new Error("the binary has too many sections");
  // The executable segments' addresses, as the VM maps them (elfCode checked the table is inside the file).
  const phoff = Number(view.getBigUint64(0x20, true));
  const phentsize = view.getUint16(0x36, true);
  const segments: { addr: bigint; end: bigint }[] = [];
  for (let i = 0; i < view.getUint16(0x38, true); i++) {
    const o = phoff + i * phentsize;
    if (view.getUint32(o, true) !== PT_LOAD || !(view.getUint32(o + 4, true) & PF_X)) continue;
    const addr = view.getBigUint64(o + 0x10, true);
    segments.push({ addr, end: addr + view.getBigUint64(o + 0x20, true) });
  }
  const header = (i: number) => {
    const o = shoff + i * 64;
    return {
      o,
      name: view.getUint32(o, true),
      type: view.getUint32(o + 4, true),
      flags: view.getBigUint64(o + 8, true),
      addr: view.getBigUint64(o + 0x10, true),
      offset: Number(view.getBigUint64(o + 0x18, true)),
      size: view.getBigUint64(o + 0x20, true),
    };
  };
  const shstr = header(shstrndx);
  if (shstr.type !== SHT_STRTAB || shstr.offset + Number(shstr.size) > elf.length) throw new Error("the binary's section name table is malformed");
  const oldNames = elf.subarray(shstr.offset, shstr.offset + Number(shstr.size));
  const sectionName = (at: number) => {
    const end = oldNames.indexOf(0, at);
    return at < oldNames.length && end >= 0 ? new TextDecoder().decode(oldNames.subarray(at, end)) : undefined;
  };
  const code: { index: number; addr: bigint; end: bigint }[] = [];
  let text: { addr: bigint; size: bigint } | undefined;
  for (let i = 1; i < shnum; i++) {
    const h = header(i);
    if (h.type === SHT_SYMTAB) {
      throw new Error("the binary already has a symbol table, so ckb-debugger opens its frames without a map: no map is needed");
    }
    const end = h.addr + h.size;
    // Code: allocated and executable, and inside a segment the VM loads as code; other headers could point anywhere.
    if ((h.flags & (SHF_ALLOC | SHF_EXECINSTR)) === (SHF_ALLOC | SHF_EXECINSTR) && segments.some((s) => h.addr >= s.addr && end <= s.end)) {
      code.push({ index: i, addr: h.addr, end });
    }
    if (!text && sectionName(h.name) === ".text") text = { addr: h.addr, size: h.size };
  }
  // A map of another build: its .text or entry point is somewhere else.
  if (claims.text && text && (claims.text.addr !== text.addr || claims.text.size !== text.size)) {
    throw new Error(
      `the map's .text (${hex(claims.text.addr)}, ${hex(claims.text.size)} bytes) is not the binary's (${hex(text.addr)}, ${hex(text.size)} bytes): the map is for another build`,
    );
  }
  if (claims.start !== undefined && claims.start !== entry) {
    throw new Error(`the map's _start (${hex(claims.start)}) is not the binary's entry point (${hex(entry)}): the map is for another build`);
  }

  const enc = new TextEncoder();
  const syms = [...names]
    .map(([addr, name]) => ({ addr, name: symbolName(enc, name), section: code.find((c) => addr >= c.addr && addr < c.end) }))
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
  // By construction the copy is the input up to its end except e_shoff and e_shnum, so every
  // segment's bytes are the input's. Checked all the same: nothing odd goes to the debugger.
  for (let i = 0; i < elf.length; i++) {
    if (out[i] !== elf[i] && !changeable(i)) throw new Error("the copy with the symbol table differs from the binary outside the ELF header's section fields: refused");
  }
  return { elf: out, symbols: syms.length };
}

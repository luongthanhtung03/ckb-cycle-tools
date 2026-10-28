/**
 * Function names from an ELF symbol table, for the frames ckb-debugger's
 * profiler cannot name. The profiler names a frame from the DWARF line table;
 * code without line info (the `_start` that ckb-std writes in assembly, the
 * allocator shims rustc generates) comes out as `func_0x<address>`. The symbol
 * table of the same unstripped build still has those names. Without them, a
 * function that moved between two builds shows in a diff as one address gone
 * and another new. Plain TypeScript with no Node built-ins, like flame.ts.
 */

/** Start address → name (demangled when it can be), of every function symbol in `.symtab`. */
export function elfFunctionNames(elf: Uint8Array): Map<bigint, string> {
  const names = new Map<bigint, string>();
  // ELF64 little-endian only: what a CKB script is (RISC-V 64).
  if (elf.length < 64 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) return names;
  if (elf[4] !== 2 || elf[5] !== 1) return names;
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  const u32 = (o: number) => view.getUint32(o, true);
  const u64 = (o: number) => view.getBigUint64(o, true);
  const inside = (o: number, n: number) => o >= 0 && n >= 0 && o + n <= elf.length;

  const shoff = Number(u64(0x28));
  const shentsize = u16(0x3a);
  const shnum = u16(0x3c);
  if (shentsize < 64 || !inside(shoff, shentsize * shnum)) return names;
  const section = (i: number) => {
    const o = shoff + i * shentsize;
    return { type: u32(o + 4), offset: Number(u64(o + 0x18)), size: Number(u64(o + 0x20)), link: u32(o + 0x28), entsize: Number(u64(o + 0x38)) };
  };
  const SHT_SYMTAB = 2;
  for (let i = 0; i < shnum; i++) {
    const symtab = section(i);
    if (symtab.type !== SHT_SYMTAB || symtab.entsize < 24 || !inside(symtab.offset, symtab.size)) continue;
    if (symtab.link >= shnum) continue;
    const strtab = section(symtab.link);
    if (!inside(strtab.offset, strtab.size)) continue;
    const decoder = new TextDecoder();
    for (let o = symtab.offset; o + symtab.entsize <= symtab.offset + symtab.size; o += symtab.entsize) {
      const nameOff = u32(o);
      const info = elf[o + 4];
      const shndx = u16(o + 6);
      const value = u64(o + 8);
      const type = info & 0xf;
      // STT_FUNC, or STT_NOTYPE for a global label in assembly (`_start`), defined in a section.
      if (!(type === 2 || (type === 0 && info >> 4 !== 0)) || shndx === 0 || nameOff === 0 || nameOff >= strtab.size) continue;
      let end = strtab.offset + nameOff;
      while (end < strtab.offset + strtab.size && elf[end] !== 0) end++;
      const raw = decoder.decode(elf.subarray(strtab.offset + nameOff, end));
      if (!raw || raw.startsWith("$") || raw.startsWith(".L")) continue;
      // A function and a label at the same address: the function's name wins.
      if (type === 2 || !names.has(value)) names.set(value, demangle(raw));
    }
  }
  return names;
}

/**
 * A Rust symbol name as `crate::module::function`, for the plain paths a
 * symbol table mostly holds: legacy (`_ZN…E`, hash dropped) and v0 (`_R…`).
 * Anything it does not follow (generics, trait impls) comes back unchanged:
 * still a stable name, only a less readable one.
 */
export function demangle(name: string): string {
  if (name.startsWith("_ZN")) return demangleLegacy(name) ?? name;
  if (name.startsWith("_R")) return demangleV0(name) ?? name;
  return name;
}

function demangleLegacy(name: string): string | undefined {
  const parts: string[] = [];
  let i = 3;
  while (i < name.length && name[i] !== "E") {
    const m = /^\d+/.exec(name.slice(i));
    if (!m) return undefined;
    const len = Number(m[0]);
    i += m[0].length;
    if (i + len > name.length) return undefined;
    parts.push(name.slice(i, i + len));
    i += len;
  }
  if (name[i] !== "E" || !parts.length) return undefined;
  if (parts.length > 1 && /^h[0-9a-f]{16}$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join("::").replace(/\$LT\$/g, "<").replace(/\$GT\$/g, ">").replace(/\$u20\$/g, " ").replace(/\.\./g, "::");
}

function demangleV0(name: string): string | undefined {
  let i = 2;
  const peek = () => name[i];
  // `s<base62>_`: a disambiguator, not part of the name.
  const skipDisambiguator = () => {
    if (peek() !== "s") return true;
    const end = name.indexOf("_", i);
    if (end < 0) return false;
    i = end + 1;
    return true;
  };
  const ident = (): string | undefined => {
    if (!skipDisambiguator()) return undefined;
    if (peek() === "u") return undefined; // punycode: leave it to a real demangler
    const m = /^\d+/.exec(name.slice(i));
    if (!m) return undefined;
    const len = Number(m[0]);
    i += m[0].length;
    if (peek() === "_") i++;
    if (i + len > name.length) return undefined;
    const s = name.slice(i, i + len);
    i += len;
    return s;
  };
  const path = (depth: number): string | undefined => {
    if (depth > 64) return undefined;
    const tag = name[i++];
    if (tag === "C") return ident();
    if (tag === "N") {
      const ns = name[i++];
      const parent = path(depth + 1);
      if (parent === undefined) return undefined;
      const id = ident();
      if (id === undefined) return undefined;
      if (ns === "C") return `${parent}::{closure}`;
      if (ns >= "A" && ns <= "Z") return `${parent}::{${id || "shim"}}`;
      return `${parent}::${id}`;
    }
    return undefined;
  };
  if (/^\d/.test(name.slice(i))) return undefined; // an encoding version this does not know
  const p = path(0);
  if (p === undefined) return undefined;
  // What may follow the path: an instantiating crate, or a suffix LLVM added.
  const rest = name.slice(i);
  return rest === "" || rest.startsWith("C") || rest.startsWith(".") ? p : undefined;
}

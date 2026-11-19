/**
 * Function names from a linker map (`-Map=<file>`, GNU ld or LLVM lld /
 * rust-lld), for a build whose binary is stripped. A map lists where the linker
 * put each input section and symbol; for the functions in `.text` that is the
 * same start address a symbol table gives, so a map written for the deployed
 * build can name its frames without an unstripped ELF. Unlike an ELF, a map
 * cannot be checked against the code it describes: it is only as good as the
 * claim that it came from the same link. Plain TypeScript with no Node
 * built-ins, like elf.ts.
 */
import { demangle, LINKER_MARKER } from "./elf.js";

/** Prefixes GCC puts before the function name in a `-ffunction-sections` section name. */
const GCC_SECTION_PREFIX = /^(unlikely|startup|hot|exit)\./;

/** A name a map lists that is not a function: a local label, a mapping symbol, a section bound. */
const notFunction = (name: string) =>
  !name || name.startsWith("$") || name.startsWith(".L") || name.startsWith(".") || LINKER_MARKER.test(name);

/** An output section that holds code: `.text`, or one a linker script named `.text.<something>`. */
const isText = (section: string) => section === ".text" || section.startsWith(".text.");

/** The function a `-ffunction-sections` input section is named after (`.text._ZN…E` → `_ZN…E`), if any. */
function sectionFunction(section: string): string | undefined {
  if (!section.startsWith(".text.")) return undefined;
  const name = section.slice(6).replace(GCC_SECTION_PREFIX, "");
  return notFunction(name) ? undefined : name;
}

/** Address → raw names found there: symbols first (in map order), then section names. */
interface Found {
  symbols: Map<bigint, string[]>;
  sections: Map<bigint, string>;
}

const addSymbol = (f: Found, at: bigint, name: string) => {
  if (notFunction(name)) return;
  const list = f.symbols.get(at) ?? f.symbols.set(at, []).get(at)!;
  if (!list.includes(name)) list.push(name);
};
const addSection = (f: Found, at: bigint, section: string, size: bigint) => {
  const name = sectionFunction(section);
  // An empty section holds no function, though the next one starts at the same address.
  if (name && size > 0n && !f.sections.has(at)) f.sections.set(at, name);
};

/**
 * Start address → name (demangled when it can be, as elf.ts does) of every
 * function the map places in a `.text` output section. Reads both formats:
 *
 * - lld (`VMA LMA Size Align Out In Symbol`, or the older `Address Size Align
 *   Out In Symbol`): output sections, then each input section indented one
 *   step, then its symbols two steps.
 * - GNU ld (after `Linker script and memory map`): an output section at the
 *   start of a line, input sections indented by one space with their address
 *   and size (on the next line when the name is long), and global symbols as
 *   `0x<address>  <name>`.
 *
 * Where a symbol and a `-ffunction-sections` section name (`.text.<name>`)
 * both give a name, the symbol wins; several symbols at one address (aliases)
 * prefer the one the section is named after, then the first listed.
 * Assignments (`PROVIDE (…)`, `x = .`), fill, discarded sections, sections
 * outside `.text` and lines it cannot read are skipped. A map is not checked
 * against any code here: see flameTransaction's `maps`.
 */
export function linkerMapFunctionNames(text: string): Map<bigint, string> {
  const lines = text.split(/\r?\n/);
  const found: Found = { symbols: new Map(), sections: new Map() };
  const header = lines.findIndex((l) => /^\s*(VMA|Address)\s+(LMA\s+)?Size\s+Align\s+Out\s+In\s+Symbol\s*$/.test(l));
  if (header >= 0) readLld(lines.slice(header + 1), /\bLMA\b/.test(lines[header]), found);
  else readGnu(lines, found);
  const names = new Map<bigint, string>();
  for (const [at, list] of found.symbols) {
    const section = found.sections.get(at);
    names.set(at, tidy(list.find((n) => n === section) ?? list[0]));
  }
  for (const [at, name] of found.sections) if (!names.has(at)) names.set(at, tidy(name));
  return names;
}

/**
 * A name as elf.ts gives it: demangled when it can be. lld already prints
 * symbols demangled (`spawn_child::child_work`); a legacy Rust name it
 * demangled keeps its hash (`crowns::replay::h0123456789abcdef`), dropped here
 * as elf.ts drops it, so a function has one name whichever file named it.
 */
function tidy(name: string): string {
  const d = demangle(name);
  return d === name ? d.replace(/::h[0-9a-f]{16}$/, "") : d;
}

function readLld(lines: string[], withLma: boolean, found: Found): void {
  // `%16llx %16llx %8llx %5u ` then the Out / In / Symbol column, each indented 8 more.
  const row = withLma
    ? /^\s*([0-9a-fA-F]+)\s+[0-9a-fA-F]+\s+([0-9a-fA-F]+)\s+\d+ ( *)(\S.*?)\s*$/
    : /^\s*([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+\d+ ( *)(\S.*?)\s*$/;
  let inText = false;
  let section = "";
  for (const line of lines) {
    const m = row.exec(line);
    if (!m) continue;
    const at = BigInt(`0x${m[1]}`);
    const size = BigInt(`0x${m[2]}`);
    const indent = m[3].length;
    const what = m[4];
    if (indent < 4) {
      // An output section, or an assignment at the top level (`. = …`).
      if (!/[=(]/.test(what)) inText = isText(what.split(/\s/)[0]);
      section = "";
    } else if (!inText) {
      continue;
    } else if (indent < 12) {
      // `file.o:(.text._ZN…E)`, `lib.rlib(member.o):(.text)`, `<internal>:(.text)`; or an assignment.
      const s = /:\((\.[^()\s]+)\)$/.exec(what);
      section = s ? s[1] : "";
      if (s) addSection(found, at, section, size);
    } else if (!/^PROVIDE(_HIDDEN)?\s*\(|\s=\s/.test(what)) {
      // A symbol. lld prints it demangled, so it can hold spaces and brackets
      // (`<T as Trait>::f`); an assignment (`PROVIDE(x = .)`, `x = .`) never sits this deep.
      addSymbol(found, at, what);
    }
  }
}

function readGnu(lines: string[], found: Found): void {
  // "Discarded input sections" comes first and lists sections at address 0: start after it.
  const start = lines.findIndex((l) => /^Linker script and memory map\s*$/.test(l));
  let inText = false;
  /** An input section name on a line of its own, waiting for its address and size on the next. */
  let pending: string | undefined;
  for (const line of start >= 0 ? lines.slice(start + 1) : lines) {
    if (!line.trim()) continue;
    // An output section: a name in the first column, with or without its address and size.
    const out = /^(\.[^\s]+|[A-Za-z_][^\s]*)(\s+0x[0-9a-fA-F]+\s+0x[0-9a-fA-F]+.*)?$/.exec(line);
    if (out && !/^\s/.test(line)) {
      inText = isText(out[1]);
      pending = undefined;
      continue;
    }
    if (!inText) continue;
    // An input section with its address and size: ` .text._ZN…E  0x10000  0x2c  file.o`.
    const input = /^ (\.[^\s]+)\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)(\s.*)?$/.exec(line);
    if (input) {
      addSection(found, BigInt(`0x${input[2]}`), input[1], BigInt(`0x${input[3]}`));
      pending = undefined;
      continue;
    }
    // A long input section name, alone: the next line has its address and size.
    const named = /^ (\.[^\s]+)\s*$/.exec(line);
    if (named) {
      pending = named[1];
      continue;
    }
    // The address and size of the pending section (`0x…  0x…  file.o`), or a symbol (`0x…  name`).
    const cont = /^\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)(\s.*)?$/.exec(line);
    if (cont && pending) {
      addSection(found, BigInt(`0x${cont[1]}`), pending, BigInt(`0x${cont[2]}`));
      pending = undefined;
      continue;
    }
    pending = undefined;
    const sym = /^\s+0x([0-9a-fA-F]+)\s+(\S+)\s*$/.exec(line);
    if (sym && !/[=(]/.test(sym[2])) addSymbol(found, BigInt(`0x${sym[1]}`), sym[2]);
  }
}

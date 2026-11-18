/**
 * Flamegraphs of where a script's cycles go, from ckb-debugger's own profiler
 * (`--enable-flamegraph --flamegraph-output`). ckb-debugger writes folded
 * stacks, one `frame;frame;… cycles` line per sample, with the same stack on
 * many lines and every frame as `<source path>:<function>`. Here they are
 * merged, the paths dropped, and drawn as an SVG. Plain TypeScript with no Node
 * built-ins, like replay.ts, so the browser can draw the same thing.
 *
 * A deployed binary is usually stripped: its whole run is one frame. Pass an
 * unstripped build of the same code (`ckb-debugger --bin`) to see functions.
 */

/** Stack (frames joined by `;`, outermost first) → cycles. */
export type Folded = Map<string, bigint>;

/**
 * A frame name with each U+037E (GREEK QUESTION MARK, which looks like `;`)
 * turned back into `;`. Newer ckb-debugger and ckb-vm-pprof write a `;` inside
 * a name that way, so it cannot be read as a frame separator
 * (nervosnetwork/ckb-standalone-debugger#211, #212); older ones write `;`.
 * Reading both as `;` keeps a function's name, and so its costs and diffs, the
 * same whichever debugger profiled it.
 */
export const asciiFrame = (name: string): string => name.replace(/\u037e/g, ";");

/**
 * `E:\…\src\main.rs:session_lock::lock_hash` → `session_lock::lock_hash`. The
 * path ends at the first `.<ext>:`; `??:func_0x114e4` (no symbols) keeps its
 * address. A U+037E in the name is read as `;` (asciiFrame).
 */
export function frameName(frame: string): string {
  const f = asciiFrame(frame.trim());
  if (f.startsWith("??:")) return f.slice(3);
  const m = /^.*?\.[A-Za-z0-9]+:(.+)$/.exec(f);
  return m ? m[1] : f;
}

/**
 * Splits a folded stack into frames. `;` separates frames, but Rust names hold
 * it too (`[u8; 32]`), so a `;` inside brackets belongs to the name.
 */
export function splitStack(stack: string): string[] {
  const frames: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < stack.length; i++) {
    const c = stack[i];
    if (c === "<" || c === "[" || c === "(" || c === "{") depth++;
    else if ((c === ">" || c === "]" || c === ")" || c === "}") && depth > 0) depth--;
    else if (c === ";" && depth === 0) {
      frames.push(stack.slice(start, i));
      start = i + 1;
    }
  }
  frames.push(stack.slice(start));
  return frames;
}

/** The deepest stack kept; deeper frames are folded into one. */
export const MAX_DEPTH = 256;

/** Parses ckb-debugger's folded output: identical stacks merged, frames named by function only. */
export function parseFolded(text: string): Folded {
  const folded: Folded = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.*\S)\s+(\d+)$/.exec(line);
    if (!m) continue;
    // A real CKB script nests nowhere near this deep; a hostile file could, and
    // the tree is walked recursively (review, 27 Oct). Deeper frames fold into the last.
    const frames = splitStack(m[1]).map(frameName);
    if (frames.length > MAX_DEPTH) frames.splice(MAX_DEPTH - 1, frames.length, "…");
    // Rejoined with ";" as the frame separator: a name's own "; " (with a space) stays inside it.
    const stack = frames.join(";");
    folded.set(stack, (folded.get(stack) ?? 0n) + BigInt(m[2]));
  }
  return folded;
}

/**
 * Renames each `func_0x<address>` frame (code the profiler found no line info
 * for) to the function starting at that address in `names` (elf.ts), merging
 * stacks that become the same. Frames it has no name for keep their address.
 */
export function nameAddresses(f: Folded, names: Map<bigint, string>): Folded {
  if (!names.size) return f;
  const out: Folded = new Map();
  for (const [stack, v] of f) {
    const renamed = splitStack(stack)
      .map((frame) => {
        const m = /^func_0x([0-9a-fA-F]+)$/.exec(frame);
        return (m && names.get(BigInt(`0x${m[1]}`))) || frame;
      })
      .join(";");
    out.set(renamed, (out.get(renamed) ?? 0n) + v);
  }
  return out;
}

export const foldedTotal =(f: Folded): bigint => [...f.values()].reduce((s, v) => s + v, 0n);

/** Back to text, one merged stack per line, heaviest first: the format speedscope and inferno read. */
export function formatFolded(f: Folded): string {
  return [...f.entries()]
    .sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] > b[1] ? -1 : 1))
    .map(([s, v]) => `${s} ${v}`)
    .join("\n");
}

export interface FunctionCost {
  name: string;
  /** Cycles spent in the function itself. */
  self: bigint;
  /** Cycles spent in it and everything it called (counted once per stack, so recursion is not doubled). */
  total: bigint;
}

/** Every function with its self and total cycles, heaviest self first. */
export function functionCosts(f: Folded): FunctionCost[] {
  const costs = new Map<string, FunctionCost>();
  const at = (name: string) => costs.get(name) ?? costs.set(name, { name, self: 0n, total: 0n }).get(name)!;
  for (const [stack, v] of f) {
    const frames = splitStack(stack);
    at(frames[frames.length - 1]).self += v;
    for (const name of new Set(frames)) at(name).total += v;
  }
  return [...costs.values()].sort((a, b) => (a.self === b.self ? (a.name < b.name ? -1 : 1) : a.self > b.self ? -1 : 1));
}

export interface FlameNode {
  name: string;
  value: bigint;
  children: FlameNode[];
}

/** The call tree: each node's value is the cycles of every stack through it. Children heaviest first. */
export function flameTree(f: Folded, rootName = "all"): FlameNode {
  const root: FlameNode = { name: rootName, value: 0n, children: [] };
  // Children by name, so a wide profile is not quadratic (review, 27 Oct).
  const index = new Map<FlameNode, Map<string, FlameNode>>();
  for (const [stack, v] of f) {
    root.value += v;
    let node = root;
    for (const name of splitStack(stack)) {
      const byName = index.get(node) ?? index.set(node, new Map()).get(node)!;
      let child = byName.get(name);
      if (!child) {
        child = { name, value: 0n, children: [] };
        node.children.push(child);
        byName.set(name, child);
      }
      child.value += v;
      node = child;
    }
  }
  const sort = (n: FlameNode) => {
    n.children.sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: bigint) => n.toLocaleString("en-US");

/**
 * A self-contained SVG flamegraph: root at the bottom, width proportional to
 * cycles, a tooltip (`<title>`) with the cycles and share on every frame.
 * Frames narrower than `minWidth` pixels are left out. Colours are fixed per
 * function name, so the same function looks the same in two graphs.
 */
export function renderFlameSvg(tree: FlameNode, opts: { title?: string; width?: number; minWidth?: number } = {}): string {
  const width = opts.width ?? 1200;
  const minWidth = opts.minWidth ?? 0.5;
  const row = 18;
  const top = 34;
  const total = tree.value || 1n;
  let depth = 0;
  const rects: string[] = [];
  const draw = (n: FlameNode, x: number, level: number) => {
    const w = (Number(n.value) / Number(total)) * width;
    if (w < minWidth) return;
    depth = Math.max(depth, level);
    rects.push(
      `<g data-level="${level}" data-x="${x.toFixed(2)}"><title>${escape(n.name)} — ${fmt(n.value)} cycles (${((Number(n.value) / Number(total)) * 100).toFixed(1)}%)</title>` +
        `<rect x="${x.toFixed(2)}" y="LEVEL${level}" width="${Math.max(w - 0.5, 0.5).toFixed(2)}" height="${row - 1}" rx="2" fill="${colour(n.name)}"/>` +
        (w > 40 ? `<text x="${(x + 4).toFixed(2)}" y="TEXT${level}">${escape(clip(n.name, Math.floor((w - 8) / 7)))}</text>` : "") +
        `</g>`,
    );
    let cx = x;
    for (const c of n.children) {
      draw(c, cx, level + 1);
      cx += (Number(c.value) / Number(total)) * width;
    }
  };
  draw(tree, 0, 0);
  const height = top + (depth + 1) * row + 8;
  // Root at the bottom: level 0 is the last row.
  const body = rects
    .join("\n")
    .replace(/y="LEVEL(\d+)"/g, (_, l) => `y="${height - 8 - (Number(l) + 1) * row}"`)
    .replace(/y="TEXT(\d+)"/g, (_, l) => `y="${height - 8 - (Number(l) + 1) * row + 12.5}"`);
  const title = escape(opts.title ?? "cycles");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11">`,
    `<rect width="100%" height="100%" fill="#0d1117"/>`,
    `<text x="4" y="20" fill="#c9d1d9" font-size="13">${title} · ${fmt(tree.value)} cycles</text>`,
    `<g fill="#0d1117">`,
    body,
    `</g>`,
    `</svg>`,
  ].join("\n");
}

function clip(s: string, chars: number): string {
  if (chars <= 1) return "";
  return s.length <= chars ? s : s.slice(0, Math.max(chars - 1, 1)) + "…";
}

/** A warm colour from the name, stable across graphs. */
function colour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = 10 + (h % 45); // red to amber
  const light = 45 + ((h >>> 8) % 15);
  return `hsl(${hue} 75% ${light}%)`;
}

/**
 * The `All cycles: N` line ckb-debugger prints in flamegraph mode for the
 * profiled run. The last one: when the script spawns other scripts, the
 * debugger first runs the whole group (printing its full total) to record
 * the syscalls, then profiles the root script alone ("Actual run").
 *
 * Up to ckb-debugger 1.1.1 this equals what the profile's frames cover. From
 * 1.1.2 (nervosnetwork/ckb-standalone-debugger#209) it also counts loading the
 * program, which no frame holds: on the spawn fixture 18,801 against 14,974 in
 * the frames. It is not the group's total in either release (no spawned
 * scripts, and 1.1.2 is still 14 cycles under the plain run on the testtool
 * fixture). For what the frames cover, sum the folded stacks
 * (`foldedTotal`), as `flame` and `report` do; it is the same in both releases.
 */
export function profiledCycles(output: string): bigint | undefined {
  const all = [...output.matchAll(/^All cycles:\s*(\d+)/gm)];
  return all.length ? BigInt(all[all.length - 1][1]) : undefined;
}

/**
 * How many scripts the profiled script spawned (CKB2023 `spawn`), from the
 * `Spawn tree:` lines ckb-debugger prints in flamegraph mode: one per VM,
 * the root first (`Spawn tree: 0 …`, then `Spawn tree: └── 1 …`). 0 when
 * there are none. The debugger profiles only the root VM, so the spawned
 * scripts' cycles are in the group's total but in none of its frames. (A
 * script could print such a line itself; this count only adds a note.)
 */
export function spawnedScripts(output: string): number {
  const ids = new Set<string>();
  for (const m of output.matchAll(/^Spawn tree: [\s─-╿]*(\d+)\s/gm)) ids.add(m[1]);
  ids.delete("0");
  return ids.size;
}

/** One VM of a `Spawn tree:` that ckb-debugger prints in full mode (see spawnTree). */
export interface SpawnedVm {
  /** The VM id, as `--vm-id` takes it. 0 is the group's own script. */
  vm: number;
  /** 0 for the program the VM was spawned with; more after each `exec` (`1/1`). `--vm-id` replays only generation 0. */
  generation: number;
  /** The VM that spawned it (the root's own parent is itself, 0). */
  parent: number;
  /** Where its binary came from, as printed: `cell_dep[1][0..11552]`. */
  locator: string;
  /** The same, parsed: the source, its index, and the byte range of the binary in that cell's data. */
  source?: "input" | "output" | "cell_dep" | "header_dep" | "group_input" | "group_output";
  index?: number;
  start?: number;
  end?: number;
}

/**
 * Every VM in the `Spawn tree:` lines ckb-debugger (full mode) prints for a
 * group whose script spawns others, root first, each with its parent and the
 * locator of the binary it ran:
 *
 *     Spawn tree: 0                    cell_dep[0][0..15992]
 *     Spawn tree: └── 1                cell_dep[1][0..11552]
 *     Spawn tree:     └── 2            cell_dep[2][0..9000]
 *
 * Each level of the tree is four characters of prefix. Empty when the script
 * spawned nothing (no tree is printed). A script could print such lines itself
 * (as a `Script log:` line, which does not start with `Spawn tree:`); only the
 * debugger's own lines are read.
 */
export function spawnTree(output: string): SpawnedVm[] {
  const vms: SpawnedVm[] = [];
  const seen = new Set<string>();
  /** The VM at each depth, as the tree is walked top to bottom. */
  const path: number[] = [];
  for (const m of output.matchAll(/^Spawn tree: ([ │├└─]*)(\d+)(?:\/(\d+))?[ \t]+(\S+)[ \t]*$/gmu)) {
    const depth = [...m[1]].length / 4;
    if (!Number.isInteger(depth) || depth > path.length) continue;
    const vm = Number(m[2]);
    const generation = Number(m[3] ?? 0);
    const key = `${vm}/${generation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    path.length = depth;
    const parent = depth ? path[depth - 1] : vm;
    path.push(vm);
    const loc = /^(input|output|cell_dep|header_dep|group_input|group_output)\[(\d+)\]\[(\d+)\.\.(\d+)\]$/.exec(m[4]);
    vms.push({
      vm,
      generation,
      parent,
      locator: m[4],
      ...(loc && { source: loc[1] as SpawnedVm["source"], index: Number(loc[2]), start: Number(loc[3]), end: Number(loc[4]) }),
    });
  }
  return vms;
}

/** The first ckb-debugger release whose `--vm-id` replay of a spawned script is faithful, with `--vm-symbols` (1.1.2). */
export const CHILD_PROFILE_DEBUGGER = "1.1.2";

/**
 * Whether a ckb-debugger (its `--version` line) can profile a spawned script on
 * its own: 1.1.2 or later. Before it, the replay of `inherited_fds` was wrong
 * (the child of the spawn fixture exits 3) and full mode read only the root's
 * symbols. An unknown version cannot.
 */
export function profilesChildren(version: string): boolean {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  const [x, y, z] = CHILD_PROFILE_DEBUGGER.split(".").map(Number);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
}

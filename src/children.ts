/**
 * Per-child profiles of a script that spawns others (CKB2023 `spawn`): one
 * `--vm-id` flamegraph replay per spawned VM, with ckb-debugger 1.1.2 or
 * later. Plain TypeScript with no Node built-ins, like replay.ts and flame.ts,
 * so the CLI (native debugger, profile.ts) and the web page (WebAssembly
 * build, wasm.ts) split a group the same way and say the same thing about it.
 */
import { elfFunctionNames, sameCode } from "./elf.js";
import { nameAddresses, parseFolded, profilesChildren, spawnedScripts, spawnTree, CHILD_PROFILE_DEBUGGER, type Folded } from "./flame.js";
import type { MockTransaction } from "./mock.js";
import { parseDebuggerRun, type DebuggerOutput } from "./replay.js";
import { spawnedBinary } from "./spawn.js";

/** A spawned script's own profile (`--vm-id`), as `flameTransaction` and `profileSpawns` record it. */
export interface FlameChild {
  /** Its VM id (`--vm-id`), and the VM that spawned it (0: the group's script). */
  vm: number;
  parent: number;
  /** Where its binary came from, as ckb-debugger prints it: `cell_dep[1][0..11552]`. */
  locator: string;
  /** The data hash of the binary it ran, when the locator names a cell of the transaction. */
  codeHash?: string;
  /** A name for it: `scriptNames` by its data hash (or its cell's type hash). */
  name?: string;
  /** The unstripped build its frames were named with (`--vm-symbols`): `bins` or `vmSymbols` by its data or type hash. */
  symbols?: string;
  /** Why no symbols build was used although one was given (it is not the same code). */
  symbolsWarning?: string;
  /**
   * The linker map (`--map`) whose functions named its frames. The binary the
   * VM ran is replayed as it is; the map's functions are written into a copy
   * of it as a symbol table, which the replay only reads for where functions
   * start (`--vm-symbols`). Checked only for the same `.text` and entry point
   * as the binary, not against the code: frames sit where the map says.
   */
  map?: string;
  /** Why a map given for it was not used. */
  mapNote?: string;
  /**
   * Its frames were named from the binary's own `.symtab`: the binary the VM
   * ran has one (only DWARF is stripped), so ckb-debugger already opened a
   * frame at each of its functions, and no build or map was given.
   */
  ownSymbols?: boolean;
  /** The replay's exit code (-1 with `error` when the VM stopped it), and its own cycle count, which counts loading the binary. */
  result: number;
  error?: string;
  cycles: bigint;
  /** Its folded stacks: its own instructions only. */
  folded: Folded;
  /** Set when the replay could not be run or read, or did not finish (killed, cut off, crashed): no result, no complete profile. */
  failed?: string;
}

/** The most spawned scripts profiled one by one per group; each is three runs of the whole group. */
export const MAX_CHILD_PROFILES = 16;

/**
 * Shown when a spawned script's own replay ends non-zero but its group
 * verified: typically a ckb-script-ipc server (`run_server`) that waits for
 * another request after the spawning script has finished, and fails on the
 * closed pipe. Its cycles up to there are the ones the group paid for.
 */
export const SERVER_EXIT_NOTE =
  "the group verified: a spawned script whose own replay ends non-zero is usually a server (ckb-script-ipc run_server) still waiting after the spawning script finished; its profile up to there is complete";

/** Whether a child gets SERVER_EXIT_NOTE: its own replay ended non-zero (or the VM stopped it) while its group verified. */
export const serverExit = (c: Pick<FlameChild, "result" | "error" | "failed">, groupOk: boolean): boolean =>
  groupOk && !c.failed && (c.error !== undefined || c.result !== 0);

/** Why a debugger (its `--version` line) older than CHILD_PROFILE_DEBUGGER profiles no spawned script on its own. */
export const olderDebuggerNote = (version: string): string =>
  `${version} cannot profile a spawned script on its own (ckb-debugger ${CHILD_PROFILE_DEBUGGER} or later can)`;

/** What profileChildren needs to replay a group's spawned VMs. */
export interface ChildContext {
  /** The debugger's `--version` line: below 1.1.2 nothing is replayed. */
  version: string;
  /** The group's arguments (`debuggerArgs`, plus `--bin` if the root ran a build): each replay adds `--vm-id N`. */
  base: string[];
  /** Where the replay of VM `vm` writes its folded stacks (`--flamegraph-output`); `readFile` reads them there. */
  out: (vm: number) => string;
  exec: (args: string[]) => Promise<DebuggerOutput>;
  readFile: (path: string) => Promise<string>;
  /** The mock transaction the group runs in, and the group's cells: to find the binary each VM ran. */
  mock: MockTransaction;
  group: { inputs: number[]; outputs: number[] };
  /** Names by `codeHash:hashType` (lowercase): a child is named by its data hash, or its cell's type hash. */
  names?: Record<string, string>;
  /** An unstripped build for a data or type hash, to name a child's frames (`--vm-symbols`), with how to read it. */
  symbolsOf?: (hash: string) => string | undefined;
  readBinary?: (path: string) => Promise<Uint8Array>;
  namesOf?: (bin: string) => Promise<Map<bigint, string>>;
  /** A linker map for a data or type hash (`--map`); a `symbolsOf` build for the same binary wins. */
  mapOf?: (hash: string) => string | undefined;
  /** Writes a copy of `binary` with the map's functions as its symbol table, for `--vm-symbols` only, and gives its path (profile.ts); throws when it cannot. */
  symbolize?: (map: string, binary: Uint8Array) => Promise<string>;
}

/**
 * One `--vm-id` flamegraph replay per spawned VM of a group (generation 0, at
 * most MAX_CHILD_PROFILES), from the spawn tree in the root's flamegraph run.
 * Nothing is thrown: a replay that fails is a child with `failed`, and a
 * debugger that cannot replay a child at all is a note.
 */
export async function profileChildren(rootOutput: string, ctx: ChildContext): Promise<{ children?: FlameChild[]; childrenNote?: string }> {
  if (!profilesChildren(ctx.version)) return { childrenNote: `${olderDebuggerNote(ctx.version)}: only the spawning script is profiled` };
  const tree = spawnTree(rootOutput);
  const spawned = tree.filter((v) => v.vm !== 0 && v.generation === 0);
  const notes: string[] = [];
  const execd = new Set(tree.filter((v) => v.generation > 0).map((v) => v.vm)).size;
  if (execd) notes.push(`${execd} VM${execd === 1 ? "" : "s"} ran exec: ckb-debugger replays only a VM's first program, so code reached by exec is not profiled`);
  if (spawned.length > MAX_CHILD_PROFILES) notes.push(`${spawned.length} spawned scripts: the first ${MAX_CHILD_PROFILES} are profiled`);
  if (!spawned.length && !notes.length) notes.push("the spawn tree could not be read: spawned scripts not profiled");
  const names = ctx.names ?? {};
  const children: FlameChild[] = [];
  for (const v of spawned.slice(0, MAX_CHILD_PROFILES)) {
    const binary = spawnedBinary(ctx.mock, v, ctx.group);
    const hashes = binary ? [binary.dataHash, ...(binary.typeHash ? [binary.typeHash] : [])] : [];
    const name =
      binary &&
      (["data2", "data1", "data"].map((t) => names[`${binary.dataHash}:${t}`]).find(Boolean) ??
        (binary.typeHash ? names[`${binary.typeHash}:type`] : undefined));
    let symbols = ctx.symbolsOf ? hashes.map(ctx.symbolsOf).find(Boolean) : undefined;
    let symbolsWarning: string | undefined;
    if (symbols && binary) {
      const same = ctx.readBinary
        ? await ctx.readBinary(symbols).then(
            (b) => sameCode(b, binary.data),
            () => undefined,
          )
        : undefined;
      if (same !== true) {
        symbolsWarning =
          same === false
            ? `${symbols} is not the same code as the binary VM ${v.vm} ran: its frames are left unnamed`
            : `${symbols} could not be read as an ELF: VM ${v.vm}'s frames are left unnamed`;
        symbols = undefined;
      }
    }
    // A map, when no build is given: the binary the VM ran, with the map's functions as symbols.
    const mapGiven = ctx.mapOf ? hashes.map(ctx.mapOf).find(Boolean) : undefined;
    let map: string | undefined;
    let mapNote: string | undefined;
    if (mapGiven && (symbols || symbolsWarning)) mapNote = `--map ${mapGiven} ignored: a build is given for VM ${v.vm}'s binary`;
    else if (mapGiven && binary && ctx.symbolize) {
      try {
        symbols = await ctx.symbolize(mapGiven, binary.data);
        map = mapGiven;
      } catch (e) {
        mapNote = `--map ${mapGiven} not used for VM ${v.vm}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const child: FlameChild = {
      vm: v.vm,
      parent: v.parent,
      locator: v.locator,
      ...(binary && { codeHash: binary.dataHash }),
      ...(name && { name }),
      ...(symbols && !map && { symbols }),
      ...(symbolsWarning && { symbolsWarning }),
      ...(map && { map }),
      ...(mapNote && { mapNote }),
      result: -1,
      cycles: 0n,
      folded: new Map(),
    };
    try {
      const out = ctx.out(v.vm);
      const run = await ctx.exec([
        ...ctx.base,
        "--vm-id",
        String(v.vm),
        ...(symbols ? ["--vm-symbols", symbols] : []),
        "--enable-flamegraph",
        "--flamegraph-output",
        out,
      ]);
      // As profileSpawns does for the root run: cut-off output, a kill, or a crash (exit -1 is only
      // ever the WebAssembly build trapping, see wasm.ts: ckb-debugger exits 254 for any non-zero
      // script result, -1 included) leaves no trustworthy result and an incomplete profile. Failed,
      // never a result with an error, so serverExit cannot call its profile complete.
      if (run.failure || run.exitCode === null || run.exitCode === -1) throw new Error(parseDebuggerRun(run).error ?? "the replay did not finish");
      if (!/^Actual run: start\s*$/m.test(run.stdout)) throw new Error(`no replay of VM ${v.vm} in ckb-debugger's output`);
      const parsed = parseDebuggerRun(run);
      child.result = parsed.result;
      if (parsed.error) child.error = parsed.error;
      child.cycles = parsed.cycles;
      // No build or map: a binary that kept its .symtab (DWARF stripped) already had its frames
      // opened at its functions by the profiler, which names frames from DWARF only: name them here.
      const own = !symbols && !symbolsWarning && binary ? elfFunctionNames(binary.data) : undefined;
      if (own?.size) child.ownSymbols = true;
      const fnNames = symbols && ctx.namesOf ? await ctx.namesOf(symbols) : (own ?? new Map<bigint, string>());
      child.folded = nameAddresses(parseFolded(await ctx.readFile(out).catch(() => "")), fnNames);
    } catch (e) {
      child.failed = `the replay of VM ${v.vm} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    children.push(child);
  }
  return { ...(children.length && { children }), ...(notes.length && { childrenNote: notes.join("; ") }) };
}

/** A group split by script: what profileSpawns returns for a group whose script spawned others. */
export interface SpawnSplit {
  /** How many scripts the group's script spawned (`spawnedScripts`). */
  spawned: number;
  /** The spawning script's own profiled frames (VM 0 alone): loading it and the spawned scripts are in none of them. */
  own: Folded;
  /** Each spawned script's own profile (profileChildren), and why some have none. */
  children?: FlameChild[];
  childrenNote?: string;
}

/**
 * Splits one group by script, with any ckb-debugger 1.1.2 or later: a
 * flamegraph run of the group (the spawning script's own frames, and the
 * spawn tree), then, if its script spawned others, one `--vm-id` replay per
 * spawned VM (profileChildren). Undefined when it spawned nothing. The
 * group's cycles are not read here: they come from its plain run
 * (replayGroups), the total these frames sit inside. Throws (so the caller
 * can say the spawn check failed, rather than that nothing was spawned) when
 * the flamegraph run cannot be run or did not finish: no result lines, a
 * crash (the WebAssembly build trapped, exit -1), a kill, cut-off output, or,
 * for a script that spawned, no "Actual run" of its own. Also throws, before
 * running anything, for a debugger older than 1.1.2 (olderDebuggerNote):
 * 0.200.1, for one, has no flamegraph mode at all, so a spawn could not even
 * be seen. A script that rejects is not a failed check: its run still shows
 * what it spawned.
 */
export async function profileSpawns(ctx: ChildContext): Promise<SpawnSplit | undefined> {
  if (!profilesChildren(ctx.version)) throw new Error(olderDebuggerNote(ctx.version));
  const rootOut = ctx.out(0);
  const run = await ctx.exec([...ctx.base, "--enable-flamegraph", "--flamegraph-output", rootOut]);
  const failed = (why: string) => new Error(`the spawn check (a profiled run of the group) failed: ${why}`);
  // parseDebuggerRun turns a crash, a kill or cut-off output into an error (and throws on no result lines).
  let parsed: ReturnType<typeof parseDebuggerRun>;
  try {
    parsed = parseDebuggerRun(run);
  } catch (e) {
    throw failed(e instanceof Error ? e.message : String(e));
  }
  if (run.failure || run.exitCode === null || run.exitCode === -1) throw failed(parsed.error ?? "the run did not finish");
  const spawned = spawnedScripts(run.stdout);
  if (!spawned) return undefined;
  if (!/^Actual run: start\s*$/m.test(run.stdout)) throw failed("no profiled run of the spawning script in ckb-debugger's output");
  const own = parseFolded(await ctx.readFile(rootOut).catch(() => ""));
  const { children, childrenNote } = await profileChildren(run.stdout, ctx);
  return { spawned, own, ...(children && { children }), ...(childrenNote && { childrenNote }) };
}


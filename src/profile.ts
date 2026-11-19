import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkDebuggerPath, resolveDebugger } from "./debugger.js";
import type { MockTransaction, RpcTransaction } from "./mock.js";
import { profileChildren, type FlameChild } from "./children.js";
import { elfFunctionNames } from "./elf.js";
import { addSymbolTable } from "./elfsym.js";
import { linkerMapFunctionNames } from "./linkmap.js";
import { groupBinary } from "./spawn.js";
import { nameAddresses, parseFolded, spawnedScripts, type Folded } from "./flame.js";
import {
  debuggerArgs,
  parseDebuggerRun,
  planReplay,
  replayGroups,
  selectorFor,
  TYPE_ID_CODE_HASH,
  type DebuggerOutput,
  type Profile,
  type ReplayOptions,
  type ReplayPlan,
} from "./replay.js";

// The pure parts live in replay.ts, shared with the browser; existing imports keep working.
export {
  checkTypeId,
  parseDebuggerOutput,
  parseDebuggerRun,
  parseNames,
  readTransactionJson,
  selectorFor,
  TYPE_ID_CODE_HASH,
  TYPE_ID_CYCLES,
} from "./replay.js";
export type { DebuggerOutput, GroupRun, Profile, ProfiledGroup } from "./replay.js";
// Child profiles live in children.ts, shared with the browser.
export { MAX_CHILD_PROFILES } from "./children.js";
export type { FlameChild } from "./children.js";

const run = promisify(execFile);

/** The largest linker map read (`--map`): a real one is a few megabytes at most. */
export const MAX_LINKER_MAP = 64 << 20;

/** The most a run may print. More is a script flooding its logs: the run is an error, not a result. */
export const MAX_DEBUGGER_OUTPUT = 64 << 20;

export interface ProfileOptions extends ReplayOptions {
  debuggerPath?: string;
  /**
   * Runs ckb-debugger instead of the native binary (`--version` included):
   * for tests, or another way to run it. `debuggerPath` is then not used.
   */
  runDebugger?: (args: string[]) => Promise<DebuggerOutput>;
}

/** The debugger to run, and its `--version` line ("unknown" if it cannot say). */
async function debuggerOf(options: ProfileOptions): Promise<{ exec: (args: string[]) => Promise<DebuggerOutput>; version: string }> {
  let exec = options.runDebugger;
  if (!exec) {
    const debuggerPath = options.debuggerPath ? checkDebuggerPath(options.debuggerPath) : resolveDebugger();
    exec = (args) => runNativeDebugger(debuggerPath, args);
  }
  const version = await exec(["--version"]).then(
    (r) => (r.exitCode === 0 && r.stdout.trim()) || "unknown",
    () => "unknown",
  );
  return { exec, version };
}

/**
 * Runs the native ckb-debugger once and keeps what a parser needs to trust the
 * output: the exit code, and whether the output was complete. A debugger that
 * cannot be started at all is an error (thrown), not a script result.
 */
export async function runNativeDebugger(debuggerPath: string, args: string[], maxBuffer = MAX_DEBUGGER_OUTPUT): Promise<DebuggerOutput> {
  try {
    const r = await run(debuggerPath, args, { maxBuffer });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { code?: unknown; signal?: string | null; stdout?: string; stderr?: string; message?: string };
    // Killed at the buffer limit: what is left is the beginning of the output, and
    // the real result lines (at the end) are gone. Never parse it.
    if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { stdout: "", stderr: "", exitCode: null, failure: `output exceeded ${MAX_DEBUGGER_OUTPUT >> 20} MB (script logs?): not trusted` };
    }
    // ENOENT, EACCES, EINVAL…: it never ran.
    if (typeof e.code === "string") throw new Error(`cannot run ckb-debugger at ${debuggerPath}: ${e.code}`);
    if (typeof e.code === "number") return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: null, ...(e.signal && { failure: `ckb-debugger was killed (${e.signal})` }) };
  }
}

/**
 * Profiles a transaction per script group: a committed one by hash (and checks
 * the node's total), or any transaction in RPC shape — e.g. one about to be sent,
 * or one the node rejected — to see which script refuses it, with what exit code,
 * and what it cost to get there. A ready ckb-debugger mock transaction (every
 * cell already in it) needs no node at all.
 */
export async function profileTransaction(
  target: string | RpcTransaction | MockTransaction,
  options: ProfileOptions = {},
): Promise<Profile> {
  const { exec, version: debuggerVersion } = await debuggerOf(options);
  const plan = await planReplay(target, options);

  const dir = await mkdtemp(join(tmpdir(), "ckb-cycles-"));
  try {
    const txFile = join(dir, "tx.json");
    await writeFile(txFile, JSON.stringify(plan.mock));
    // ckb-debugger exits non-zero when a script rejects; its output still says why.
    return await replayGroups(plan, exec, { txFile, debugger: debuggerVersion });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface FlameGroup {
  selector: string;
  name?: string;
  codeHash: string;
  role: string;
  /** Exit code and cycles of the profiled run, as in a profile. */
  result: number;
  error?: string;
  cycles: bigint;
  /** Merged folded stacks, frames named by function. */
  folded: Folded;
  /** The binary used instead of the one in the transaction (`--bin`), if any. */
  bin?: string;
  /**
   * With `bin` or `map`: the cycles of the same group run with the transaction's own
   * binary. Different cycles mean the build is not the deployed code, and the
   * flamegraph describes the build.
   */
  deployedCycles?: bigint;
  /**
   * The linker map (`--map`) whose functions were written into a copy of the
   * deployed binary as a symbol table; that copy ran instead of it (same
   * loaded bytes), and `deployedCycles` checks it. Its names are where the map
   * says the functions are: a map cannot be checked against the code.
   */
  map?: string;
  /** Why a map given for this script was not used (`--bin` given too, the binary not found, the map refused). */
  mapNote?: string;
  /** With `bin` or `map`: the exit code of that run (with the deployed binary), and whether the VM stopped it. */
  deployedResult?: number;
  deployedError?: string;
  /**
   * How many scripts this group's script spawned (CKB2023 `spawn`). ckb-debugger
   * profiles only the root script: the spawned ones' cycles are in `cycles`
   * but in no frame of `folded`, and `--bin` replaces only the root's binary.
   */
  spawned?: number;
  /**
   * With `spawned`: each spawned script's own profile, from one `--vm-id`
   * replay per spawned VM (ckb-debugger 1.1.2 and later). The group's
   * `cycles` stay the source of truth; these are profiled frames, and they
   * leave out what the spawn itself costs the parent.
   */
  children?: FlameChild[];
  /** With `spawned`: why some or all spawned scripts have no profile of their own (an older debugger, an `exec`, too many). */
  childrenNote?: string;
}

/**
 * Profiles each script group with ckb-debugger's flamegraph mode. `bins` maps a
 * code hash to an unstripped build of that script, used instead of the
 * deployed (stripped) binary so the frames have names; each such group is also
 * run with the deployed binary, to check the build behaves the same.
 * `scripts` limits the run to those selectors (`input.0.lock`, …). `readFile`
 * reads the folded stacks the debugger wrote, and `readBinary` (node:fs when
 * not given) the builds, for their symbol tables: both see the files where
 * `runDebugger` does.
 */
export async function flameTransaction(
  target: string | RpcTransaction | MockTransaction,
  options: ProfileOptions & {
    bins?: Record<string, string>;
    scripts?: string[];
    readFile: (path: string) => Promise<string>;
    readBinary?: (path: string) => Promise<Uint8Array>;
    /**
     * Unstripped builds of spawned scripts, by data hash (or the type hash of
     * the cell they are in), to name a child's frames (`--vm-symbols`). `bins`
     * is looked up too. Each must have the same code as the binary the child
     * ran (elf.ts `sameCode`), or it is not used.
     */
    vmSymbols?: Record<string, string>;
    /** Profile each spawned script on its own (default true; needs ckb-debugger 1.1.2). */
    children?: boolean;
    /**
     * Linker maps (`-Map` of GNU ld or lld) of the deployed builds, by the same
     * hashes as `bins` (a group's code hash) and `vmSymbols` (a spawned
     * binary's data or type hash). The map's functions are written into a copy
     * of the deployed binary as a symbol table (elfsym.ts), which runs as
     * `--bin` or `--vm-symbols`: the frames an unstripped build would give,
     * without one. A `bins` or `vmSymbols` entry for the same hash wins.
     */
    maps?: Record<string, string>;
    /** Reads a map (node:fs, as UTF-8, when not given). */
    readMap?: (path: string) => Promise<string>;
  },
): Promise<{ plan: ReplayPlan; groups: FlameGroup[]; debugger: string }> {
  const { exec, version: debuggerVersion } = await debuggerOf(options);
  const plan = await planReplay(target, options);
  const bins = Object.fromEntries(Object.entries(options.bins ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const vmSymbols = Object.fromEntries(Object.entries(options.vmSymbols ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const scriptNames = Object.fromEntries(Object.entries(options.scriptNames ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const maps = Object.fromEntries(Object.entries(options.maps ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const dir = await mkdtemp(join(tmpdir(), "ckb-flame-"));
  try {
    const txFile = join(dir, "tx.json");
    await writeFile(txFile, JSON.stringify(plan.mock));
    const groups: FlameGroup[] = [];
    // Frames the profiler could not name from line info get their names from the build's symbol table,
    // read and parsed once per build however many groups run it.
    const readBinary = options.readBinary ?? ((path: string) => readFile(path).then((b) => new Uint8Array(b)));
    const symbols = new Map<string, Promise<Map<bigint, string>>>();
    const namesOf = (bin: string) => {
      if (!symbols.has(bin)) symbols.set(bin, readBinary(bin).then(elfFunctionNames, () => new Map<bigint, string>()));
      return symbols.get(bin)!;
    };
    // Each map read and parsed once; one that cannot be read or used is a note on the script it was for.
    const readMap = options.readMap ?? ((path: string) => readFile(path, "utf8"));
    const mapNames = new Map<string, Promise<Map<bigint, string>>>();
    const namesInMap = (map: string) => {
      if (!mapNames.has(map)) {
        mapNames.set(
          map,
          readMap(map).then(
            (text) => {
              if (text.length > MAX_LINKER_MAP) throw new Error(`it is over ${MAX_LINKER_MAP >> 20} MB: not a linker map?`);
              return linkerMapFunctionNames(text);
            },
            (e: Error) => {
              throw new Error(`cannot read it: ${e.message}`);
            },
          ),
        );
      }
      return mapNames.get(map)!;
    };
    // A copy of a deployed binary with the map's functions as its symbol table, in the run's directory.
    let written = 0;
    const symbolize = async (map: string, binary: Uint8Array): Promise<string> => {
      const names = await namesInMap(map);
      if (!names.size) throw new Error("it lists no function in .text: not a GNU ld or lld map?");
      const { elf } = addSymbolTable(binary, names);
      const file = join(dir, `map-${written++}.elf`);
      await writeFile(file, elf);
      symbols.set(file, Promise.resolve(elfFunctionNames(elf)));
      return file;
    };
    for (const g of plan.groups) {
      const selector = selectorFor(g);
      if (options.scripts && !options.scripts.includes(selector)) continue;
      if (g.role === "type" && g.codeHash === TYPE_ID_CODE_HASH) continue; // built into the node: nothing to profile
      const base = debuggerArgs(txFile, selector, plan.scriptVersion);
      const bin = bins[g.codeHash.toLowerCase()];
      const mapGiven = maps[g.codeHash.toLowerCase()];
      // What runs as --bin: the build given, or the deployed binary with the map's symbols.
      let runBin = bin;
      let map: string | undefined;
      let mapNote: string | undefined;
      if (mapGiven && bin) mapNote = `--map ${mapGiven} ignored: --bin ${bin} is given for the same script`;
      else if (mapGiven) {
        const binary = groupBinary(plan.mock, g);
        if (!binary) mapNote = `--map ${mapGiven} not used: the script's binary is not in the transaction's cell deps`;
        else {
          try {
            runBin = await symbolize(mapGiven, binary.data);
            map = mapGiven;
          } catch (e) {
                mapNote = `--map ${mapGiven} not used: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }
      const out = join(dir, `${selector}.folded`);
      const runOut = await exec([
        ...base,
        ...(runBin ? ["--bin", runBin] : []),
        "--enable-flamegraph",
        "--flamegraph-output",
        out,
      ]);
      const spawned = spawnedScripts(runOut.stdout);
      const names = runBin ? await namesOf(runBin) : new Map<bigint, string>();
      const folded = nameAddresses(parseFolded(await options.readFile(out).catch(() => "")), names);
      // A flamegraph run's own total is not the group's: up to ckb-debugger 1.1.1 it
      // leaves out loading the binary, 1.1.2 counts loading but is still a few
      // cycles short (14 on the testtool fixture), and every release leaves out
      // spawned scripts. So result and cycles come from plain runs: with the
      // build, and with the deployed binary to compare.
      const parsed = runOut.exitCode === null ? parseDebuggerRun(runOut) : parseDebuggerRun(await exec([...base, ...(runBin ? ["--bin", runBin] : [])]));
      const deployed = runBin ? parseDebuggerRun(await exec(base)) : undefined;
      let children: FlameChild[] | undefined;
      let childrenNote: string | undefined;
      if (spawned && options.children !== false) {
        ({ children, childrenNote } = await profileChildren(runOut.stdout, {
          version: debuggerVersion,
          base: [...base, ...(runBin ? ["--bin", runBin] : [])],
          out: (vm) => join(dir, `${selector}.vm${vm}.folded`),
          exec,
          mock: plan.mock,
          group: g,
          symbolsOf: (hash) => vmSymbols[hash] ?? bins[hash],
          names: scriptNames,
          readFile: options.readFile,
          readBinary,
          namesOf,
          mapOf: (hash) => maps[hash],
          symbolize,
        }));
      }
      groups.push({
        selector,
        ...(g.name && { name: g.name }),
        codeHash: g.codeHash,
        role: g.role,
        result: parsed.result,
        ...(parsed.error && { error: parsed.error }),
        cycles: parsed.cycles,
        folded,
        ...(spawned && { spawned }),
        ...(children?.length && { children }),
        ...(childrenNote && { childrenNote }),
        ...(map && { map }),
        ...(mapNote && { mapNote }),
        ...(runBin &&
          deployed && {
            ...(bin && { bin }),
            deployedCycles: deployed.cycles,
            deployedResult: deployed.result,
            ...(deployed.error && { deployedError: deployed.error }),
          }),
      });
    }
    return { plan, groups, debugger: debuggerVersion };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

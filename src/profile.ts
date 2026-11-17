import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkDebuggerPath, resolveDebugger } from "./debugger.js";
import type { MockTransaction, RpcTransaction } from "./mock.js";
import { elfFunctionNames, sameCode } from "./elf.js";
import { nameAddresses, parseFolded, profilesChildren, spawnedScripts, spawnTree, CHILD_PROFILE_DEBUGGER, type Folded } from "./flame.js";
import { spawnedBinary } from "./spawn.js";
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

const run = promisify(execFile);

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
   * With `bin`: the cycles of the same group run with the transaction's own
   * binary. Different cycles mean the build is not the deployed code, and the
   * flamegraph describes the build.
   */
  deployedCycles?: bigint;
  /** With `bin`: the exit code of that run (with the deployed binary), and whether the VM stopped it. */
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

/** A spawned script's own profile (`--vm-id`), as `flameTransaction` records it. */
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
  /** The replay's exit code (-1 with `error` when the VM stopped it), and its own cycle count, which counts loading the binary. */
  result: number;
  error?: string;
  cycles: bigint;
  /** Its folded stacks: its own instructions only. */
  folded: Folded;
  /** Set when the replay could not be run or read: no result, no profile. */
  failed?: string;
}

/** The most spawned scripts profiled one by one per group; each is three runs of the whole group. */
export const MAX_CHILD_PROFILES = 16;

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
  },
): Promise<{ plan: ReplayPlan; groups: FlameGroup[]; debugger: string }> {
  const { exec, version: debuggerVersion } = await debuggerOf(options);
  const plan = await planReplay(target, options);
  const bins = Object.fromEntries(Object.entries(options.bins ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const vmSymbols = Object.fromEntries(Object.entries(options.vmSymbols ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const scriptNames = Object.fromEntries(Object.entries(options.scriptNames ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
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
    for (const g of plan.groups) {
      const selector = selectorFor(g);
      if (options.scripts && !options.scripts.includes(selector)) continue;
      if (g.role === "type" && g.codeHash === TYPE_ID_CODE_HASH) continue; // built into the node: nothing to profile
      const base = debuggerArgs(txFile, selector, plan.scriptVersion);
      const bin = bins[g.codeHash.toLowerCase()];
      const out = join(dir, `${selector}.folded`);
      const runOut = await exec([
        ...base,
        ...(bin ? ["--bin", bin] : []),
        "--enable-flamegraph",
        "--flamegraph-output",
        out,
      ]);
      const spawned = spawnedScripts(runOut.stdout);
      const names = bin ? await namesOf(bin) : new Map<bigint, string>();
      const folded = nameAddresses(parseFolded(await options.readFile(out).catch(() => "")), names);
      // A flamegraph run's own total is not the group's: up to ckb-debugger 1.1.1 it
      // leaves out loading the binary, 1.1.2 counts loading but is still a few
      // cycles short (14 on the testtool fixture), and every release leaves out
      // spawned scripts. So result and cycles come from plain runs: with the
      // build, and with the deployed binary to compare.
      const parsed = runOut.exitCode === null ? parseDebuggerRun(runOut) : parseDebuggerRun(await exec([...base, ...(bin ? ["--bin", bin] : [])]));
      const deployed = bin ? parseDebuggerRun(await exec(base)) : undefined;
      let children: FlameChild[] | undefined;
      let childrenNote: string | undefined;
      if (spawned && options.children !== false) {
        ({ children, childrenNote } = await profileChildren(runOut.stdout, {
          version: debuggerVersion,
          base: [...base, ...(bin ? ["--bin", bin] : [])],
          out: (vm) => join(dir, `${selector}.vm${vm}.folded`),
          exec,
          mock: plan.mock,
          group: g,
          symbolsOf: (hash) => vmSymbols[hash] ?? bins[hash],
          names: scriptNames,
          readFile: options.readFile,
          readBinary,
          namesOf,
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
        ...(bin &&
          deployed && {
            bin,
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

/**
 * One `--vm-id` flamegraph replay per spawned VM of a group (generation 0, at
 * most MAX_CHILD_PROFILES), from the spawn tree in the root's flamegraph run.
 * Nothing is thrown: a replay that fails is a child with `failed`, and a
 * debugger that cannot replay a child at all is a note.
 */
async function profileChildren(
  rootOutput: string,
  ctx: {
    version: string;
    base: string[];
    out: (vm: number) => string;
    exec: (args: string[]) => Promise<DebuggerOutput>;
    mock: MockTransaction;
    group: { inputs: number[]; outputs: number[] };
    symbolsOf: (hash: string) => string | undefined;
    names: Record<string, string>;
    readFile: (path: string) => Promise<string>;
    readBinary: (path: string) => Promise<Uint8Array>;
    namesOf: (bin: string) => Promise<Map<bigint, string>>;
  },
): Promise<{ children?: FlameChild[]; childrenNote?: string }> {
  if (!profilesChildren(ctx.version)) {
    return {
      childrenNote:
        `${ctx.version} cannot profile a spawned script on its own (ckb-debugger ${CHILD_PROFILE_DEBUGGER} or later can): ` +
        "only the spawning script is profiled",
    };
  }
  const tree = spawnTree(rootOutput);
  const spawned = tree.filter((v) => v.vm !== 0 && v.generation === 0);
  const notes: string[] = [];
  const execd = new Set(tree.filter((v) => v.generation > 0).map((v) => v.vm)).size;
  if (execd) notes.push(`${execd} VM${execd === 1 ? "" : "s"} ran exec: ckb-debugger replays only a VM's first program, so code reached by exec is not profiled`);
  if (spawned.length > MAX_CHILD_PROFILES) notes.push(`${spawned.length} spawned scripts: the first ${MAX_CHILD_PROFILES} are profiled`);
  if (!spawned.length && !notes.length) notes.push("the spawn tree could not be read: spawned scripts not profiled");
  const children: FlameChild[] = [];
  for (const v of spawned.slice(0, MAX_CHILD_PROFILES)) {
    const binary = spawnedBinary(ctx.mock, v, ctx.group);
    const hashes = binary ? [binary.dataHash, ...(binary.typeHash ? [binary.typeHash] : [])] : [];
    const name =
      binary &&
      (["data2", "data1", "data"].map((t) => ctx.names[`${binary.dataHash}:${t}`]).find(Boolean) ??
        (binary.typeHash ? ctx.names[`${binary.typeHash}:type`] : undefined));
    let symbols = hashes.map(ctx.symbolsOf).find(Boolean);
    let symbolsWarning: string | undefined;
    if (symbols && binary) {
      const same = await ctx.readBinary(symbols).then(
        (b) => sameCode(b, binary.data),
        () => undefined,
      );
      if (same !== true) {
        symbolsWarning =
          same === false
            ? `${symbols} is not the same code as the binary VM ${v.vm} ran: its frames are left unnamed`
            : `${symbols} could not be read as an ELF: VM ${v.vm}'s frames are left unnamed`;
        symbols = undefined;
      }
    }
    const child: FlameChild = {
      vm: v.vm,
      parent: v.parent,
      locator: v.locator,
      ...(binary && { codeHash: binary.dataHash }),
      ...(name && { name }),
      ...(symbols && { symbols }),
      ...(symbolsWarning && { symbolsWarning }),
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
      if (!/^Actual run: start\s*$/m.test(run.stdout)) throw new Error(`no replay of VM ${v.vm} in ckb-debugger's output`);
      const parsed = parseDebuggerRun(run);
      child.result = parsed.result;
      if (parsed.error) child.error = parsed.error;
      child.cycles = parsed.cycles;
      const names = symbols ? await ctx.namesOf(symbols) : new Map<bigint, string>();
      child.folded = nameAddresses(parseFolded(await ctx.readFile(out).catch(() => "")), names);
    } catch (e) {
      child.failed = `the replay of VM ${v.vm} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    children.push(child);
  }
  return { ...(children.length && { children }), ...(notes.length && { childrenNote: notes.join("; ") }) };
}

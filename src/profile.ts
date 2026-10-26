import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkDebuggerPath, resolveDebugger } from "./debugger.js";
import type { MockTransaction, RpcTransaction } from "./mock.js";
import { parseFolded, type Folded } from "./flame.js";
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
}

/**
 * Profiles each script group with ckb-debugger's flamegraph mode. `bins` maps a
 * code hash to an unstripped build of that script, used instead of the
 * deployed (stripped) binary so the frames have names; each such group is also
 * run with the deployed binary, to check the build behaves the same.
 * `scripts` limits the run to those selectors (`input.0.lock`, …).
 */
export async function flameTransaction(
  target: string | RpcTransaction | MockTransaction,
  options: ProfileOptions & { bins?: Record<string, string>; scripts?: string[]; readFile: (path: string) => Promise<string> },
): Promise<{ plan: ReplayPlan; groups: FlameGroup[]; debugger: string }> {
  const { exec, version: debuggerVersion } = await debuggerOf(options);
  const plan = await planReplay(target, options);
  const bins = Object.fromEntries(Object.entries(options.bins ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const dir = await mkdtemp(join(tmpdir(), "ckb-flame-"));
  try {
    const txFile = join(dir, "tx.json");
    await writeFile(txFile, JSON.stringify(plan.mock));
    const groups: FlameGroup[] = [];
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
      const folded = parseFolded(await options.readFile(out).catch(() => ""));
      // Flamegraph mode leaves out loading the binary, so result and cycles come
      // from plain runs: with the build, and with the deployed binary to compare.
      const parsed = runOut.exitCode === null ? parseDebuggerRun(runOut) : parseDebuggerRun(await exec([...base, ...(bin ? ["--bin", bin] : [])]));
      const deployed = bin ? parseDebuggerRun(await exec(base)) : undefined;
      groups.push({
        selector,
        ...(g.name && { name: g.name }),
        codeHash: g.codeHash,
        role: g.role,
        result: parsed.result,
        ...(parsed.error && { error: parsed.error }),
        cycles: parsed.cycles,
        folded,
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

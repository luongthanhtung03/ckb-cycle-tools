import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkDebuggerPath, resolveDebugger } from "./debugger.js";
import type { MockTransaction, RpcTransaction } from "./mock.js";
import { planReplay, replayGroups, type DebuggerOutput, type Profile, type ReplayOptions } from "./replay.js";

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
  const debuggerPath = options.debuggerPath ? checkDebuggerPath(options.debuggerPath) : resolveDebugger();
  const plan = await planReplay(target, options);
  const debuggerVersion = await run(debuggerPath, ["--version"]).then(
    (r) => r.stdout.trim(),
    () => "unknown",
  );

  const dir = await mkdtemp(join(tmpdir(), "ckb-cycles-"));
  try {
    const txFile = join(dir, "tx.json");
    await writeFile(txFile, JSON.stringify(plan.mock));
    // ckb-debugger exits non-zero when a script rejects; its output still says why.
    return await replayGroups(plan, (args) => runNativeDebugger(debuggerPath, args), { txFile, debugger: debuggerVersion });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

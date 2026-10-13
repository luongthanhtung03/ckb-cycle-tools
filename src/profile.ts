import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveDebugger } from "./debugger.js";
import type { RpcTransaction } from "./mock.js";
import { planReplay, replayGroups, type Profile, type ReplayOptions } from "./replay.js";

// The pure parts live in replay.ts, shared with the browser; existing imports keep working.
export {
  checkTypeId,
  parseDebuggerOutput,
  parseNames,
  readTransactionJson,
  selectorFor,
  TYPE_ID_CODE_HASH,
  TYPE_ID_CYCLES,
} from "./replay.js";
export type { GroupRun, Profile, ProfiledGroup } from "./replay.js";

const run = promisify(execFile);

export interface ProfileOptions extends ReplayOptions {
  debuggerPath?: string;
}

/**
 * Profiles a transaction per script group: a committed one by hash (and checks
 * the node's total), or any transaction in RPC shape — e.g. one about to be sent,
 * or one the node rejected — to see which script refuses it, with what exit code,
 * and what it cost to get there.
 */
export async function profileTransaction(
  target: string | RpcTransaction,
  options: ProfileOptions = {},
): Promise<Profile> {
  const debuggerPath = options.debuggerPath ?? resolveDebugger();
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
    const native = (args: string[]) =>
      run(debuggerPath, args, { maxBuffer: 64 << 20 }).then(
        (r) => r.stdout + r.stderr,
        // No output at all means it did not start: say why.
        (e: { stdout?: string; stderr?: string; message?: string }) =>
          (e.stdout ?? "") + (e.stderr ?? "") || String(e.message),
      );
    return await replayGroups(plan, native, { txFile, debugger: debuggerVersion });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

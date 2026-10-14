import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Finds the native `ckb-debugger` executable.
 *
 * On Windows, offckb installs the real binary into its own data directory and
 * puts only a `ckb-debugger.cmd` shim on PATH. A shell-less `child_process`
 * spawn cannot resolve a bare name to a `.cmd` file, so tools that spawn
 * `ckb-debugger` directly fail there. This resolver returns a path to the real
 * `.exe` instead, so callers can spawn it without a shell.
 *
 * Order: `CKB_DEBUGGER_PATH`, then PATH (executables only, never `.cmd`), then
 * offckb's tools directory on Windows.
 */
export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

export class DebuggerNotFoundError extends Error {
  constructor(public readonly searched: string[]) {
    super(
      `ckb-debugger not found. Set CKB_DEBUGGER_PATH (or pass --debugger), or install it with ` +
        `\`offckb debugger\` or from the ckb-standalone-debugger releases. ` +
        `Searched:\n  ${searched.join("\n  ")}`,
    );
    this.name = "DebuggerNotFoundError";
  }
}

/**
 * Checks a path given explicitly (`CKB_DEBUGGER_PATH`, `--debugger`): it must
 * exist, and must not be a `.cmd`/`.bat` shim, which Node cannot spawn without
 * a shell (it fails with a bare `spawn EINVAL`).
 */
export function checkDebuggerPath(path: string, exists: (path: string) => boolean = existsSync): string {
  if (/\.(cmd|bat)$/i.test(path)) {
    throw new Error(
      `${path} is a Windows shim, which cannot be run without a shell. Point to the real ckb-debugger.exe ` +
        `instead: offckb installs it in %LOCALAPPDATA%\\offckb-nodejs\\Data\\tools\\ckb-debugger.exe`,
    );
  }
  // An explicit path that does not exist is a configuration error, not
  // something to silently fall past.
  if (!exists(path)) throw new DebuggerNotFoundError([path]);
  return path;
}

export function resolveDebugger(options: ResolveOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const isWindows = platform === "win32";
  const binary = isWindows ? "ckb-debugger.exe" : "ckb-debugger";
  const searched: string[] = [];

  const explicit = env.CKB_DEBUGGER_PATH;
  if (explicit) return checkDebuggerPath(explicit, exists);

  const pathVar = env.PATH ?? env.Path ?? "";
  // On Windows, path.delimiter is ";" — but resolve with the target platform's
  // delimiter so the function can be tested for either platform anywhere.
  const sep = isWindows ? ";" : platform === process.platform ? delimiter : ":";
  for (const dir of pathVar.split(sep).filter(Boolean)) {
    const candidate = join(dir, binary);
    searched.push(candidate);
    if (exists(candidate)) return candidate;
  }

  if (isWindows && env.LOCALAPPDATA) {
    const offckb = join(env.LOCALAPPDATA, "offckb-nodejs", "Data", "tools", binary);
    searched.push(offckb);
    if (exists(offckb)) return offckb;
  }

  throw new DebuggerNotFoundError(searched);
}

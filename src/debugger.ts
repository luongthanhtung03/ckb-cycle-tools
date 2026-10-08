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
      `ckb-debugger not found. Set CKB_DEBUGGER_PATH, or install it with ` +
        `\`offckb debugger\` or from the ckb-standalone-debugger releases. ` +
        `Searched:\n  ${searched.join("\n  ")}`,
    );
    this.name = "DebuggerNotFoundError";
  }
}

export function resolveDebugger(options: ResolveOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const isWindows = platform === "win32";
  const binary = isWindows ? "ckb-debugger.exe" : "ckb-debugger";
  const searched: string[] = [];

  const explicit = env.CKB_DEBUGGER_PATH;
  if (explicit) {
    searched.push(explicit);
    if (exists(explicit)) return explicit;
    // An explicit path that does not exist is a configuration error, not
    // something to silently fall past.
    throw new DebuggerNotFoundError(searched);
  }

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

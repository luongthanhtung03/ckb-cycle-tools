/**
 * ckb-debugger compiled to WebAssembly (WASI), run in memory: no Node
 * built-ins, so the same code runs in a browser (or a Web Worker) and in Node.
 *
 * The WASI build ships in the `ckb-testtool` npm package
 * (`src/wasm/ckb-debugger.wasm`); compile it once with `WebAssembly.compile`
 * and pass the module in. Files the debugger reads live in an in-memory
 * directory at `/`, and stdout/stderr are collected as text.
 */
import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from "@bjorn3/browser_wasi_shim";
import { checkMockTransaction, type DebuggerOutput, type RunDebugger } from "./replay.js";

export interface WasmRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * Files the run created in `/` (e.g. `--flamegraph-output /vm0.folded`), by
   * name. The files passed in are not repeated here.
   */
  files: Record<string, Uint8Array>;
}

/**
 * Runs the debugger once. `files` are placed in `/`, so `--tx-file /tx.json`
 * reads `files["tx.json"]`. A fresh instance each time: no state leaks between runs.
 */
export async function runWasmDebugger(
  module: WebAssembly.Module,
  args: string[],
  files: Record<string, Uint8Array> = {},
): Promise<WasmRun> {
  const decoders = [new TextDecoder(), new TextDecoder()];
  const text = ["", ""];
  const capture = (i: 0 | 1) => new ConsoleStdout((bytes) => (text[i] += decoders[i].decode(bytes, { stream: true })));
  // The run may add files (and directories) to it: what it wrote is read back from here.
  const root = new Map<string, unknown>(Object.entries(files).map(([name, data]) => [name, new File(data, { readonly: true })]));
  const fds = [new OpenFile(new File([])), capture(0), capture(1), new PreopenDirectory("/", root as Map<string, File>)];
  // `debug: false` explicitly: the shim logs every call when it is left undefined.
  const wasi = new WASI(["ckb-debugger", ...args], [], fds, { debug: false });
  const instance = (await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport })) as unknown as {
    exports: { memory: WebAssembly.Memory; _start: () => unknown };
  };
  let exitCode: number;
  try {
    exitCode = wasi.start(instance);
  } catch (e) {
    // A trap inside the debugger (e.g. out of memory): report it like a crashed
    // process. Exit code -1 tells parseDebuggerRun not to trust the stdout so far.
    text[1] += `\n${e instanceof Error ? e.message : String(e)}`;
    exitCode = -1;
  }
  const created: Record<string, Uint8Array> = {};
  for (const [name, entry] of root) if (!Object.hasOwn(files, name) && entry instanceof File) created[name] = entry.data;
  return { exitCode, stdout: text[0] + decoders[0].decode(), stderr: text[1] + decoders[1].decode(), files: created };
}

/** "ckb-debugger 0.200.1", as `--version` prints it. */
export async function wasmDebuggerVersion(module: WebAssembly.Module): Promise<string> {
  return (await runWasmDebugger(module, ["--version"])).stdout.trim() || "unknown";
}

/** The text the debugger printed, stdout then stderr. */
export const wasmOutput = (r: WasmRun) => r.stdout + r.stderr;

/** Where wasmRunner puts the mock transaction. */
export const WASM_TX_FILE = "/tx.json";

/**
 * A runner for replayGroups, with the mock transaction (its JSON, encoded) at
 * WASM_TX_FILE: `replayGroups(plan, wasmRunner(module, tx), { txFile: WASM_TX_FILE, … })`.
 */
export function wasmRunner(module: WebAssembly.Module, tx: Uint8Array): RunDebugger {
  // The bytes the debugger reads, checked as they are: no `{{ … }}` directive
  // anywhere in them, and a mock checkMockTransaction accepts.
  const text = new TextDecoder().decode(tx);
  if (text.includes("{{")) throw new Error(`mock transaction refused: contains "{{", a ckb-debugger template directive`);
  checkMockTransaction(JSON.parse(text));
  // The whole run, exit code included: replayGroups checks the result lines against it.
  return (args) => runWasmDebugger(module, args, { "tx.json": tx });
}

/** A run that may carry the files it wrote: a WasmRun, or one passed on from a Web Worker. */
export type RunWithFiles = (args: string[]) => Promise<DebuggerOutput & { files?: Record<string, Uint8Array> }>;

/**
 * `exec`, `readFile` and `out` for profileSpawns (children.ts) over the
 * WebAssembly debugger, whose files live only in each run's memory: `exec`
 * keeps what the last run wrote (and only that, so a run that writes nothing
 * never reads an earlier one's file), `readFile` reads it back by the path
 * the debugger was given, and `out` names those paths (`/vm1.folded`).
 */
export function wasmFiles(run: RunWithFiles): {
  exec: (args: string[]) => Promise<DebuggerOutput>;
  readFile: (path: string) => Promise<string>;
  out: (vm: number) => string;
} {
  let written = new Map<string, Uint8Array>();
  return {
    exec: async (args) => {
      written = new Map();
      const r = await run(args);
      written = new Map(Object.entries(r.files ?? {}).map(([name, data]) => [`/${name}`, data]));
      return r;
    },
    readFile: async (path) => {
      const data = written.get(path);
      if (!data) throw new Error(`${path}: not written by the last run`);
      return new TextDecoder().decode(data);
    },
    out: (vm) => `/vm${vm}.folded`,
  };
}

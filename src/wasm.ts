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
import type { RunDebugger } from "./replay.js";

export interface WasmRun {
  exitCode: number;
  stdout: string;
  stderr: string;
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
  const root = new Map(Object.entries(files).map(([name, data]) => [name, new File(data, { readonly: true })]));
  const fds = [new OpenFile(new File([])), capture(0), capture(1), new PreopenDirectory("/", root)];
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
  return { exitCode, stdout: text[0] + decoders[0].decode(), stderr: text[1] + decoders[1].decode() };
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
  // The whole run, exit code included: replayGroups checks the result lines against it.
  return (args) => runWasmDebugger(module, args, { "tx.json": tx });
}

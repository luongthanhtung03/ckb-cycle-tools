/**
 * The page's side of debugger.worker.ts: one worker for the page, started the
 * first time someone asks for per-group cycles, never before. A worker that
 * fails or runs past RUN_TIMEOUT_MS is thrown away, and the next run starts a
 * fresh one.
 */
import type { DebuggerOutput, RunDebugger } from "ckb-cycle-tools/replay";

export type WorkerIn = { type: "load"; url: string } | { type: "run"; id: number; args: string[]; tx: Uint8Array };
export type WorkerOut =
  | { type: "progress"; loaded: number; total?: number }
  | { type: "ready"; version: string; txFile: string }
  | { type: "output"; id: number; run: DebuggerOutput }
  | { type: "error"; id?: number; message: string };

/** Served from public/ (copied there by scripts/copy-wasm.mjs). */
export const WASM_URL = "/ckb-debugger.wasm";

/**
 * One group's run, at most. A script that loops to the 3.5e9-cycle limit takes
 * far longer in WebAssembly than natively; past this, the page gives up on it.
 */
export const RUN_TIMEOUT_MS = 180_000;

export interface Debugger {
  version: string;
  /** Where the debugger reads the transaction: replayGroups' txFile. */
  txFile: string;
  /** A replayGroups runner with `tx` (the mock transaction's JSON, encoded) at txFile. */
  runner(tx: Uint8Array): RunDebugger;
}

let worker: Worker | undefined;
let loading: Promise<Debugger> | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (run: DebuggerOutput) => void; reject: (e: Error) => void }>();

/** Ends the worker and fails whatever it was running; the next load starts a new one. */
function discard(err: Error) {
  worker?.terminate();
  worker = undefined;
  loading = undefined;
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

export function loadDebugger(onProgress: (loaded: number, total?: number) => void): Promise<Debugger> {
  if (loading) return loading;
  worker ??= new Worker(new URL("./debugger.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  loading = new Promise<Debugger>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "progress") onProgress(m.loaded, m.total);
      else if (m.type === "ready") resolve({ version: m.version, txFile: m.txFile, runner });
      else if (m.type === "output") settle(m.id)?.resolve(m.run);
      else if (m.id !== undefined) settle(m.id)?.reject(new Error(m.message));
      else reject(new Error(m.message));
    };
    w.onerror = (e) => {
      const err = new Error(e.message || "the ckb-debugger worker failed");
      // A worker that failed (e.g. out of memory) is not reused: later runs would wait forever.
      discard(err);
      reject(err);
    };
    w.postMessage({ type: "load", url: WASM_URL } satisfies WorkerIn);
  });
  // A failed load can be retried by pressing the button again.
  loading.catch(() => (loading = undefined));
  return loading;
}

function settle(id: number) {
  const p = pending.get(id);
  pending.delete(id);
  return p;
}

function runner(tx: Uint8Array): RunDebugger {
  return (args) =>
    new Promise<DebuggerOutput>((resolve, reject) => {
      if (!worker) return reject(new Error("the ckb-debugger worker stopped; run again"));
      const id = ++nextId;
      // A run cannot be interrupted inside the worker: on timeout the worker goes.
      const timer = setTimeout(
        () => discard(new Error(`a script group ran for more than ${RUN_TIMEOUT_MS / 1000} s; stopped`)),
        RUN_TIMEOUT_MS,
      );
      const done = <T>(f: (v: T) => void) => (v: T) => (clearTimeout(timer), f(v));
      pending.set(id, { resolve: done(resolve), reject: done(reject) });
      worker.postMessage({ type: "run", id, args, tx } satisfies WorkerIn);
    });
}

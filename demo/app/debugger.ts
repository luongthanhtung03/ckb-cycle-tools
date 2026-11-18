/**
 * The page's side of debugger.worker.ts: one worker for the page, started the
 * first time someone asks for per-group cycles, never before. A worker that
 * fails or runs past RUN_TIMEOUT_MS is thrown away, and the next run starts a
 * fresh one. The worker runs one thing at a time; a run's time counts from
 * when the worker starts it, not from when it was queued.
 */
import type { RunWithFiles, WasmRun } from "ckb-cycle-tools/wasm";

export type WorkerIn = { type: "load"; url: string } | { type: "run"; id: number; args: string[]; tx: Uint8Array };
export type WorkerOut =
  | { type: "progress"; loaded: number; total?: number }
  | { type: "ready"; version: string; txFile: string }
  | { type: "started"; id: number }
  | { type: "output"; id: number; run: WasmRun }
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
  /**
   * A replayGroups runner with `tx` (the mock transaction's JSON, encoded) at
   * txFile. Each run also returns the files it wrote (a flamegraph run's folded
   * stacks), for profileSpawns through wasmFiles. Once `signal` is aborted, no
   * further run is sent to the worker (each call rejects with an AbortError).
   */
  runner(tx: Uint8Array, signal?: AbortSignal): RunWithFiles;
}

let worker: Worker | undefined;
let loading: Promise<Debugger> | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (run: WasmRun) => void; reject: (e: Error) => void; started: () => void }>();

/**
 * The worker is gone (it failed, or a run timed out): every run after this one
 * fails too until the button is pressed again, which loads a new worker.
 */
export class WorkerStopped extends Error {
  override name = "WorkerStopped";
}

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
      else if (m.type === "started") pending.get(m.id)?.started();
      else if (m.type === "output") settle(m.id)?.resolve(m.run);
      else if (m.id !== undefined) settle(m.id)?.reject(new Error(m.message));
      else reject(new Error(m.message));
    };
    w.onerror = (e) => {
      const err = new WorkerStopped(e.message || "the ckb-debugger worker failed");
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

function runner(tx: Uint8Array, signal?: AbortSignal): RunWithFiles {
  return (args) =>
    new Promise<WasmRun>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("the replay was cancelled", "AbortError"));
      if (!worker) return reject(new WorkerStopped("the ckb-debugger worker stopped; run again"));
      const id = ++nextId;
      // A run cannot be interrupted inside the worker: on timeout the worker goes.
      // The clock starts when the worker starts the run, so time spent queued
      // behind another run (e.g. one left from a page that moved on) is not counted.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = () => {
        timer ??= setTimeout(
          () => discard(new WorkerStopped(`a ckb-debugger run took more than ${RUN_TIMEOUT_MS / 1000} s; stopped`)),
          RUN_TIMEOUT_MS,
        );
      };
      const done = <T>(f: (v: T) => void) => (v: T) => (clearTimeout(timer), f(v));
      pending.set(id, { resolve: done(resolve), reject: done(reject), started });
      worker.postMessage({ type: "run", id, args, tx } satisfies WorkerIn);
    });
}

/**
 * ckb-debugger (WebAssembly) in a Web Worker, so a long script does not freeze
 * the page. It downloads and compiles the module on the first "load", then
 * runs one group per "run" message with the mock transaction in memory.
 */
import { runWasmDebugger, WASM_TX_FILE, wasmDebuggerVersion, wasmOutput } from "ckb-cycle-tools/wasm";
import type { WorkerIn, WorkerOut } from "./debugger";

const post = (m: WorkerOut) => (self as unknown as { postMessage(m: WorkerOut): void }).postMessage(m);

let module: Promise<{ module: WebAssembly.Module; version: string }> | undefined;

async function load(url: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  // Content-Length is the compressed size when the server compresses: progress uses it only as a hint.
  const total = Number(res.headers.get("content-length")) || undefined;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: "progress", loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const m = await WebAssembly.compile(bytes);
  return { module: m, version: await wasmDebuggerVersion(m) };
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      module ??= load(msg.url);
      // A failed download may be retried with the next "load".
      module.catch(() => (module = undefined));
      const { version } = await module;
      post({ type: "ready", version, txFile: WASM_TX_FILE });
    } else {
      if (!module) throw new Error("ckb-debugger is not loaded");
      const r = await runWasmDebugger((await module).module, msg.args, { [WASM_TX_FILE.slice(1)]: msg.tx });
      post({ type: "output", id: msg.id, output: wasmOutput(r) });
    }
  } catch (err) {
    post({ type: "error", ...(msg.type === "run" && { id: msg.id }), message: err instanceof Error ? err.message : String(err) });
  }
};

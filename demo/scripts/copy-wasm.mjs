/**
 * Puts ckb-debugger's WebAssembly build (from ckb-testtool, a dev dependency of
 * the library) into public/, where the page fetches it only when someone asks
 * for per-group cycles. Runs before `next dev` and `next build`; the copy is
 * not committed (*.wasm is ignored).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const from = new URL("../../node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm", import.meta.url);
const to = new URL("../public/ckb-debugger.wasm", import.meta.url);
if (!existsSync(from)) {
  console.error(`missing ${from.pathname}: run npm ci at the repository root`);
  process.exit(1);
}
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(from, to);
console.log("public/ckb-debugger.wasm copied from ckb-testtool");

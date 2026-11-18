/**
 * Puts ckb-debugger's WebAssembly build into public/, where the page fetches it
 * only when someone asks for per-group cycles. Runs before `next dev` and
 * `next build`; the copy is not committed (*.wasm is ignored).
 *
 * The build is the wasm32-wasip1 asset of the official ckb-standalone-debugger
 * release named below (1.1.2: the first whose `--vm-id` replay profiles a
 * spawned script faithfully). The tarball is checked against the sha256 in
 * compat/debuggers.json, the manifest the cross-version check uses, and the
 * wasm in it against WASM_SHA256. A copy already in the cache (the same place
 * `npm run compat -- fetch` keeps it) is used only if its sha256 matches.
 * Anything else stops the build.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const VERSION = "1.1.2";
/** sha256 of ckb-debugger.wasm inside ckb-debugger_v1.1.2_wasm32-wasip1.tar.gz. */
const WASM_SHA256 = "14c59a70b8a80226faabdde2b5b679e9331e785746427c319ecb9137ea7d0cfb";

const repo = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("compat/debuggers.json", repo), "utf8"));
const release = manifest.releases.find((r) => r.version === VERSION);
if (!release?.wasm) fail(`compat/debuggers.json has no wasm build for ${VERSION}`);
if (!/^nervosnetwork\/ckb-standalone-debugger$/.test(manifest.repository)) fail(`unexpected repository ${manifest.repository}`);
const url = `https://github.com/${manifest.repository}/releases/download/${release.tag}/${release.wasm.asset}`;

const cacheDir = new URL(`.cache/ckb-debugger/${VERSION}/wasm/`, repo);
const cached = new URL("ckb-debugger.wasm", cacheDir);
const to = new URL("../public/ckb-debugger.wasm", import.meta.url);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function fail(msg) {
  console.error(`copy-wasm: ${msg}`);
  process.exit(1);
}

/** The regular files of a .tar.gz, by name (the release tarballs need nothing more). */
function untarGz(bytes) {
  const tar = gunzipSync(bytes);
  const files = new Map();
  let off = 0;
  let longName;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a, n) => header.subarray(a, a + n).toString("latin1").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = undefined;
    const body = tar.subarray(off + 512, off + 512 + size);
    if (type === "L") longName = body.toString("latin1").replace(/\0.*$/s, "");
    else if (type === "0" || type === "7") files.set(name, body);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fetchWasm() {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  const tarball = new Uint8Array(await res.arrayBuffer());
  const got = sha256(tarball);
  if (got !== release.wasm.sha256) fail(`${url}: sha256 ${got}, expected ${release.wasm.sha256}`);
  const entry = [...untarGz(tarball)].find(([name]) => name.split("/").at(-1) === "ckb-debugger.wasm");
  if (!entry) fail(`${url}: no ckb-debugger.wasm in the tarball`);
  return entry[1];
}

let wasm = existsSync(cached) ? readFileSync(cached) : undefined;
let from = "cache";
if (!wasm || sha256(wasm) !== WASM_SHA256) {
  wasm = await fetchWasm();
  from = url;
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, wasm);
}
const got = sha256(wasm);
if (got !== WASM_SHA256) fail(`ckb-debugger.wasm ${VERSION}: sha256 ${got}, expected ${WASM_SHA256}`);
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(cached, to);
console.log(`public/ckb-debugger.wasm: ckb-debugger ${VERSION} (wasm32-wasip1), sha256 ${got.slice(0, 12)}… ok, from ${from}`);

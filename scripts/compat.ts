/**
 * Cross-version check: the same frozen scenarios replayed group by group under
 * several ckb-debugger releases (native, and their WebAssembly builds) and the
 * WebAssembly build the web page uses (from ckb-testtool), compared with the
 * reference release the CLI and CI pin. A difference in cycles or result for
 * any group at the same CKB-VM version is a mismatch, and the run exits 1.
 *
 *   npm run compat -- fetch     download every release in compat/debuggers.json
 *                               for this platform (sha256 checked) into .cache/
 *   npm run compat -- record    rebuild compat/scenarios.json.br: the testtool
 *                               fixture mocks, the session-lock benchmark mocks,
 *                               the recorded testnet transactions, and mainnet
 *                               transactions from the atlas (read-only RPC)
 *   npm run compat [-- run]     replay every scenario under every build and
 *                               write compat/RESULTS.md and compat/results.json
 *
 * Options: --cache <dir> (default .cache/ckb-debugger), --only <v,v> (versions),
 * --no-wasm, --no-sweep (skip the VM 0/1/2 sweep), --out <file.md>; for record,
 * --rpc <url> (default the public mainnet node).
 *
 * Inputs are frozen in compat/scenarios.json.br so every build reads the same
 * bytes, and `run` needs no network at all.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync } from "node:zlib";
import type { MockTransaction } from "../src/mock.js";
import { runNativeDebugger } from "../src/profile.js";
import { groupsOf, planReplay, replayGroups, selectorFor, type ReplayPlan, type RunDebugger } from "../src/replay.js";
import { substituteBinaries } from "../src/substitute.js";
import { WASM_TX_FILE, wasmDebuggerVersion, wasmRunner } from "../src/wasm.js";
import {
  assetUrl,
  checkSha256,
  compareAll,
  packScenarios,
  renderCompat,
  slug,
  txFileName,
  unpackScenarios,
  type Manifest,
  type Run,
  type Scenario,
  type ScenarioFile,
} from "./compat-lib.js";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cache: { type: "string", default: ".cache/ckb-debugger" },
    only: { type: "string" },
    "no-wasm": { type: "boolean", default: false },
    "no-sweep": { type: "boolean", default: false },
    out: { type: "string", default: "compat/RESULTS.md" },
    rpc: { type: "string" },
  },
});
const command = positionals[0] ?? "run";

const MANIFEST = "compat/debuggers.json";
const SCENARIOS = "compat/scenarios.json.br";
const TESTTOOL_WASM = "node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm";
const manifest: Manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const platform = process.platform as "linux" | "win32" | "darwin";
const exe = platform === "win32" ? "ckb-debugger.exe" : "ckb-debugger";
const only = flags.only?.split(",").map((v) => v.replace(/^v/, ""));
const releases = manifest.releases.filter((r) => !only || only.includes(r.version) || r.version === manifest.reference);

/** The files of a .tar.gz (regular files only), by name. Enough for the release tarballs; no external `tar`. */
function untarGz(bytes: Uint8Array): Map<string, Uint8Array> {
  const tar = gunzipSync(bytes);
  const files = new Map<string, Uint8Array>();
  let off = 0;
  let longName: string | undefined;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a: number, n: number) => header.subarray(a, a + n).toString("latin1").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = undefined;
    const body = tar.subarray(off + 512, off + 512 + size);
    if (type === "L") longName = body.toString("latin1").replace(/\0.*$/s, "");
    else if (type === "0" || type === "7") files.set(name, new Uint8Array(body));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Downloads one asset, checks it against the manifest's sha256, and keeps the file named `want`. */
async function fetchAsset(version: string, kind: string, url: string, sha256: string, want: string): Promise<void> {
  const dir = join(flags.cache!, version, kind);
  const target = join(dir, want);
  if (existsSync(target)) return console.log(`have   ${version} ${kind}`);
  const bytes = await download(url);
  checkSha256(bytes, sha256, `${version} ${kind} (${url})`);
  const files = untarGz(bytes);
  const entry = [...files].find(([name]) => basename(name) === want);
  if (!entry) throw new Error(`${url}: no ${want} in the tarball (has ${[...files.keys()].join(", ")})`);
  await mkdir(dir, { recursive: true });
  await writeFile(target, entry[1]);
  if (platform !== "win32") await chmod(target, 0o755);
  console.log(`fetched ${version} ${kind}: sha256 ok, ${basename(url)}`);
}

async function fetchAll(): Promise<void> {
  for (const r of releases) {
    const native = r.native[platform];
    if (native) await fetchAsset(r.version, "native", assetUrl(manifest, r, native), native.sha256, exe);
    else console.log(`skip   ${r.version} native: no ${platform} build published`);
    if (r.wasm && !flags["no-wasm"]) await fetchAsset(r.version, "wasm", assetUrl(manifest, r, r.wasm), r.wasm.sha256, "ckb-debugger.wasm");
  }
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * Releases before 0.200 name a group with --cell-type/--cell-index/--script-group-type
 * instead of --script: `--script input.0.lock` becomes `--cell-type input --cell-index 0 --script-group-type lock`.
 */
function legacyArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = args[i] === "--script" ? /^(input|output)\.(\d+)\.(lock|type)$/.exec(args[i + 1] ?? "") : null;
    if (m) {
      out.push("--cell-type", m[1], "--cell-index", m[2], "--script-group-type", m[3]);
      i++;
    } else out.push(args[i]);
  }
  return out;
}

const nativePath = (version: string) => join(flags.cache!, version, "native", exe);

// ---------------------------------------------------------------- record

/**
 * Mainnet transactions from atlas/2026-10-28: the first matched transaction of
 * each targeted sample (one per script), two scripts of the main sample the
 * targeted runs did not cover, and two older transactions (blocks 18.6M and 18.8M) that
 * mainnet.ckb.dev reports 0x0 cycles for; recorded with `--rpc https://mainnet.ckbapp.dev/`, which has them.
 */
const MAINNET: { hash: string; title: string }[] = [
  { hash: "0xf6465c3062ca02a981457af8ac6f125938d6cfdbb61dbdb566a3ac15ae3f18d9", title: "xUDT" },
  { hash: "0x8051703472c27b918c3d423ea1d275717f7b0921957b1a9db00bb4f83cdb50ca", title: "Omnilock" },
  { hash: "0xe17b6766c514d58542eac2b2d1bdd7f3b18f8b5b330e86748a0d69c49fd1d530", title: "Omnilock, args 0x01" },
  { hash: "0x633a7f01ab2eace548d0a1742e351fdc56f34684658789a140331786c74162ea", title: "Omnilock, args 0x04" },
  { hash: "0x5451be2be217f39ffdcb39b6160844af889bf5031a93e13d39c2472514e7c205", title: "Spore + ckb-dex lock" },
  { hash: "0xbb76eed228f61e394d35e9d0b8db6313e8cb8ff8ff93ccc3a74f0fc99ca20b88", title: "Spore Cluster" },
  { hash: "0x36ad4eb856e744648e3f1faf82095fef1140d26dbb85a87141e81a2b1a01847e", title: "Type ID" },
  { hash: "0x693fb41e205b943365a34e5b101b9ef45783f0dc797d66ba0be740ee63f46703", title: "JoyID" },
  { hash: "0xe73997efc628ba6b602a78d3bf01a7eab4b96929833f2cd228ba049942a24691", title: "RGB++ lock" },
  { hash: "0x2acb3a61cd22aceba448ba47b20e3a6759a1e1af2b5d61d6d0a7a77e7b717155", title: "BTC time lock (RGB++)" },
  { hash: "0x69f1d05ca190a813597127badfd3eeb48254436c650c0a25b36eaa45051175ea", title: "iCKB logic" },
  { hash: "0x0b713b67fff4fe35ef7e4cfc46129fd42f0ad3c7e1f0fbf02bb9c78ed3ab812b", title: "iCKB limit order" },
  { hash: "0x33410eb3915d46fea183cf0267fca90e1ee566c27358531f4c4e9d3acc0e028c", title: "iCKB owned owner" },
  { hash: "0x4609e72ab5db47e21a53d6381715d32dcb44a1279844aaeda6d168edd80833ad", title: "sUDT" },
  { hash: "0x71f2e6385148a413fb8a59e71eefb5dd19f6ed10c1271b9615a5b60b548b2e4f", title: "anyone-can-pay" },
  { hash: "0x80c158627bbc9215fed9c87a16be55bbabc2d08c358df025ff7b77be972b313d", title: "COTA" },
  { hash: "0x5a060093499c9e0f409bd81fa4b4fe0569961b11719784f41cb3a5d59ed0bd7a", title: "d.id das-lock" },
  { hash: "0xf7d0c0c37cd3e963657aaba5bde2f162b960d16f04e175c4562e33815f8e7454", title: "Nervos DAO" },
  { hash: "0x3e550def34726ecbf7d4522d2cb7b5f5ba9b08b42ab41962552ba192817de025", title: "Bitcoin SPV client (RGB++)" },
  { hash: "0xb57da046cb5b3122b99224e62652040ac74b0b8d63c94372afc8bdefe3cb6c18", title: "d.id time oracle" },
  { hash: "0xd08befa554eb0975fb4aeeaaafeb8ac93844e89181db197fd41b832bccf23ae4", title: "Omnilock, args 0x06 (older block)" },
  { hash: "0xa1a96c2f2f540b824fb767de0b059a6226327e13545370cea89b1683dba4143c", title: "UniqueType (older block)" },
];

async function record(): Promise<void> {
  const scenarios: Scenario[] = [];
  const names = (plan: ReplayPlan) => Object.fromEntries(plan.groups.filter((g) => g.name).map((g) => [selectorFor(g), g.name!]));

  // 1. The ckb-testtool fixture project's mocks (what `ckb-cycles scan` reads).
  const ttDir = "test/fixtures/testtool-project/mocks";
  for (const f of readdirSync(ttDir).filter((f) => f.endsWith(".json")).sort()) {
    const mock: MockTransaction = JSON.parse(await readFile(join(ttDir, f), "utf8"));
    scenarios.push({ id: `testtool/${f.replace(/^tests\.|\.json$/g, "")}`, source: "testtool", title: f, scriptVersion: 2, names: {}, mock });
  }

  // 2. The session-lock benchmark mocks, with the binaries cycles.json supplies (ckb-js-vm and the bytecode).
  const cfg = JSON.parse(await readFile("cycles.json", "utf8")) as {
    names: Record<string, string>;
    binaries: Record<string, { path: string; codeHash: string }>;
    scenarios: { name: string; mock: string }[];
  };
  const subs = await Promise.all(
    Object.entries(cfg.binaries).map(async ([name, b]) => {
      if (!existsSync(b.path)) throw new Error(`${b.path} is missing: run \`npm run bench:build\` first`);
      return { name, codeHash: b.codeHash, data: new Uint8Array(await readFile(b.path)) };
    }),
  );
  for (const sc of cfg.scenarios) {
    const raw: MockTransaction = JSON.parse(await readFile(sc.mock, "utf8"));
    const { mock } = substituteBinaries(raw, subs, { skipUnmatched: true });
    const plan = { groups: groupsOf(mock) };
    const n: Record<string, string> = {};
    for (const g of plan.groups) {
      const name = cfg.names[`${g.codeHash}:${g.hashType}`];
      if (name) n[selectorFor(g)] = name;
    }
    scenarios.push({ id: `benchmark/${basename(sc.mock, ".json")}`, source: "benchmark", title: sc.name, scriptVersion: 2, names: n, mock });
  }

  // 3. The testnet transactions test/wasm.test.ts replays (one on VM 1).
  const testnet = JSON.parse(brotliDecompressSync(await readFile("test/fixtures/replay-testnet.json.br")).toString("utf8")) as {
    hash: string;
    nodeCycles: string;
    scriptVersion: 0 | 1 | 2;
    mock: MockTransaction;
  }[];
  for (const t of testnet) {
    scenarios.push({
      id: `testnet/${t.hash.slice(0, 10)}`,
      source: "testnet",
      title: `testnet ${t.hash}`,
      hash: t.hash,
      nodeCycles: t.nodeCycles,
      scriptVersion: t.scriptVersion,
      names: {},
      mock: t.mock,
    });
  }

  // 4. Mainnet, fetched read-only from the public node.
  // Each fetched transaction is kept in the cache, so a run cut short by the node resumes.
  const fetched = join(flags.cache!, "mainnet-mocks");
  await mkdir(fetched, { recursive: true });
  for (const { hash, title } of MAINNET) {
    const cached = join(fetched, `${hash}.json`);
    type Saved = { scriptVersion: 0 | 1 | 2; nodeCycles?: string; names: Record<string, string>; mock: MockTransaction };
    let plan: Saved;
    if (existsSync(cached)) plan = JSON.parse(await readFile(cached, "utf8"));
    else {
      const p = await withRetry(() => planReplay(hash, { network: "mainnet", timeoutMs: 60_000, ...(flags.rpc && { rpcUrl: flags.rpc }) }), hash);
      plan = {
        scriptVersion: p.scriptVersion,
        ...(p.nodeCycles !== undefined && p.nodeCycles !== 0n && { nodeCycles: String(p.nodeCycles) }),
        names: names(p),
        mock: p.mock,
      };
      await writeFile(cached, JSON.stringify(plan));
    }
    scenarios.push({
      id: `mainnet/${slug(title)}`,
      source: "mainnet",
      title: `${title}: ${hash}`,
      hash,
      ...(plan.nodeCycles !== undefined && { nodeCycles: plan.nodeCycles }),
      scriptVersion: plan.scriptVersion,
      names: plan.names,
      mock: plan.mock,
    });
    console.log(`recorded ${hash} (${title}): VM ${plan.scriptVersion}, node ${plan.nodeCycles ?? "-"}`);
  }

  const file = packScenarios(scenarios, { recordedAt: new Date().toISOString(), recordedWith: "scripts/compat.ts record" });
  const json = Buffer.from(JSON.stringify(file));
  const br = brotliCompressSync(json, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: json.length },
  });
  await writeFile(SCENARIOS, br);
  console.log(`wrote ${SCENARIOS}: ${scenarios.length} scenarios, ${Object.keys(file.blobs).length} shared cells, ${br.length} bytes`);
}

/** Public nodes time out now and then: three tries, a pause between them. */
async function withRetry<T>(f: () => Promise<T>, what: string): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i === 3) throw e;
      console.log(`retry ${what}: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 10_000 * i));
    }
  }
}

// ---------------------------------------------------------------- run

interface Build {
  label: string;
  reported: string;
  origin: string;
  /** Replays one scenario at one VM version. */
  replay: (s: Scenario, scriptVersion: 0 | 1 | 2) => Promise<Run>;
}

const planOf = (s: Scenario, scriptVersion: 0 | 1 | 2): ReplayPlan => ({
  hash: s.hash ?? "(not on chain)",
  status: s.hash ? "committed" : "not on chain",
  ...(s.nodeCycles !== undefined && { nodeCycles: BigInt(s.nodeCycles) }),
  mock: s.mock,
  groups: groupsOf(s.mock),
  scriptVersion,
  network: s.source === "mainnet" ? "mainnet" : "testnet",
  rpcUrl: "",
});

async function replayWith(label: string, reported: string, s: Scenario, v: 0 | 1 | 2, run: RunDebugger, txFile: string): Promise<Run> {
  const base = { scenario: s.id, debugger: label, reported, scriptVersion: v };
  try {
    const p = await replayGroups(planOf(s, v), run, { txFile, debugger: reported });
    return {
      ...base,
      groups: p.groups.map((g) => ({ selector: g.selector, result: g.result, ...(g.error && { error: g.error }), cycles: String(g.cycles) })),
    };
  } catch (e) {
    return { ...base, groups: [], failure: (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" ") };
  }
}

async function nativeBuild(version: string, dir: string): Promise<Build> {
  const path = nativePath(version);
  const v = await runNativeDebugger(path, ["--version"]);
  const reported = (v.exitCode === 0 && v.stdout.trim()) || "unknown";
  const label = `native ${version}`;
  return {
    label,
    reported,
    origin: `GitHub release v${version}, ${platform}`,
    async replay(s, sv) {
      const txFile = join(dir, txFileName(s.id));
      if (!existsSync(txFile)) await writeFile(txFile, JSON.stringify(s.mock));
      const legacy = manifest.releases.find((r) => r.version === version)?.legacyCli;
      return replayWith(label, reported, s, sv, (args) => runNativeDebugger(path, legacy ? legacyArgs(args) : args), txFile);
    },
  };
}

async function wasmBuild(labelOf: (reported: string) => string, file: string, origin: string): Promise<Build> {
  const module = await WebAssembly.compile(await readFile(file));
  const reported = await wasmDebuggerVersion(module);
  const label = labelOf(reported);
  const enc = new TextEncoder();
  return {
    label,
    reported,
    origin,
    replay: (s, sv) => replayWith(label, reported, s, sv, wasmRunner(module, enc.encode(JSON.stringify(s.mock))), WASM_TX_FILE),
  };
}

async function runAll(): Promise<void> {
  if (!existsSync(SCENARIOS)) throw new Error(`${SCENARIOS} is missing: run \`npm run compat -- record\``);
  const file: ScenarioFile = JSON.parse(brotliDecompressSync(await readFile(SCENARIOS)).toString("utf8"));
  const scenarios = unpackScenarios(file);
  const dir = await mkdtemp(join(tmpdir(), "ckb-compat-"));
  const startedAt = new Date().toISOString();
  try {
    const builds: Build[] = [];
    const ref = manifest.reference;
    if (!existsSync(nativePath(ref))) throw new Error(`no native ${ref} in ${flags.cache}: run \`npm run compat -- fetch\``);
    // Reference first: every other build is compared with it.
    for (const r of [...releases].sort((a, b) => (a.version === ref ? -1 : b.version === ref ? 1 : 0))) {
      if (existsSync(nativePath(r.version))) builds.push(await nativeBuild(r.version, dir));
      else console.log(`skip native ${r.version}: not fetched`);
    }
    if (!flags["no-wasm"]) {
      for (const r of releases) {
        const f = join(flags.cache!, r.version, "wasm", "ckb-debugger.wasm");
        if (existsSync(f)) builds.push(await wasmBuild(() => `wasm ${r.version}`, f, `GitHub release v${r.version}, wasm32-wasip1`));
      }
      // The build the web page runs ships in ckb-testtool. When it is byte for
      // byte a release's wasm build, that release's run already covers it.
      if (existsSync(TESTTOOL_WASM)) {
        const pkg = JSON.parse(await readFile("node_modules/ckb-testtool/package.json", "utf8")) as { version: string };
        const sha = sha256Hex(await readFile(TESTTOOL_WASM));
        const twin = releases
          .map((r) => ({ r, f: join(flags.cache!, r.version, "wasm", "ckb-debugger.wasm") }))
          .find(({ f }) => existsSync(f) && sha256Hex(readFileSync(f)) === sha);
        const build = twin && builds.find((b) => b.label === `wasm ${twin.r.version}`);
        const note = `ckb-testtool ${pkg.version}, the build the web page runs (sha256 ${sha.slice(0, 12)}…)`;
        if (build) build.origin += `; byte-identical to the one in ${note}`;
        else builds.push(await wasmBuild((v) => `wasm ${v.replace(/^ckb-debugger /, "")} (ckb-testtool)`, TESTTOOL_WASM, note));
      }
    }

    const runs: Run[] = [];
    for (const b of builds) {
      const t0 = Date.now();
      for (const s of scenarios) {
        const versions: (0 | 1 | 2)[] = b.label === builds[0].label && !flags["no-sweep"] ? [0, 1, 2] : [s.scriptVersion];
        for (const v of versions) runs.push(await b.replay(s, v));
      }
      console.log(`${b.label.padEnd(32)} ${b.reported.padEnd(24)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }

    const debuggers = builds.map((b) => b.label);
    const about = Object.fromEntries(builds.map((b) => [b.label, { reported: b.reported, origin: b.origin }]));
    const notes = existsSync("compat/notes.md") ? await readFile("compat/notes.md", "utf8") : "";
    const md = [
      "# ckb-debugger cross-version results",
      "",
      `Generated by \`npm run compat\` (scripts/compat.ts) from the ${scenarios.length} frozen scenarios in ` +
        `\`compat/scenarios.json.br\` (recorded ${file.recordedAt}). Every build reads the same mock transaction bytes ` +
        "and is driven through the same replay code as `ckb-cycles`; only the debugger changes.",
      "",
      renderCompat({ scenarios, runs, debuggers, about, platform: `${platform} ${process.arch}, node ${process.version}`, startedAt }),
      notes.trim(),
      "",
    ].join("\n");
    await mkdir(dirname(flags.out!), { recursive: true });
    await writeFile(flags.out!, md);
    await writeFile(join(dirname(flags.out!), "results.json"),JSON.stringify({ startedAt, platform, debuggers: about, runs }, null, 1) + "\n");
    const bad = compareAll(runs, debuggers[0]).filter((c) => c.verdict !== "same");
    console.log(`wrote ${flags.out}: ${bad.length ? `${bad.length} mismatch(es)` : "no mismatches"}`);
    for (const c of bad) console.log(`  ${c.debugger} ${c.scenario} VM ${c.scriptVersion}: ${c.verdict}: ${c.diffs.join("; ")}`);
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (command === "fetch") await fetchAll();
else if (command === "record") await record();
else if (command === "run") await runAll();
else throw new Error(`unknown command ${command}: fetch, record or run`);

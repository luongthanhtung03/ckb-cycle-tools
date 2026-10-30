/**
 * `ckb-cycles scan`: a cycles.json from the transactions a test suite wrote.
 *
 * The tests (Rust ckb-testtool, through integrations/ckb-testtool, or anything
 * else that writes ckb-debugger mock transactions) leave one mock per
 * transaction in a directory. Each becomes a `"mock"` scenario, named by its
 * file. Each file in the binaries directory (a ckb-script-templates project's
 * `build/release`) whose data hash is the data of a code cell dep in some mock
 * becomes a binary, matched by that hash, with `<name>.debug` beside it as its
 * symbols build.
 *
 * The hashes are those of the build the tests ran against, so the file is
 * regenerated after each build rather than written by hand.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { termLine } from "./diff.js";
import type { MockTransaction } from "./mock.js";
import type { BinaryConfig, CyclesConfig } from "./report.js";

export interface ScannedMock {
  /** The scenario's name: the file name without `.json`. */
  name: string;
  /** Path of the file, as the config will name it. */
  path: string;
  mock: MockTransaction;
}

export interface ScannedBinary {
  name: string;
  /** Path of the binary, as the config will name it. */
  path: string;
  data: Uint8Array;
  /** Path of `<name>.debug`, when there is one. */
  symbols?: string;
}

export interface ScanResult {
  config: CyclesConfig;
  /** Binaries some mock deploys, by name. */
  matched: string[];
  /** Files in the binaries directory no mock deploys: a stale build, or a contract with no test. */
  unused: string[];
  /** Data hashes of code cells in the mocks that are none of the binaries (ckb-testtool's always-success, say). */
  others: string[];
}

/** The cycles.json for these mocks and binaries. Pure: the caller reads the files. */
export function configFromMocks(
  mocks: ScannedMock[],
  binaries: ScannedBinary[],
  options: { functions?: boolean } = {},
): ScanResult {
  if (!mocks.length) throw new Error("no mock transactions to scan");
  const deployed = new Set<string>();
  for (const m of mocks) {
    for (const d of m.mock.mock_info.cell_deps) if (d.cell_dep.dep_type === "code") deployed.add(ccc.hashCkb(d.data));
  }
  const found: Record<string, BinaryConfig> = {};
  const matched: string[] = [];
  const unused: string[] = [];
  const hashes = new Set<string>();
  for (const b of [...binaries].sort((a, b) => a.name.localeCompare(b.name))) {
    const codeHash = ccc.hashCkb(b.data);
    if (!deployed.has(codeHash)) {
      unused.push(b.name);
      continue;
    }
    if (hashes.has(codeHash)) {
      // Two files with the same bytes: the first one names it.
      unused.push(b.name);
      continue;
    }
    hashes.add(codeHash);
    found[b.name] = { path: b.path, codeHash, ...(b.symbols && { symbols: b.symbols }) };
    matched.push(b.name);
  }
  if (options.functions && !Object.values(found).some((b) => b.symbols)) {
    throw new Error(`--functions needs a <name>.debug (an unstripped build) beside a binary the tests deploy`);
  }
  const config: CyclesConfig = {
    ...(options.functions && { functions: true }),
    binaries: found,
    scenarios: [...mocks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ name: m.name, mock: m.path })),
  };
  return { config, matched, unused, others: [...deployed].filter((h) => !hashes.has(h)).sort() };
}

export interface ScanOptions {
  /** Where the contracts are built. Default `build/release`. */
  binariesDir?: string;
  /** The cycles.json to write; the paths in it are relative to it. Default `cycles.json`. */
  out?: string;
  /** Record each group's costliest functions, from the `.debug` builds. */
  functions?: boolean;
}

const posix = (p: string) => p.split(sep).join("/");

/** Reads the mocks and the binaries, and writes the cycles.json. */
export async function scanTestMocks(mocksDir: string, options: ScanOptions = {}): Promise<ScanResult & { out: string }> {
  const out = resolve(options.out ?? "cycles.json");
  const binariesDir = resolve(options.binariesDir ?? join("build", "release"));
  const rel = (file: string) => posix(relative(dirname(out), file));

  const mocks: ScannedMock[] = [];
  const mockFiles = (await readdir(mocksDir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") throw new Error(`${mocksDir} does not exist: run the tests with CKB_CYCLES_MOCKS set to it`);
    throw e;
  }))
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const f of mockFiles) {
    const file = resolve(mocksDir, f);
    let mock: MockTransaction;
    try {
      mock = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      throw new Error(`${join(mocksDir, f)}: not JSON (${e instanceof Error ? e.message : e})`);
    }
    if (!mock?.mock_info || !mock.tx) throw new Error(`${join(mocksDir, f)} is not a ckb-debugger mock transaction`);
    mocks.push({ name: f.slice(0, -".json".length), path: rel(file), mock });
  }
  if (!mocks.length) throw new Error(`no mock transactions in ${mocksDir}: run the tests with CKB_CYCLES_MOCKS set to it`);

  const names = await readdir(binariesDir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") throw new Error(`${options.binariesDir ?? "build/release"} does not exist: build the contracts first`);
    throw e;
  });
  const binaries: ScannedBinary[] = [];
  for (const name of names.filter((n) => !n.endsWith(".debug")).sort()) {
    const file = join(binariesDir, name);
    if (!(await stat(file)).isFile()) continue;
    const debug = `${file}.debug`;
    const symbols = await stat(debug).then((s) => s.isFile(), () => false);
    binaries.push({ name, path: rel(file), data: new Uint8Array(await readFile(file)), ...(symbols && { symbols: rel(debug) }) });
  }

  const result = configFromMocks(mocks, binaries, { functions: options.functions });
  await writeFile(out, JSON.stringify(result.config, null, 2) + "\n");
  return { ...result, out };
}

/** What scan found, for stderr. */
export function formatScan(r: ScanResult & { out: string }, binariesDir: string): string {
  const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
  const lines = [
    `${basename(r.out)}: ${r.config.scenarios.length} scenario(s), ${r.matched.length} binar${r.matched.length === 1 ? "y" : "ies"}` +
      (r.matched.length ? ` (${r.matched.map(termLine).join(", ")})` : ""),
  ];
  if (!r.matched.length) {
    lines.push(`no file in ${binariesDir} is deployed by any test: the report cannot swap in another build (rebuild, then rerun the tests?)`);
  }
  if (r.unused.length) lines.push(`not deployed by any test: ${r.unused.map(termLine).join(", ")}`);
  if (r.others.length) lines.push(`code cells that are none of the binaries: ${r.others.map(short).join(", ")}`);
  return lines.join("\n");
}

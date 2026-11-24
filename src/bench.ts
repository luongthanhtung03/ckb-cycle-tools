/**
 * `ckb-cycles bench`: the cycles of a ckb-script-templates project's tests,
 * compared with a saved baseline, in the manner of `cargo bench` (criterion's
 * `--save-baseline` / `--baseline`).
 *
 * One run: build the contracts (`make build`), run the tests with
 * CKB_CYCLES_MOCKS set (`cargo test -p tests`; the tests call
 * integrations/ckb-testtool), `scan` the mocks into a cycles.json, `report` it.
 * When a baseline of that name was saved before, the same mocks are reported
 * again with the baseline's binaries swapped in, and the two reports diffed.
 *
 * Why the baseline keeps binaries, not just a report: every build changes the
 * mocks (the deployed binary is cell data in them, and the cycles.json's code
 * hashes change with it), so a report from an earlier run has other inputs and
 * `diff` would mark each scenario NOT COMPARED. Replaying this run's mocks with
 * the old code is the comparison the Action makes for a pull request
 * (`report --binaries-from <base checkout>`), with a saved directory standing
 * in for the base checkout.
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { diffFailed, diffReports, formatMarkdown, formatText, type CycleDiff, type CycleReport, type DiffOptions } from "./diff.js";
import { formatReport, runReport, type ReportOptions } from "./report.js";
import { formatScan, scanTestMocks } from "./scan.js";

export const BENCH_DEFAULTS = {
  build: "make build",
  test: "cargo test -p tests",
  mocksDir: "target/ckb-cycles",
  binariesDir: "build/release",
  out: "cycles.json",
  benchDir: "target/ckb-cycles-bench",
  baseline: "base",
} as const;

/** Runs a shell command; resolves to its exit code. */
export type RunCommand = (command: string, options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<number>;

export interface BenchOptions {
  /** The project root; every other path resolves against it. Default: the current directory. */
  cwd?: string;
  /** Shell command that builds the contracts, or false to use the build already there. */
  build?: string | false;
  /** Shell command that runs the tests; CKB_CYCLES_MOCKS is set for it. */
  test?: string;
  /** Where the tests write their mocks. Its *.json files are deleted before the tests run. */
  mocksDir?: string;
  binariesDir?: string;
  /** The cycles.json to write. */
  out?: string;
  /** Where reports and baselines go. */
  benchDir?: string;
  /** Compare with this baseline and do not save (criterion's `--baseline`). It must exist. */
  baseline?: string;
  /**
   * Compare with this baseline when it exists, then save this run under its
   * name (criterion's `--save-baseline`). Default, when neither is given: "base".
   */
  saveBaseline?: string;
  /** Record each group's costliest functions. Default: when a `<name>.debug` is beside a binary. */
  functions?: boolean;
  /** Gates for the comparison; without any, the comparison never fails the run. */
  diff?: DiffOptions;
  /** Passed to both reports. */
  report?: Pick<ReportOptions, "debuggerPath" | "runDebugger" | "debuggerBuild" | "toolchain" | "timeoutMs">;
  /** For tests: runs the build and test commands. Default: the shell. */
  runCommand?: RunCommand;
  /** Progress and results, a line or block at a time. Default: stderr for progress, stdout for results. */
  log?: (text: string, stream: "out" | "err") => void;
}

export interface BenchResult {
  /** 0 nothing failed, 1 a gate of the comparison failed, 2 a step did not complete. */
  code: number;
  head?: CycleReport;
  /** The baseline's binaries replaying this run's mocks. */
  base?: CycleReport;
  diff?: CycleDiff;
  /** The baseline compared with, when there was one. */
  compared?: string;
  /** The baseline this run was saved as. */
  saved?: string;
  /** Files written besides the cycles.json and the baseline. */
  files: { head?: string; base?: string; markdown?: string };
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function checkBaselineName(name: string): string {
  if (!NAME.test(name)) throw new Error(`baseline name "${name}": letters, digits, ".", "_" and "-", up to 64, starting with a letter or digit`);
  return name;
}

const defaultRun: RunCommand = (command, { cwd, env }) =>
  new Promise((done, fail) => {
    // The commands are the user's own (flags, or the defaults): a shell, as make would use.
    const child = spawn(command, { cwd, env, shell: true, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", fail);
    child.on("exit", (code, signal) => done(code ?? (signal ? 128 : 1)));
  });

const defaultLog = (text: string, stream: "out" | "err") => (stream === "out" ? console.log(text) : console.error(text));

const exists = (p: string) => stat(p).then(() => true, () => false);

/** A report as `report --json` writes it: its errors in it, so a diff sees them. */
function asReport(r: Awaited<ReturnType<typeof runReport>>): CycleReport {
  const { errors, notices: _, ...data } = r;
  return { ...data, ...(errors.length && { errors }) };
}

const toJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) + "\n";

/**
 * The files the cycles.json names as binaries and symbols builds, relative to
 * its directory: what a baseline keeps, at the same relative paths, so
 * `--binaries-from <baseline>` finds them.
 */
function baselineFiles(config: { binaries?: Record<string, { path: string; symbols?: string }> }): string[] {
  const files = new Set<string>();
  for (const [name, b] of Object.entries(config.binaries ?? {})) {
    for (const p of [b.path, b.symbols]) {
      if (p === undefined) continue;
      if (isAbsolute(p) || p.split(/[\\/]/).includes("..")) {
        throw new Error(`binary "${name}": ${p} is not inside the cycles.json's directory, so a baseline cannot keep it at the same path (write the cycles.json at the project root)`);
      }
      files.add(p);
    }
  }
  return [...files].sort();
}

/** Copies the run's binaries into the baseline directory, replacing what was there. */
async function saveBaseline(dir: string, configDir: string, files: string[], report: CycleReport): Promise<void> {
  const tmp = `${dir}.saving-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  for (const f of files) {
    const to = join(tmp, f);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(resolve(configDir, f), to);
  }
  await mkdir(tmp, { recursive: true });
  await writeFile(join(tmp, "report.json"), toJson(report));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  await rename(tmp, dir);
}

export async function runBench(options: BenchOptions = {}): Promise<BenchResult> {
  const cwd = resolve(options.cwd ?? ".");
  const at = (p: string) => resolve(cwd, p);
  const log = options.log ?? defaultLog;
  const run = options.runCommand ?? defaultRun;
  const files: BenchResult["files"] = {};

  if (options.baseline !== undefined && options.saveBaseline !== undefined) {
    throw new Error("--baseline compares without saving and --save-baseline saves: pass one of them");
  }
  const compareWith = checkBaselineName(options.baseline ?? options.saveBaseline ?? BENCH_DEFAULTS.baseline);
  const saveAs = options.baseline === undefined ? compareWith : undefined;
  const benchDir = at(options.benchDir ?? BENCH_DEFAULTS.benchDir);
  const baselineDir = (name: string) => join(benchDir, "baselines", name);
  const mocksDir = at(options.mocksDir ?? BENCH_DEFAULTS.mocksDir);
  const binariesDir = at(options.binariesDir ?? BENCH_DEFAULTS.binariesDir);
  const out = at(options.out ?? BENCH_DEFAULTS.out);

  // --baseline names one that must be there; checked before anything is built.
  const haveBaseline = await exists(join(baselineDir(compareWith), "report.json"));
  if (options.baseline !== undefined && !haveBaseline) {
    throw new Error(`no baseline "${compareWith}" in ${relative(cwd, benchDir) || "."}/baselines: save one first (ckb-cycles bench --save-baseline ${compareWith})`);
  }

  if (options.build !== false) {
    const build = options.build ?? BENCH_DEFAULTS.build;
    log(`== build: ${build}`, "err");
    const code = await run(build, { cwd, env: process.env });
    if (code !== 0) {
      log(`error: the build exited ${code}`, "err");
      return { code: 2, files };
    }
  }

  // Only the mocks go: a directory the user pointed elsewhere keeps everything else.
  await mkdir(mocksDir, { recursive: true });
  for (const f of await readdir(mocksDir)) if (f.endsWith(".json")) await unlink(join(mocksDir, f));
  const test = options.test ?? BENCH_DEFAULTS.test;
  log(`== tests: CKB_CYCLES_MOCKS=${relative(cwd, mocksDir)} ${test}`, "err");
  const testCode = await run(test, { cwd, env: { ...process.env, CKB_CYCLES_MOCKS: mocksDir } });
  if (testCode !== 0) {
    log(`error: the tests exited ${testCode}`, "err");
    return { code: 2, files };
  }

  // Functions by default when there is something to name them from.
  const functions =
    options.functions ?? (await readdir(binariesDir).then((n) => n.some((f) => f.endsWith(".debug")), () => false));
  const scanned = await scanTestMocks(mocksDir, { binariesDir, out, ...(functions && { functions: true }) });
  log(formatScan(scanned, relative(cwd, binariesDir) || "."), "err");
  if (!scanned.matched.length) {
    log("error: no binary to compare: no test deployed a file in the binaries directory", "err");
    return { code: 2, files };
  }
  // What the baseline will keep, checked before the reports run.
  const keep = saveAs !== undefined ? baselineFiles(scanned.config) : [];

  log("== report", "err");
  const reportOptions = { ...options.report, onScenario: (s: { name: string; error?: string }) => log(`${s.error ? "✗" : "·"} ${s.name}`, "err") };
  const headRun = await runReport(out, reportOptions);
  const head = asReport(headRun);
  await mkdir(benchDir, { recursive: true });
  files.head = join(benchDir, "head.json");
  await writeFile(files.head, toJson(head));
  log(formatReport(head), "out");
  for (const n of headRun.notices ?? []) log(`warning: ${n}`, "err");
  for (const e of headRun.errors) log(`error: ${e}`, "err");
  if (headRun.errors.length) return { code: 2, head, files };

  const result: BenchResult = { code: 0, head, files };
  if (haveBaseline) {
    log(`== baseline "${compareWith}": this run's tests with its binaries`, "err");
    const baseRun = await runReport(out, { ...reportOptions, binariesRoot: baselineDir(compareWith) });
    const base = asReport(baseRun);
    files.base = join(benchDir, "base.json");
    await writeFile(files.base, toJson(base));
    for (const e of baseRun.errors) log(`error (baseline): ${e}`, "err");
    const diff = diffReports(base, head, options.diff);
    files.markdown = join(benchDir, "diff.md");
    await writeFile(files.markdown, formatMarkdown(diff, { baseLabel: `baseline ${compareWith}`, headLabel: "this run" }) + "\n");
    log(`\nchange against baseline "${compareWith}":\n${formatText(diff)}`, "out");
    Object.assign(result, { base, diff, compared: compareWith, code: diffFailed(diff, options.diff) ? 1 : 0 });
  } else {
    log(`no baseline "${compareWith}" yet: nothing to compare with`, "err");
  }

  if (saveAs !== undefined && result.code !== 0) {
    // A run that fails its gate does not become the baseline the next run passes against.
    log(`not saved as baseline "${saveAs}": the comparison failed its gate`, "err");
  } else if (saveAs !== undefined) {
    await saveBaseline(baselineDir(saveAs), dirname(out), keep, head);
    result.saved = saveAs;
    log(`saved as baseline "${saveAs}" (${relative(cwd, baselineDir(saveAs))})`, "err");
  }
  return result;
}

/**
 * `ckb-cycles bench` on a copy of test/fixtures/testtool-project. The build and
 * test commands are stand-ins (the "tests" copy the fixture's mocks, which its
 * Rust tests wrote, into CKB_CYCLES_MOCKS); the reports run in the WebAssembly
 * ckb-debugger.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkBaselineName, runBench, type BenchOptions, type RunCommand } from "../src/bench.js";
import type { DebuggerOutput } from "../src/profile.js";
import { runWasmDebugger } from "../src/wasm.js";

const PROJECT = "test/fixtures/testtool-project";
const MOCKS = ["tests.test_light_spend.json", "tests.test_empty_args_rejected.json"];
const OTHER_BINARY = "test/fixtures/spawn-project/build/release/spawn-child";

let run: (args: string[]) => Promise<DebuggerOutput>;
beforeAll(async () => {
  const module = await WebAssembly.compile(readFileSync("node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm"));
  run = async (args) => {
    const i = args.indexOf("--tx-file");
    if (i < 0) return runWasmDebugger(module, args);
    const tx = new Uint8Array(readFileSync(resolve(args[i + 1])));
    return runWasmDebugger(module, args.map((a, j) => (j === i + 1 ? "/tx.json" : a)), { "tx.json": tx });
  };
});

/** A fresh project: the fixture's build, and no mocks yet. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "ckb-cycles-bench-"));
  mkdirSync(join(dir, "build/release"), { recursive: true });
  copyFileSync(join(PROJECT, "build/release/args-loop"), join(dir, "build/release/args-loop"));
  return dir;
}

/** Records the commands; "tests" write the fixture's mocks where CKB_CYCLES_MOCKS says. */
function commands(codes: { build?: number; test?: number } = {}) {
  const ran: string[] = [];
  const runCommand: RunCommand = async (command, { env }) => {
    ran.push(command);
    if (command.startsWith("cargo test")) {
      const to = env.CKB_CYCLES_MOCKS!;
      for (const f of MOCKS) copyFileSync(join(PROJECT, "mocks", f), join(to, f));
      return codes.test ?? 0;
    }
    return codes.build ?? 0;
  };
  return { ran, runCommand };
}

const bench = (cwd: string, extra: Partial<BenchOptions> = {}) => {
  const lines: string[] = [];
  const { ran, runCommand } = commands();
  return {
    lines,
    ran,
    result: runBench({ cwd, runCommand, report: { runDebugger: run }, log: (t) => lines.push(t), ...extra }),
  };
};

const cyclesOf = (r: { scenarios: { name: string; groups: { cycles: number }[] }[] }) =>
  Object.fromEntries(r.scenarios.map((s) => [s.name, s.groups.reduce((n, g) => n + g.cycles, 0)]));

describe("runBench", () => {
  it("first run: builds, tests, reports, and saves the binaries as baseline base", async () => {
    const dir = project();
    const b = bench(dir);
    const r = await b.result;
    expect(b.ran).toEqual(["make build", "cargo test -p tests"]);
    expect(r.code).toBe(0);
    expect(r.compared).toBeUndefined();
    expect(r.saved).toBe("base");
    expect(cyclesOf(r.head!)).toEqual({ "tests.test_empty_args_rejected": 2_186, "tests.test_light_spend": 25_504 });
    expect(JSON.parse(readFileSync(join(dir, "cycles.json"), "utf8")).scenarios).toHaveLength(2);
    const saved = join(dir, "target/ckb-cycles-bench/baselines/base");
    expect(readFileSync(join(saved, "build/release/args-loop"))).toEqual(readFileSync(join(dir, "build/release/args-loop")));
    expect(JSON.parse(readFileSync(join(saved, "report.json"), "utf8")).tool).toBe("ckb-cycles");
    expect(existsSync(join(dir, "target/ckb-cycles-bench/head.json"))).toBe(true);
    expect(b.lines.join("\n")).toContain('no baseline "base" yet');
  }, 120_000);

  it("second run: the same code compares as unchanged, every scenario compared", async () => {
    const dir = project();
    await bench(dir).result;
    const b = bench(dir, { diff: { failAbove: 0, failOnResultChange: true } });
    const r = await b.result;
    expect(r.code).toBe(0);
    expect(r.compared).toBe("base");
    expect(r.diff!.rows.map((x) => x.kind)).toEqual(["same", "same"]);
    expect(cyclesOf(r.base!)).toEqual(cyclesOf(r.head!));
    expect(readFileSync(join(dir, "target/ckb-cycles-bench/diff.md"), "utf8")).toContain("baseline base");
  }, 120_000);

  it("--baseline replays this run's tests with the saved binaries, and saves nothing", async () => {
    const dir = project();
    await bench(dir, { saveBaseline: "main" }).result;
    // Stand in for an older build: another binary in the saved baseline.
    const savedBinary = join(dir, "target/ckb-cycles-bench/baselines/main/build/release/args-loop");
    copyFileSync(OTHER_BINARY, savedBinary);
    const r = await bench(dir, { baseline: "main", build: false }).result;
    expect(r.compared).toBe("main");
    expect(r.saved).toBeUndefined();
    expect(cyclesOf(r.base!)).not.toEqual(cyclesOf(r.head!));
    expect(r.diff!.rows.every((x) => x.kind !== "same")).toBe(true);
    // Not gated: a change alone does not fail the run.
    expect(r.code).toBe(0);
    expect(readFileSync(savedBinary)).toEqual(readFileSync(OTHER_BINARY));
  }, 120_000);

  it("a run that fails its gate exits 1 and does not replace the baseline", async () => {
    const dir = project();
    await bench(dir).result;
    const savedBinary = join(dir, "target/ckb-cycles-bench/baselines/base/build/release/args-loop");
    copyFileSync(OTHER_BINARY, savedBinary);
    const b = bench(dir, { build: false, diff: { failOnResultChange: true } });
    const r = await b.result;
    expect(r.code).toBe(1);
    expect(r.saved).toBeUndefined();
    expect(b.lines.join("\n")).toContain("not saved");
    expect(readFileSync(savedBinary)).toEqual(readFileSync(OTHER_BINARY));
  }, 120_000);

  it("deletes the previous run's mocks before the tests run", async () => {
    const dir = project();
    mkdirSync(join(dir, "target/ckb-cycles"), { recursive: true });
    writeFileSync(join(dir, "target/ckb-cycles/tests.removed_test.json"), "{}");
    writeFileSync(join(dir, "target/ckb-cycles/notes.txt"), "kept");
    const r = await bench(dir, { build: false }).result;
    expect(r.code).toBe(0);
    expect(readdirSync(join(dir, "target/ckb-cycles")).sort()).toEqual(["notes.txt", ...MOCKS].sort());
  }, 120_000);

  it("stops with 2 when the build or the tests fail", async () => {
    const dir = project();
    const failedBuild = commands({ build: 1 });
    const a = await runBench({ cwd: dir, runCommand: failedBuild.runCommand, log: () => {} });
    expect(a.code).toBe(2);
    expect(failedBuild.ran).toEqual(["make build"]);
    const failedTests = commands({ test: 101 });
    const b = await runBench({ cwd: dir, build: "true", runCommand: failedTests.runCommand, log: () => {} });
    expect(b.code).toBe(2);
    expect(failedTests.ran).toEqual(["true", "cargo test -p tests"]);
    expect(existsSync(join(dir, "cycles.json"))).toBe(false);
  });

  it("refuses a missing --baseline before building anything", async () => {
    const dir = project();
    const c = commands();
    await expect(runBench({ cwd: dir, baseline: "nope", runCommand: c.runCommand, log: () => {} })).rejects.toThrow(/no baseline "nope".*--save-baseline nope/);
    expect(c.ran).toEqual([]);
  });

  it("refuses both flags at once, and baseline names that are paths", async () => {
    await expect(runBench({ baseline: "a", saveBaseline: "b" })).rejects.toThrow(/one of them/);
    for (const bad of ["..", "../x", "a/b", "", ".hidden", "x".repeat(65)]) expect(() => checkBaselineName(bad)).toThrow(/baseline name/);
    expect(checkBaselineName("main-1.5_x")).toBe("main-1.5_x");
  });

  it("refuses to save binaries the cycles.json reaches with ..", async () => {
    const dir = project();
    mkdirSync(join(dir, "ci"));
    await expect(bench(dir, { out: "ci/cycles.json", build: false }).result).rejects.toThrow(/not inside the cycles.json's directory/);
  }, 120_000);
});

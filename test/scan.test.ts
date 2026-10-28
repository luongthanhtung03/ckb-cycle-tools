/**
 * `ckb-cycles scan` against test/fixtures/testtool-project: a hand-made project
 * in the shape of a ckb-script-templates workspace. Its mocks were written by
 * its Rust tests (ckb-testtool 1.1.1 with integrations/ckb-testtool, run with
 * CKB_CYCLES_MOCKS set), against the args-loop build committed in
 * build/release. See the fixture's Makefile.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { beforeAll, describe, expect, it } from "vitest";
import type { MockTransaction } from "../src/mock.js";
import type { DebuggerOutput } from "../src/profile.js";
import { runReport } from "../src/report.js";
import { configFromMocks, formatScan, scanTestMocks, type ScannedMock } from "../src/scan.js";
import { runWasmDebugger } from "../src/wasm.js";

const PROJECT = "test/fixtures/testtool-project";
const BINARY = readFileSync(join(PROJECT, "build/release/args-loop"));
const BINARY_HASH = ccc.hashCkb(BINARY);

/** A mock with one code cell dep per binary, as ckb-testtool dumps them. */
const mockWith = (...codes: Uint8Array[]): MockTransaction => ({
  mock_info: {
    inputs: [],
    cell_deps: codes.map((data, i) => ({
      cell_dep: { out_point: { tx_hash: "0x" + String(i).padStart(64, "0"), index: "0x0" }, dep_type: "code" as const },
      output: { capacity: "0x0", lock: { code_hash: "0x" + "00".repeat(32), hash_type: "data", args: "0x" }, type: null },
      data: ccc.hexFrom(data),
      header: null,
    })),
    header_deps: [],
  },
  tx: { version: "0x0", cell_deps: [], header_deps: [], inputs: [], outputs: [], outputs_data: [], witnesses: [] },
});

describe("configFromMocks", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5, 6]);
  const other = new Uint8Array([9]);
  const mocks: ScannedMock[] = [
    { name: "tests.z", path: "mocks/tests.z.json", mock: mockWith(a, other) },
    { name: "tests.a", path: "mocks/tests.a.json", mock: mockWith(a) },
  ];

  it("makes a scenario per mock and a binary per deployed file, by data hash", () => {
    const r = configFromMocks(mocks, [
      { name: "b", path: "build/release/b", data: b },
      { name: "a", path: "build/release/a", data: a, symbols: "build/release/a.debug" },
    ]);
    expect(r.config).toEqual({
      binaries: { a: { path: "build/release/a", codeHash: ccc.hashCkb(a), symbols: "build/release/a.debug" } },
      scenarios: [
        { name: "tests.a", mock: "mocks/tests.a.json" },
        { name: "tests.z", mock: "mocks/tests.z.json" },
      ],
    });
    expect(r.matched).toEqual(["a"]);
    expect(r.unused).toEqual(["b"]);
    expect(r.others).toEqual([ccc.hashCkb(other)]);
  });

  it("names a binary built twice under two names once", () => {
    const r = configFromMocks(mocks, [
      { name: "a", path: "a", data: a },
      { name: "a-copy", path: "a-copy", data: a },
    ]);
    expect(Object.keys(r.config.binaries!)).toEqual(["a"]);
    expect(r.unused).toEqual(["a-copy"]);
  });

  it("sets functions only when asked, and only with a symbols build", () => {
    expect(configFromMocks(mocks, [{ name: "a", path: "a", data: a, symbols: "a.debug" }], { functions: true }).config.functions).toBe(true);
    expect(() => configFromMocks(mocks, [{ name: "a", path: "a", data: a }], { functions: true })).toThrow(/--functions needs a <name>.debug/);
  });

  it("refuses an empty set of mocks", () => {
    expect(() => configFromMocks([], [])).toThrow(/no mock transactions/);
  });

  it("says when no binary is deployed by any test", () => {
    const r = configFromMocks(mocks, [{ name: "b", path: "b", data: b }]);
    const text = formatScan({ ...r, out: "cycles.json" }, "build/release");
    expect(text).toContain("2 scenario(s), 0 binaries");
    expect(text).toContain("no file in build/release is deployed by any test");
    expect(text).toContain("not deployed by any test: b");
  });
});

describe("scanTestMocks on the fixture project", () => {
  let dir: string;
  beforeAll(() => {
    // A copy, so the .debug and the cycles.json are written outside the repository.
    dir = mkdtempSync(join(tmpdir(), "ckb-cycles-scan-"));
    mkdirSync(join(dir, "build/release"), { recursive: true });
    mkdirSync(join(dir, "mocks"));
    copyFileSync(join(PROJECT, "build/release/args-loop"), join(dir, "build/release/args-loop"));
    writeFileSync(join(dir, "build/release/args-loop.debug"), "stands in for the unstripped build");
    writeFileSync(join(dir, "build/release/stale-contract"), "no test deploys this");
    for (const f of readdirSync(join(PROJECT, "mocks"))) copyFileSync(join(PROJECT, "mocks", f), join(dir, "mocks", f));
  });

  it("writes a cycles.json with every test's transaction and the fresh build", async () => {
    const r = await scanTestMocks(join(dir, "mocks"), { binariesDir: join(dir, "build/release"), out: join(dir, "cycles.json") });
    const written = JSON.parse(readFileSync(join(dir, "cycles.json"), "utf8"));
    expect(written).toEqual(r.config);
    expect(written.binaries).toEqual({
      "args-loop": { path: "build/release/args-loop", codeHash: BINARY_HASH, symbols: "build/release/args-loop.debug" },
    });
    expect(written.scenarios.map((s: { name: string }) => s.name)).toEqual([
      "tests.test_beside_always_success",
      "tests.test_empty_args_rejected",
      "tests.test_heavy_spend",
      "tests.test_light_spend",
      "tests.test_two_transactions",
      "tests.test_two_transactions-2",
    ]);
    expect(written.scenarios[0].mock).toBe("mocks/tests.test_beside_always_success.json");
    expect(r.unused).toEqual(["stale-contract"]);
    // ckb-testtool's built-in always-success, deployed by one test.
    expect(r.others).toHaveLength(1);
  });

  it("writes paths relative to the cycles.json, wherever it goes", async () => {
    mkdirSync(join(dir, "ci"), { recursive: true });
    const r = await scanTestMocks(join(dir, "mocks"), { binariesDir: join(dir, "build/release"), out: join(dir, "ci/cycles.json") });
    expect(r.config.binaries!["args-loop"].path).toBe("../build/release/args-loop");
    expect(r.config.scenarios[0].mock).toBe("../mocks/tests.test_beside_always_success.json");
  });

  it("says what to do when the mocks or the build are missing", async () => {
    await expect(scanTestMocks(join(dir, "nope"), { binariesDir: join(dir, "build/release") })).rejects.toThrow(/CKB_CYCLES_MOCKS/);
    await expect(scanTestMocks(join(dir, "mocks"), { binariesDir: join(dir, "build/nope") })).rejects.toThrow(/build the contracts first/);
    const empty = mkdtempSync(join(tmpdir(), "ckb-cycles-empty-"));
    await expect(scanTestMocks(empty, { binariesDir: join(dir, "build/release") })).rejects.toThrow(/no mock transactions/);
    writeFileSync(join(empty, "x.json"), JSON.stringify({ not: "a mock" }));
    await expect(scanTestMocks(empty, { binariesDir: join(dir, "build/release") })).rejects.toThrow(/not a ckb-debugger mock/);
  });

  it("reports the test suite's cycles in the WebAssembly ckb-debugger", async () => {
    await scanTestMocks(join(dir, "mocks"), { binariesDir: join(dir, "build/release"), out: join(dir, "cycles.json") });
    const module = await WebAssembly.compile(readFileSync("node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm"));
    // The report hands the debugger a path on disk; the WebAssembly one reads it from memory.
    const run = async (args: string[]): Promise<DebuggerOutput> => {
      const i = args.indexOf("--tx-file");
      if (i < 0) return runWasmDebugger(module, args);
      const tx = new Uint8Array(readFileSync(resolve(args[i + 1])));
      const mapped = args.map((a, j) => (j === i + 1 ? "/tx.json" : a));
      return runWasmDebugger(module, mapped, { "tx.json": tx });
    };
    const r = await runReport(join(dir, "cycles.json"), { runDebugger: run });
    expect(r.errors).toEqual([]);
    const rows = r.scenarios.flatMap((s) => s.groups.map((g) => [s.name, g.selector, g.script, g.result, g.cycles]));
    // The same numbers ckb-debugger 1.1.1 (native) gives for these mocks.
    expect(rows).toEqual([
      ["tests.test_beside_always_success", "input.0.lock", "args-loop", 0, 95_392],
      ["tests.test_beside_always_success", "input.1.lock", expect.any(String), 0, 2_107],
      ["tests.test_empty_args_rejected", "input.0.lock", "args-loop", 5, 2_186],
      ["tests.test_heavy_spend", "input.0.lock", "args-loop", 0, 468_128],
      ["tests.test_light_spend", "input.0.lock", "args-loop", 0, 25_504],
      ["tests.test_two_transactions", "input.0.lock", "args-loop", 0, 13_856],
      ["tests.test_two_transactions-2", "input.0.lock", "args-loop", 0, 188_576],
    ]);
  }, 120_000);
});

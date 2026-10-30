import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assetUrl,
  checkSha256,
  compareAll,
  compareRun,
  packScenarios,
  renderCompat,
  shortFailure,
  txFileName,
  unpackScenarios,
  type Manifest,
  type Run,
  type Scenario,
} from "../scripts/compat-lib.js";
import type { MockTransaction } from "../src/mock.js";

const manifest: Manifest = JSON.parse(readFileSync("compat/debuggers.json", "utf8"));

describe("compat/debuggers.json", () => {
  it("pins the reference release the CLI and CI install, with the same checksum", () => {
    expect(manifest.reference).toBe("1.1.1");
    const ref = manifest.releases.find((r) => r.version === "1.1.1")!;
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain(ref.native.linux!.sha256);
  });

  it("names every asset with a sha256 and builds GitHub release URLs", () => {
    for (const r of manifest.releases) {
      for (const a of [...Object.values(r.native), ...(r.wasm ? [r.wasm] : [])]) expect(a!.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const r = manifest.releases.find((r) => r.version === "1.1.1")!;
    expect(assetUrl(manifest, r, r.native.linux!)).toBe(
      "https://github.com/nervosnetwork/ckb-standalone-debugger/releases/download/v1.1.1/ckb-debugger_v1.1.1_x86_64-unknown-linux-gnu.tar.gz",
    );
  });
});

describe("checkSha256", () => {
  it("accepts the right digest in either case and refuses any other", () => {
    const bytes = new TextEncoder().encode("ckb");
    const hex = createHash("sha256").update(bytes).digest("hex");
    expect(() => checkSha256(bytes, hex.toUpperCase(), "x")).not.toThrow();
    expect(() => checkSha256(bytes, "0".repeat(64), "x")).toThrow(/the release publishes 0{64}/);
  });
});

const big = "0x" + "ab".repeat(4096);
const mock = (data: string): MockTransaction =>
  ({
    mock_info: {
      inputs: [{ input: {}, output: {}, data: "0x", header: null }],
      cell_deps: [{ cell_dep: {}, output: {}, data, header: null }],
      header_deps: [],
    },
    tx: {},
  }) as unknown as MockTransaction;
const scenario = (id: string, data = big, extra: Partial<Scenario> = {}): Scenario => ({
  id,
  source: "testtool",
  title: id,
  scriptVersion: 2,
  names: {},
  mock: mock(data),
  ...extra,
});

describe("packScenarios", () => {
  it("stores a large cell once and restores every mock exactly", () => {
    const scenarios = [scenario("a"), scenario("b"), scenario("c", "0x00")];
    const file = packScenarios(scenarios, { recordedAt: "t", recordedWith: "w" });
    expect(Object.keys(file.blobs)).toHaveLength(1);
    expect(file.scenarios[0].mock.mock_info.cell_deps[0].data).toMatch(/^blob:[0-9a-f]{64}$/);
    expect(file.scenarios[2].mock.mock_info.cell_deps[0].data).toBe("0x00");
    expect(unpackScenarios(file)).toEqual(scenarios);
    // The input is left alone.
    expect(scenarios[0].mock.mock_info.cell_deps[0].data).toBe(big);
  });

  it("refuses a file with a missing blob", () => {
    const file = packScenarios([scenario("a")], { recordedAt: "t", recordedWith: "w" });
    file.blobs = {};
    expect(() => unpackScenarios(file)).toThrow(/a: missing blob/);
  });
});

const run = (dbg: string, groups: [string, string, number?][], extra: Partial<Run> = {}): Run => ({
  scenario: "s",
  debugger: dbg,
  reported: dbg,
  scriptVersion: 2,
  groups: groups.map(([selector, cycles, result = 0]) => ({ selector, cycles, result })),
  ...extra,
});

describe("compareRun", () => {
  const ref = run("ref", [["input.0.lock", "100"], ["output.0.type", "50"]]);

  it("is the same when every group has the reference's cycles and result", () => {
    expect(compareRun(run("x", [["output.0.type", "50"], ["input.0.lock", "100"]]), ref)).toEqual({ verdict: "same", diffs: [] });
  });

  it("names each group whose cycles or result differ, or that is missing", () => {
    const r = compareRun(run("x", [["input.0.lock", "101", 5]]), ref);
    expect(r.verdict).toBe("differs");
    expect(r.diffs).toEqual(["input.0.lock: 101 cycles, reference 100", "input.0.lock: result 5, reference 0", "output.0.type: missing"]);
  });

  it("reports a build that could not run the scenario as failed", () => {
    expect(compareRun(run("x", [], { failure: "unknown flag --script" }), ref)).toEqual({ verdict: "failed", diffs: ["unknown flag --script"] });
  });

  it("does not call a build the same when the reference itself could not run the scenario", () => {
    const broken = run("ref", [], { failure: "panicked" });
    expect(compareRun(run("x", [["input.0.lock", "100"]]), broken)).toEqual({ verdict: "differs", diffs: ["reference could not run: panicked"] });
  });
});

describe("compareAll", () => {
  it("compares each run with the reference at the same VM version only", () => {
    const runs = [
      run("ref", [["input.0.lock", "100"]]),
      run("ref", [["input.0.lock", "90"]], { scriptVersion: 1 }),
      run("x", [["input.0.lock", "100"]]),
      run("y", [["input.0.lock", "90"]], { scriptVersion: 1 }),
    ];
    expect(compareAll(runs, "ref").map((c) => [c.debugger, c.scriptVersion, c.verdict])).toEqual([
      ["x", 2, "same"],
      ["y", 1, "same"],
    ]);
  });
});

describe("renderCompat", () => {
  const scenarios = [scenario("s", "0x", { nodeCycles: "150", names: { "input.0.lock": "secp" } })];
  const about = { ref: { reported: "ckb-debugger 1.1.1", origin: "release" } };

  it("folds builds that agree everywhere into one column and says there are no mismatches", () => {
    const runs = [run("ref", [["input.0.lock", "100"], ["output.0.type", "50"]]), run("x", [["input.0.lock", "100"], ["output.0.type", "50"]])];
    const md = renderCompat({ scenarios, runs, debuggers: ["ref", "x"], about, platform: "p", startedAt: "t" });
    expect(md).toContain("| s | input.0.lock secp | 2 | 100 | same |");
    expect(md).toContain("total (node: 150) | | 150 |");
    expect(md).toContain("Identical to the reference in every group: x.");
    expect(md).toContain("None: every build gave the reference's cycles");
  });

  it("marks a differing group and lists the mismatch", () => {
    const runs = [run("ref", [["input.0.lock", "100"], ["output.0.type", "50"]]), run("x", [["input.0.lock", "120"], ["output.0.type", "50"]])];
    const md = renderCompat({ scenarios, runs, debuggers: ["ref", "x"], about, platform: "p", startedAt: "t" });
    expect(md).toContain("| s | input.0.lock secp | 2 | 100 | ≠ 120 |");
    expect(md).toContain("- x, s, VM 2: differs. input.0.lock: 120 cycles, reference 100");
  });
});

describe("txFileName", () => {
  it("gives two scenario ids that slug alike their own files", () => {
    expect(txFileName("testtool/test_a-b")).not.toBe(txFileName("testtool/test-a_b"));
    expect(txFileName("mainnet/xudt")).toMatch(/^mainnet-xudt-[0-9a-f]{8}\.json$/);
  });
});

describe("shortFailure", () => {
  it("names the debugger's error when it panicked, and shortens anything else", () => {
    const panic = "unexpected ckb-debugger output (exit 101): thread 'main' panicked at src\main.rs:413:79: called `Result::unwrap()` on an `Err` value: InvalidVmVersion(1)";
    expect(shortFailure(panic)).toBe("debugger refused, InvalidVmVersion(1)");
    expect(shortFailure("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
  });
});

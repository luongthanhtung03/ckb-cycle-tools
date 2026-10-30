/**
 * Audit round 2 (30 Oct): can the gate give a wrong verdict? Each test states
 * what a correct tool must do, and fails today. Do not "fix" a test by
 * changing its expectation: fix src/ (or the Action), then the test passes.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { diffFailed, diffReports, formatMarkdown, summarize, type CycleReport, type GroupResult } from "../src/diff.js";
import type { MockTransaction } from "../src/mock.js";
import type { DebuggerOutput } from "../src/profile.js";
import { parseDebuggerRun } from "../src/replay.js";
import { runReport } from "../src/report.js";

const H = "0x" + "ab".repeat(32);
const group = (over: Partial<GroupResult> = {}): GroupResult => ({
  selector: "input.0.lock",
  role: "lock",
  script: "my-lock",
  codeHash: H,
  hashType: "data2",
  result: 0,
  cycles: 1_000_000,
  ...over,
});
const report = (scenarios: CycleReport["scenarios"], debuggerVersion = "ckb-debugger 1.1.1"): CycleReport => ({
  tool: "ckb-cycles",
  version: 1,
  debugger: debuggerVersion,
  scenarios,
});

describe("diff: a head that blows the cycle limit", () => {
  it("is recorded with 0 cycles, which the real ckb-debugger output leads to", () => {
    // ckb-debugger 1.1.1, verbatim, for a script that ran past --max-cycles (default 3,500,000,000).
    const run = parseDebuggerRun({ stdout: "Run result: cycles error: max cycles exceeded\n", stderr: "", exitCode: 254 });
    expect(run).toMatchObject({ result: -1, error: "cycles error: max cycles exceeded", cycles: 0n });
  });

  it("fails --fail-above (the costliest regression there is must not read as -100%)", () => {
    const base = report([{ name: "spend", groups: [group({ cycles: 1_000_000 })] }]);
    const head = report([{ name: "spend", groups: [group({ result: -1, error: "cycles error: max cycles exceeded", cycles: 0 })] }]);
    const options = { failAbove: 5 };
    const d = diffReports(base, head, options);
    expect(d.rows[0]).toMatchObject({ kind: "result", delta: -1_000_000 });
    // Today: overThreshold false, diffFailed false: the check is green.
    expect(diffFailed(d, options)).toBe(true);
  });
});

describe("diff: a base group with nothing to compare against in the head", () => {
  const base = report([
    { name: "spend", groups: [group({ cycles: 1_000_000 })] },
    { name: "overspend is rejected", groups: [group({ result: 12, cycles: 900_000 })] },
  ]);

  it("a renamed scenario does not pass --fail-above with 10x the cycles", () => {
    const head = report([
      { name: "spend (renamed)", groups: [group({ cycles: 10_000_000 })] },
      { name: "overspend is rejected", groups: [group({ result: 12, cycles: 900_000 })] },
    ]);
    const options = { failAbove: 5 };
    const d = diffReports(base, head, options);
    expect(d.rows.map((r) => r.kind).sort()).toEqual(["new", "removed", "same"]);
    expect(diffFailed(d, options)).toBe(true);
  });

  it("a removed scenario that used to reject does not pass --fail-on-result-change", () => {
    const head = report([{ name: "spend", groups: [group({ cycles: 1_000_000 })] }]);
    const options = { failOnResultChange: true };
    const d = diffReports(base, head, options);
    expect(d.rows.find((r) => r.scenario === "overspend is rejected")!.kind).toBe("removed");
    expect(diffFailed(d, options)).toBe(true);
  });

  it("a group whose selector moved (input.0 -> input.1) does not pass --fail-above with 10x the cycles", () => {
    const head = report([
      { name: "spend", groups: [group({ selector: "input.1.lock", cycles: 10_000_000 })] },
      { name: "overspend is rejected", groups: [group({ result: 12, cycles: 900_000 })] },
    ]);
    const options = { failAbove: 5 };
    expect(diffFailed(diffReports(base, head, options), options)).toBe(true);
  });
});

describe("diff: reports from different debuggers", () => {
  it("says the numbers come from different ckb-debugger versions", () => {
    const base = report([{ name: "spend", groups: [group()] }], "ckb-debugger 0.200.0");
    const head = report([{ name: "spend", groups: [group()] }], "ckb-debugger 1.1.1");
    const d = diffReports(base, head);
    expect(`${summarize(d)}\n${formatMarkdown(d)}`).toMatch(/0\.200\.0/);
  });
});

/**
 * A mock with one input whose lock runs, by data2 hash, the code in its one
 * cell dep; and a fake ckb-debugger whose cycles are 1,000 per byte of the
 * code the lock actually runs, so a bigger binary is a costlier one.
 */
const hex = (s: string) => ccc.hexFrom(new TextEncoder().encode(s));
function lockMock(code: string): MockTransaction {
  const data = hex(code);
  const prev = { tx_hash: "0x" + "11".repeat(32), index: "0x0" };
  const lock = { code_hash: ccc.hashCkb(data), hash_type: "data2", args: "0x" };
  return {
    mock_info: {
      inputs: [{ input: { since: "0x0", previous_output: prev }, output: { capacity: "0x0", lock, type: null }, data: "0x", header: null }],
      cell_deps: [
        {
          cell_dep: { out_point: { tx_hash: "0x" + "22".repeat(32), index: "0x0" }, dep_type: "code" },
          output: { capacity: "0x0", lock: { code_hash: "0x" + "00".repeat(32), hash_type: "data", args: "0x" }, type: null },
          data,
          header: null,
        },
      ],
      header_deps: [],
    },
    tx: {
      version: "0x0",
      cell_deps: [{ out_point: { tx_hash: "0x" + "22".repeat(32), index: "0x0" }, dep_type: "code" }],
      header_deps: [],
      inputs: [{ since: "0x0", previous_output: prev }],
      outputs: [],
      outputs_data: [],
      witnesses: [],
    },
  } as unknown as MockTransaction;
}
const fakeDebugger = async (args: string[]): Promise<DebuggerOutput> => {
  if (args[0] === "--version") return { stdout: "ckb-debugger 1.1.1\n", stderr: "", exitCode: 0 };
  const mock = JSON.parse(readFileSync(args[args.indexOf("--tx-file") + 1], "utf8")) as MockTransaction;
  const index = Number(/^input\.(\d+)\.lock$/.exec(args[args.indexOf("--script") + 1])![1]);
  const want = mock.mock_info.inputs[index].output.lock.code_hash;
  const dep = mock.mock_info.cell_deps.find((d) => ccc.hashCkb(d.data) === want)!;
  const cycles = ((dep.data.length - 2) / 2) * 1000;
  return { stdout: `Run result: 0\nAll cycles: ${cycles}(x)\n`, stderr: "", exitCode: 0 };
};

/** A repository with mocks and a cycles.json, and a base checkout beside it: what the Action runs on. */
function checkouts(files: { head: Record<string, string>; base: Record<string, string> }) {
  const root = mkdtempSync(join(tmpdir(), "ckb-verdict-"));
  for (const side of ["head", "base"] as const) {
    for (const [path, content] of Object.entries(files[side])) {
      mkdirSync(join(root, side, path, ".."), { recursive: true });
      writeFileSync(join(root, side, path), content);
    }
  }
  return { head: join(root, "head"), base: join(root, "base") };
}
/** The Action's two report runs and its diff (action.yml: "Report the head", "Report the base", "Diff"). */
async function actionVerdict(dirs: { head: string; base: string }, failAbove = 5) {
  const strip = ({ errors: _, notices: __, ...r }: Awaited<ReturnType<typeof runReport>>) => JSON.parse(JSON.stringify(r)) as CycleReport;
  const config = join(dirs.head, "cycles.json");
  const head = strip(await runReport(config, { roots: [dirs.head], runDebugger: fakeDebugger }));
  const base = strip(await runReport(config, { binariesRoot: dirs.base, roots: [dirs.head, dirs.base], runDebugger: fakeDebugger }));
  const d = diffReports(base, head, { failAbove });
  return { head, base, diff: d, failed: diffFailed(d, { failAbove }) };
}

const OLD = "lock v1 ";             // 8 bytes: 8,000 cycles
const GROWN = "lock v2 ".repeat(10); // 80 bytes: 80,000 cycles, a 10x regression

describe("Action: adding one new contract to the PR", () => {
  it("does not switch the gate off for every scenario of the contracts that already existed", async () => {
    // A scan-made cycles.json: no scenario lists its binaries, so every binary is offered to every scenario.
    const config = JSON.stringify({
      binaries: {
        lock: { path: "build/lock", codeHash: ccc.hashCkb(hex(OLD)) },
        "new-contract": { path: "build/new-contract", codeHash: "0x" + "33".repeat(32) },
      },
      scenarios: [{ name: "spend", mock: "mocks/spend.json" }],
    });
    const mock = JSON.stringify(lockMock(OLD));
    const v = await actionVerdict(
      checkouts({
        head: { "cycles.json": config, "mocks/spend.json": mock, "build/lock": GROWN, "build/new-contract": "new" },
        base: { "build/lock": OLD }, // the base has no new-contract: it is what the PR adds
      }),
    );
    expect(v.head.scenarios[0].groups[0].cycles).toBe(80_000);
    // Today the whole base scenario is "binaryMissing", its groups are "new", and nothing is compared.
    expect(v.base.scenarios[0]).toMatchObject({ binaryMissing: true });
    expect(v.failed).toBe(true);
  });

  it("(the same with the lock's build path renamed in the PR) does not pass a 10x regression", async () => {
    const config = JSON.stringify({
      binaries: { lock: { path: "build/renamed/lock", codeHash: ccc.hashCkb(hex(OLD)) } },
      scenarios: [{ name: "spend", mock: "mocks/spend.json" }],
    });
    const v = await actionVerdict(
      checkouts({
        head: { "cycles.json": config, "mocks/spend.json": JSON.stringify(lockMock(OLD)), "build/renamed/lock": GROWN },
        base: { "build/lock": OLD },
      }),
    );
    expect(v.failed).toBe(true);
  });
});

describe("Action: a binary that matches no cell dep of a scenario", () => {
  it("(stale mock in one scenario) is not measured as the mock's old code on both sides and called unchanged", async () => {
    // Scenario "fresh" was re-dumped against the current build; "stale" still holds an older build's bytes.
    const STALE = "lock v0 ";
    const config = JSON.stringify({
      binaries: { lock: { path: "build/lock", codeHash: ccc.hashCkb(hex(OLD)) } },
      scenarios: [
        { name: "fresh", mock: "mocks/fresh.json" },
        { name: "stale", mock: "mocks/stale.json" },
      ],
    });
    const v = await actionVerdict(
      checkouts({
        head: {
          "cycles.json": config,
          "mocks/fresh.json": JSON.stringify(lockMock(OLD)),
          "mocks/stale.json": JSON.stringify(lockMock(STALE)),
          "build/lock": GROWN,
        },
        base: { "build/lock": OLD },
      }),
    );
    const stale = v.diff.rows.find((r) => r.scenario === "stale")!;
    // Neither side ran build/lock: both ran the 8 bytes inside the mock.
    expect(stale).toMatchObject({ kind: "same", base: { cycles: 8_000 }, head: { cycles: 8_000 } });
    // Nothing says so: no warning on the scenario, nothing in the comment.
    expect(v.head.scenarios.find((s) => s.name === "stale")!.warnings ?? []).not.toEqual([]);
  });

  it("(codeHash stale in every scenario) does not pass: the report's error never reaches the JSON or the diff", async () => {
    const config = JSON.stringify({
      binaries: { lock: { path: "build/lock", codeHash: "0x" + "44".repeat(32) } },
      scenarios: [{ name: "spend", mock: "mocks/spend.json" }],
    });
    const dirs = checkouts({
      head: { "cycles.json": config, "mocks/spend.json": JSON.stringify(lockMock(OLD)), "build/lock": GROWN },
      base: { "build/lock": OLD },
    });
    const r = await runReport(join(dirs.head, "cycles.json"), { roots: [dirs.head], runDebugger: fakeDebugger });
    expect(r.errors).toEqual([expect.stringMatching(/matched no cell dep/)]);
    const v = await actionVerdict(dirs);
    expect(formatMarkdown(v.diff)).toMatch(/No script group changed/);
    expect(v.failed).toBe(true);
  });
});

describe("Action: the base report uses the PR's cycles.json", () => {
  it("so a scenario the PR deletes from cycles.json is still compared (or at least listed)", () => {
    const yml = readFileSync("action/action.yml", "utf8");
    const baseStep = yml.slice(yml.indexOf("- name: Report the base"), yml.indexOf("- name: Diff"));
    // Today: `report "$CONFIG"` (the head's file) with only --binaries-from pointing at the base.
    // The base commit's own cycles.json is never read, so its scenarios cannot show up as "removed".
    expect(baseStep).toMatch(/\$out\/base\/\$CONFIG|base\/"\$CONFIG"|\$out\/base\/"\$CONFIG"/);
  });
});

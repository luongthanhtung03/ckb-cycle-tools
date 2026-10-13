import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  diffFailed,
  diffReports,
  formatMarkdown,
  formatText,
  type CycleReport,
  type GroupResult,
} from "../src/diff.js";

const g = (selector: string, cycles: number, result = 0, script = "my-lock"): GroupResult => ({
  selector,
  role: selector.endsWith("lock") ? "lock" : "type",
  script,
  codeHash: "0x" + "1".repeat(64),
  hashType: "type",
  result,
  cycles,
});
const report = (...scenarios: CycleReport["scenarios"]): CycleReport => ({ tool: "ckb-cycles", version: 1, scenarios });

const base = report(
  { name: "transfer", groups: [g("input.0.lock", 1_000_000), g("input.1.lock", 1_600_000, 0, "Secp256k1Blake160")] },
  { name: "overspend", groups: [g("input.0.lock", 12_893, 12)] },
  { name: "mint", groups: [g("output.0.type", 50_000)] },
);

describe("diffReports", () => {
  it("matches groups by scenario and selector, and computes Δ and Δ%", () => {
    const head = report(
      { name: "transfer", groups: [g("input.0.lock", 1_100_000), g("input.1.lock", 1_600_000, 0, "Secp256k1Blake160")] },
      { name: "overspend", groups: [g("input.0.lock", 12_000, 12)] },
      { name: "mint", groups: [g("output.0.type", 50_000)] },
    );
    const d = diffReports(base, head);
    const row = (s: string, sel: string) => d.rows.find((r) => r.scenario === s && r.group === sel)!;
    expect(row("transfer", "input.0.lock")).toMatchObject({ kind: "changed", delta: 100_000, percent: 10 });
    expect(row("transfer", "input.1.lock")).toMatchObject({ kind: "same", delta: 0 });
    expect(row("overspend", "input.0.lock")).toMatchObject({ kind: "changed", delta: -893 });
    expect(d.resultChanges).toBe(0);
  });

  it("flags a result change, in both directions, ahead of any cycle count", () => {
    const head = report(
      { name: "transfer", groups: [g("input.0.lock", 1_000_000, 5), g("input.1.lock", 1_600_000, 0, "Secp256k1Blake160")] },
      { name: "overspend", groups: [g("input.0.lock", 12_893, 0)] },
      { name: "mint", groups: [{ ...g("output.0.type", 50_000), result: -1, error: "invalid instruction" }] },
    );
    const d = diffReports(base, head);
    expect(d.resultChanges).toBe(3);
    expect(d.rows.filter((r) => r.kind === "result").map((r) => `${r.base!.result} → ${r.head!.result}`)).toEqual([
      "ok → exit 5",
      "exit 12 → ok",
      "ok → error",
    ]);
    expect(diffFailed(d)).toBe(false);
    expect(diffFailed(d, { failOnResultChange: true })).toBe(true);
  });

  it("fails above the threshold only for an increase past it", () => {
    const head = report(
      { name: "transfer", groups: [g("input.0.lock", 1_050_000), g("input.1.lock", 1_000_000, 0, "Secp256k1Blake160")] },
      { name: "overspend", groups: [g("input.0.lock", 12_893, 12)] },
      { name: "mint", groups: [g("output.0.type", 50_000)] },
    );
    expect(diffFailed(diffReports(base, head, { failAbove: 5 }), { failAbove: 5 })).toBe(false); // exactly 5%: not above
    const d = diffReports(base, head, { failAbove: 4.9 });
    expect(d.overThreshold).toBe(1);
    expect(diffFailed(d, { failAbove: 4.9 })).toBe(true);
    // A 37.5% decrease is never a regression.
    expect(d.rows.find((r) => r.group === "input.1.lock")).toMatchObject({ overThreshold: false });
  });

  it("treats growth from zero as over any threshold", () => {
    const d = diffReports(report({ name: "a", groups: [g("input.0.lock", 0)] }), report({ name: "a", groups: [g("input.0.lock", 10)] }), {
      failAbove: 50,
    });
    expect(d.rows[0].percent).toBeUndefined();
    expect(d.rows[0].overThreshold).toBe(true);
  });

  it("shows new and removed groups and scenarios", () => {
    const head = report(
      { name: "transfer", groups: [g("input.0.lock", 1_000_000)] },
      { name: "overspend", groups: [g("input.0.lock", 12_893, 12), g("output.0.type", 7)] },
      { name: "brand new", groups: [g("input.0.lock", 1)] },
    );
    const kinds = diffReports(base, head).rows.map((r) => `${r.scenario}/${r.group}:${r.kind}`);
    expect(kinds).toEqual([
      "transfer/input.0.lock:same",
      "transfer/input.1.lock:removed",
      "overspend/input.0.lock:same",
      "overspend/output.0.type:new",
      "brand new/input.0.lock:new",
      "mint/output.0.type:removed",
    ]);
  });

  it("reports a head scenario that failed to run, and fails on it", () => {
    const head = report({ name: "transfer", error: "cell not found", groups: [] });
    const d = diffReports(base, head);
    expect(d.rows[0]).toMatchObject({ kind: "error", note: "head: cell not found" });
    expect(diffFailed(d)).toBe(true);
  });

  it("counts every group as new when the base could not run the scenario", () => {
    const d = diffReports(
      report({ name: "transfer", error: "ENOENT", groups: [] }),
      report({ name: "transfer", groups: [g("input.0.lock", 5)] }),
    );
    expect(d.rows.map((r) => r.kind)).toEqual(["new"]);
    expect(diffFailed(d)).toBe(false);
  });
});

describe("formatMarkdown", () => {
  const head = report(
    { name: "transfer", groups: [g("input.0.lock", 1_200_000), g("input.1.lock", 1_600_000, 0, "Secp256k1Blake160")] },
    { name: "overspend", groups: [g("input.0.lock", 12_893, 0)] },
    { name: "mint", groups: [g("output.0.type", 50_000)] },
  );
  const text = formatMarkdown(diffReports(base, head, { failAbove: 5 }), { baseLabel: "abc1234", headLabel: "def5678" });

  it("starts with the sticky-comment marker and a summary", () => {
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text).toContain(
      "1 result change, 1 over the 5% threshold, 2 of 4 script groups changed (`abc1234` → `def5678`).",
    );
  });

  it("puts the result change first, then the regression, with their markers", () => {
    const lines = text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Scenario"));
    expect(lines[0]).toBe("| overspend | `input.0.lock` | my-lock | 12,893 (exit 12) | 12,893 | 0 | 0% | **RESULT CHANGED: exit 12 → ok** |");
    expect(lines[1]).toBe("| transfer | `input.0.lock` | my-lock | 1,000,000 | 1,200,000 | +200,000 | +20.00% | **over 5%** |");
  });

  it("folds unchanged groups away", () => {
    expect(text).toContain("<details><summary>2 unchanged groups</summary>");
    expect(text).toContain("| mint | `output.0.type` | my-lock | 50,000 | ok |");
  });

  it("escapes names that would break the table", () => {
    const d = diffReports(report(), report({ name: "a | b", groups: [g("input.0.lock", 1, 0, "x|y")] }));
    expect(formatMarkdown(d)).toContain("| a \\| b | `input.0.lock` | x\\|y |");
  });

  it("says so when nothing changed", () => {
    expect(formatMarkdown(diffReports(base, base))).toContain("No script group changed its cycles or its result.");
  });
});

describe("formatText", () => {
  it("aligns a terminal table with the same markers", () => {
    const head = report({ name: "overspend", groups: [g("input.0.lock", 13_000, 0)] });
    const out = formatText(diffReports(report(base.scenarios[1]), head));
    expect(out.split("\n")).toEqual([
      "1 result change, 1 of 1 script group changed",
      "",
      "SCENARIO   GROUP         SCRIPT               BASE    HEAD     Δ      Δ%",
      "overspend  input.0.lock  my-lock  12,893 (exit 12)  13,000  +107  +0.83%  RESULT CHANGED: exit 12 → ok",
    ]);
  });
});

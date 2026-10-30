import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  diffFailed,
  diffReports,
  formatMarkdown,
  formatText,
  FUNCTION_LIMIT,
  FUNCTIONS_SHOWN,
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

  // Found in hardening review: a base that could not run made every head group
  // "new", rejections included, and the gate passed with nothing compared.
  it("reports a scenario the base could not run, and fails a gated check on it", () => {
    const d = diffReports(
      report({ name: "spend", error: 'binary "x": cannot read', groups: [] }),
      report({ name: "spend", groups: [g("input.0.lock", 100_000_000)] }),
    );
    expect(d.rows.map((r) => r.kind)).toEqual(["base-error", "new"]);
    expect(d.baseErrors).toBe(1);
    expect(formatText(d)).toContain('NOT COMPARED: base: binary "x": cannot read');
    expect(formatText(d).split("\n")[0]).toContain("1 scenario could not run on the base");
    expect(diffFailed(d)).toBe(false);
    expect(diffFailed(d, { failOnResultChange: true })).toBe(true);
    expect(diffFailed(d, { failAbove: 5 })).toBe(true);
  });

  it("counts the groups as new when the scenario's binary does not exist on the base yet", () => {
    const d = diffReports(
      report({ name: "spend", error: "ENOENT", binaryMissing: true, groups: [] }),
      report({ name: "spend", groups: [g("input.0.lock", 5)] }),
    );
    expect(d.rows.map((r) => r.kind)).toEqual(["new"]);
    expect(diffFailed(d, { failOnResultChange: true, failAbove: 5 })).toBe(false);
  });

  // Found in hardening review: a new group never failed the check, even when it rejected.
  it("counts a new group that does not accept as a result change", () => {
    const d = diffReports(
      report({ name: "a", groups: [g("input.0.lock", 1_000)] }),
      report({ name: "a", groups: [g("input.0.lock", 1_000), g("output.0.type", 900_000_000, 5)] }),
      { failAbove: 5 },
    );
    expect(d.rows[1]).toMatchObject({ kind: "result", group: "output.0.type", overThreshold: false });
    expect(d.resultChanges).toBe(1);
    expect(diffFailed(d, { failOnResultChange: true })).toBe(true);
    const text = formatText(d);
    expect(text).toContain("NEW, DOES NOT ACCEPT: exit 5");
    // No base, so no percentage: the output says the threshold did not apply to it.
    expect(text.split("\n")[0]).toContain("1 new group not checked against the 5% threshold (no base to compare with)");
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

  // GitHub links @mentions and #refs after rendering: only a zero-width space stops them.
  const ZWSP = String.fromCharCode(0x200b);
  it("neutralises mentions, refs and formatting in names and the title", () => {
    const d = diffReports(report(), report({ name: "@luongthanhtung03 ~~struck~~ #1 &lt;b&gt;", groups: [g("input.0.lock", 1)] }));
    const text = formatMarkdown(d, { title: "x\n\n<!-- ckb-cycles-report -->\n# injected @team" });
    expect(text).toContain(`| @${ZWSP}luongthanhtung03 \\~\\~struck\\~\\~ #${ZWSP}1 \\&lt;b\\&gt; |`);
    expect(text.split("\n")[1]).toBe(`### x \\<\\!-- ckb-cycles-report --\\> # injected @${ZWSP}team`);
    expect(text.split(COMMENT_MARKER)).toHaveLength(2);
  });

  // Security review, 27 Oct: what a PR's cycles.json can put in the bot's comment.
  it("breaks bare links, and drops bidi overrides and control characters", () => {
    const d = diffReports(report(), report({ name: "see https://evil.example and www.evil.example ‮abc\u0007", groups: [g("input.0.lock", 1)] }));
    const text = formatMarkdown(d);
    expect(text).toContain(`see https:${ZWSP}//evil.example and www${ZWSP}.evil.example abc |`);
    expect(text).not.toMatch(/[‮\u0007]/);
  });

  it("puts a selector or label that is not plain in <code>, where a backtick cannot end it", () => {
    const d = diffReports(report(), report({ name: "s", groups: [g("input.0.lock`|**x**", 1)] }));
    const text = formatMarkdown(d, { baseLabel: "abc`d", headLabel: "def5678" });
    expect(text).toContain("| s | <code>input.0.lock\\`\\|\\*\\*x\\*\\*</code> |");
    expect(text).toContain("(<code>abc\\`d</code> → `def5678`)");
  });

  it("stays under GitHub's comment limit whatever the names, keeping the rows that matter", () => {
    const long = "n".repeat(50_000);
    // Long names are clipped on every row.
    const one = formatMarkdown(diffReports(report(), report({ name: long, groups: [g("input.0.lock", 1, 0, long)] })));
    expect(one.length).toBeLessThan(2_000);
    // Thousands of rows: the unchanged ones go first, then the last changed rows.
    const many = (cycles: number) =>
      report(...Array.from({ length: 3_000 }, (_, i) => ({ name: `${"s".repeat(250)}${i}`, groups: [g("input.0.lock", i < 2_000 ? 1 : cycles)] })));
    const flipped = report(...many(1).scenarios.map((s, i) => (i === 2_999 ? { ...s, groups: [g("input.0.lock", 1, 12)] } : s)));
    const text = formatMarkdown(diffReports(many(1), { ...flipped, scenarios: flipped.scenarios.map((s, i) => (i < 2_000 ? s : { ...s, groups: [{ ...s.groups[0], cycles: s.groups[0].cycles + 1 }] })) }));
    expect(text.length).toBeLessThan(65_536);
    expect(text).toContain("unchanged groups left out");
    expect(text).toMatch(/\d+ more changed rows left out/);
    // The result change sorts first, so it survives the cut.
    expect(text).toContain("RESULT CHANGED: ok → exit 12");
    expect(text.trimEnd().endsWith("one run per script group.</sub>")).toBe(true);
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

describe("functions", () => {
  const f = (name: string, self: number, total = self) => ({ name, self, total });
  const fg = (cycles: number, functions?: ReturnType<typeof f>[], extra: Partial<GroupResult> = {}): GroupResult => ({
    ...g("input.0.lock", cycles),
    ...(functions && { functions }),
    ...extra,
  });
  const full = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => f(`${prefix}${i}`, 100 - i));

  it("lists the functions whose self cycles changed, largest change first", () => {
    const d = diffReports(
      report({ name: "charge", groups: [fg(20_000, [f("lock_hash", 4_490), f("memcpy", 3_145), f("main", 2_545), f("gone", 10)])] }),
      report({ name: "charge", groups: [fg(21_600, [f("lock_hash", 5_972), f("memcpy", 3_125), f("main", 2_545), f("new_fn", 50)])] }),
    );
    expect(d.rows[0].functions).toEqual([
      { name: "lock_hash", base: 4_490, head: 5_972, delta: 1_482 },
      { name: "new_fn", base: 0, head: 50, delta: 50 },
      { name: "memcpy", base: 3_145, head: 3_125, delta: -20 },
      { name: "gone", base: 10, head: 0, delta: -10 },
    ]);
  });

  it("does not guess a side cut at the limit, nor one without functions", () => {
    const head = full("h", FUNCTION_LIMIT);
    const cut = diffReports(
      report({ name: "s", groups: [fg(1, full("b", FUNCTION_LIMIT))] }),
      report({ name: "s", groups: [fg(2, head)] }),
    ).rows[0].functions!;
    // Neither name is in the other full list: either may be just below its cut.
    expect(cut.find((x) => x.name === "h0")).toEqual({ name: "h0", head: 100 });
    expect(cut.find((x) => x.name === "b0")).toEqual({ name: "b0", base: 100 });
    // A base report from before functions existed: every base is unknown.
    const old = diffReports(report({ name: "s", groups: [fg(1)] }), report({ name: "s", groups: [fg(2, [f("a", 5)])] }));
    expect(old.rows[0]).toMatchObject({ kind: "changed", delta: 1, functions: [{ name: "a", head: 5 }] });
  });

  // Review, 27 Oct: GitHub refuses comments over 65,536 characters.
  it("clips long names, and leaves function blocks out when the comment would not fit", () => {
    const long = "x".repeat(5_000);
    const one = diffReports(report({ name: "s", groups: [fg(1, [f(long, 1)])] }), report({ name: "s", groups: [fg(2, [f(long, 9)])] }));
    const text = formatMarkdown(one);
    expect(text).toContain(`${"x".repeat(119)}…`);
    expect(text).not.toContain("x".repeat(121));
    const many = Array.from({ length: 600 }, (_, i) => ({ name: `scenario ${i}`, groups: [fg(i + 1, [f("y".repeat(150) + i, i)])] }));
    const big = diffReports(report(...many.map((m) => ({ ...m, groups: [fg(1, [f(m.groups[0].functions![0].name, 0)])] }))), report(...many));
    const out = formatMarkdown(big);
    expect(out.length).toBeLessThan(65_536);
    expect(out).toContain("Function details left out");
  });

  it("keeps a base with functions and a head without them as a plain diff", () => {
    const d = diffReports(report({ name: "s", groups: [fg(1, [f("a", 5)])] }), report({ name: "s", groups: [fg(2)] }));
    expect(d.rows[0]).not.toHaveProperty("functions");
    expect(formatMarkdown(d)).not.toContain("Functions in");
  });

  it("folds the changed functions under the table, after the rows and before the unchanged groups", () => {
    const fns = Array.from({ length: 12 }, (_, i) => f(`session_lock::f${i}<[u8; 32]>`, 100 + i));
    const d = diffReports(
      report(
        { name: "charge #1", groups: [fg(20_000, fns.map((x) => ({ ...x, self: 100 })))] },
        { name: "idle", groups: [g("input.0.lock", 5)] },
      ),
      report({ name: "charge #1", groups: [fg(21_000, fns)] }, { name: "idle", groups: [g("input.0.lock", 5)] }),
    );
    const text = formatMarkdown(d);
    const lines = text.split("\n");
    const start = lines.indexOf(
      "<details><summary>Functions in charge #\u200b1 · <code>input.0.lock</code> (my-lock): 11 functions changed</summary>",
    );
    expect(start).toBeGreaterThan(lines.findIndex((l) => l.startsWith("| charge")));
    expect(start).toBeLessThan(lines.findIndex((l) => l.includes("1 unchanged group")));
    expect(lines.slice(start + 2, start + 5)).toEqual([
      "| Function | Base self | Head self | Δ |",
      "|---|---:|---:|---:|",
      "| session\\_lock::f11\\<\\[u8; 32\\]\\> | 100 | 111 | +11 |",
    ]);
    // Ten shown, the rest counted.
    expect(lines.filter((l) => l.startsWith("| session"))).toHaveLength(FUNCTIONS_SHOWN);
    expect(lines).toContain("and 1 more.");
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text.split(COMMENT_MARKER)).toHaveLength(2);
  });

  it("says why a group recorded no functions", () => {
    const warning = "the symbols build costs 21,100 cycles, the binary 21,000: not the same code";
    const d = diffReports(report({ name: "s", groups: [fg(1)] }), report({ name: "s", groups: [fg(2, undefined, { functionsWarning: warning })] }));
    const lines = formatMarkdown(d).split("\n");
    expect(lines).toContain("<details><summary>Functions in s · <code>input.0.lock</code> (my-lock): not recorded</summary>");
    expect(formatText(d).split("\n").at(-1)).toBe(`functions in s input.0.lock not recorded: ${warning}`);
  });

  it("adds one compact line per group to the terminal table", () => {
    const d = diffReports(
      report({ name: "s", groups: [fg(1, [f("a", 5), f("b", 7)])] }),
      report({ name: "s", groups: [fg(2, [f("a", 9), f("b", 7), f("c", 1)])] }),
    );
    const out = formatText(d).split("\n");
    expect(out.slice(-2)).toEqual(["", "functions in s input.0.lock: a +4, c +1"]);
  });
});

describe("formatText: names in a terminal or CI log", () => {
  it("keeps every name on one line, without controls, and never at a line start as ::", () => {
    const evil = "::add-mask::x\n::error::forged\u001b[2J";
    const r = report({ name: evil, groups: [g("input.0.lock", 10, 0, "\n::warning::s")] });
    const out = formatText(diffReports(r, r));
    expect(out.split("\n").some((l) => l.trimStart().startsWith("::"))).toBe(false);
    expect(out).not.toMatch(/\u001b/);
  });
});

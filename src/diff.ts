/**
 * Compares two cycle reports — the base of a pull request and its head — group
 * by group, and formats the result for a terminal or a PR comment.
 *
 * Pure: no network, no file system.
 */

/** What `ckb-cycles report` writes. */
export interface CycleReport {
  tool: "ckb-cycles";
  version: 1;
  /** ckb-debugger's `--version`, so two reports can be checked for comparability. */
  debugger?: string;
  scenarios: ScenarioResult[];
}

export interface ScenarioResult {
  name: string;
  /** Set when the scenario could not be run at all (a missing file, a node that is down). */
  error?: string;
  groups: GroupResult[];
  /** Warnings from binary substitution, kept so a reader can tell why a result changed. */
  warnings?: string[];
}

export interface GroupResult {
  /** ckb-debugger's selector, e.g. `input.0.lock`: the key a group is matched by across reports. */
  selector: string;
  role: "lock" | "type";
  /** A name for the script, or its short code hash. */
  script: string;
  codeHash: string;
  hashType: string;
  /** The script's exit code: 0 accepts. -1 with `error` when the VM stopped it. */
  result: number;
  error?: string;
  cycles: number;
}

export type RowKind = "same" | "changed" | "result" | "new" | "removed" | "error";

export interface DiffRow {
  scenario: string;
  /** The group's selector, or "" for a row about the whole scenario. */
  group: string;
  script: string;
  base?: { result: string; cycles?: number };
  head?: { result: string; cycles?: number };
  delta?: number;
  /** Percentage change; undefined when the base cost nothing. */
  percent?: number;
  kind: RowKind;
  /** The increase is over the threshold. */
  overThreshold: boolean;
  /** Free text for an error row. */
  note?: string;
}

export interface CycleDiff {
  rows: DiffRow[];
  /** Groups whose accept/reject outcome changed (ok → exit 12, exit 12 → ok, exit 12 → exit 13). */
  resultChanges: number;
  /** Groups whose cycles grew by more than the threshold. */
  overThreshold: number;
  threshold?: number;
}

export interface DiffOptions {
  /** Percent. An increase above it is flagged, and makes `failed` true. */
  failAbove?: number;
  /** A changed outcome makes `failed` true. */
  failOnResultChange?: boolean;
}

/** `ok`, `exit 12`, or `error` (the VM stopped the script). */
export function resultLabel(g: Pick<GroupResult, "result" | "error">): string {
  return g.error ? "error" : g.result === 0 ? "ok" : `exit ${g.result}`;
}

export function diffReports(base: CycleReport, head: CycleReport, options: DiffOptions = {}): CycleDiff {
  const threshold = options.failAbove;
  const rows: DiffRow[] = [];
  const baseByName = new Map(base.scenarios.map((s) => [s.name, s]));
  const headNames = new Set(head.scenarios.map((s) => s.name));

  const scenarioRows = (h: ScenarioResult | undefined, b: ScenarioResult | undefined) => {
    const name = (h ?? b)!.name;
    if (h?.error) {
      rows.push({ scenario: name, group: "", script: "", kind: "error", overThreshold: false, note: `head: ${h.error}` });
      return;
    }
    // A base that could not run the scenario (usually: the base does not have
    // its files yet) has nothing to compare against, so every group is new.
    const baseGroups = new Map((b && !b.error ? b.groups : []).map((g) => [g.selector, g]));
    for (const g of h?.groups ?? []) {
      rows.push(groupRow(name, baseGroups.get(g.selector), g, threshold));
      baseGroups.delete(g.selector);
    }
    for (const g of baseGroups.values()) rows.push(groupRow(name, g, undefined, threshold));
  };

  for (const h of head.scenarios) scenarioRows(h, baseByName.get(h.name));
  for (const b of base.scenarios) if (!headNames.has(b.name)) scenarioRows(undefined, b);

  return {
    rows,
    resultChanges: rows.filter((r) => r.kind === "result").length,
    overThreshold: rows.filter((r) => r.overThreshold).length,
    ...(threshold !== undefined && { threshold }),
  };
}

function groupRow(scenario: string, b: GroupResult | undefined, h: GroupResult | undefined, threshold?: number): DiffRow {
  const side = (g: GroupResult) => ({ result: resultLabel(g), cycles: g.cycles });
  const row: DiffRow = {
    scenario,
    group: (h ?? b)!.selector,
    script: (h ?? b)!.script,
    ...(b && { base: side(b) }),
    ...(h && { head: side(h) }),
    kind: !b ? "new" : !h ? "removed" : "same",
    overThreshold: false,
  };
  if (b && h) {
    row.delta = h.cycles - b.cycles;
    if (b.cycles > 0) row.percent = (row.delta / b.cycles) * 100;
    row.kind = resultLabel(b) !== resultLabel(h) ? "result" : row.delta !== 0 ? "changed" : "same";
    row.overThreshold =
      threshold !== undefined && row.delta > 0 && (row.percent === undefined || row.percent > threshold);
  }
  return row;
}

/** Whether the diff should fail a check, per the options it was made with. */
export function diffFailed(diff: CycleDiff, options: DiffOptions = {}): boolean {
  return (
    (options.failAbove !== undefined && diff.overThreshold > 0) ||
    (options.failOnResultChange === true && diff.resultChanges > 0) ||
    diff.rows.some((r) => r.kind === "error")
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : "0");
const pct = (p: number | undefined) =>
  p === undefined ? "" : p === 0 ? "0%" : `${p > 0 ? "+" : "-"}${Math.abs(p) < 0.01 ? "<0.01" : Math.abs(p).toFixed(2)}%`;
const cell = (s: { result: string; cycles?: number } | undefined) =>
  !s ? "—" : s.result === "ok" ? fmt(s.cycles ?? 0) : `${fmt(s.cycles ?? 0)} (${s.result})`;

function note(r: DiffRow, threshold?: number): string {
  switch (r.kind) {
    case "result":
      return `RESULT CHANGED: ${r.base!.result} → ${r.head!.result}`;
    case "new":
      return "new";
    case "removed":
      return "removed";
    case "error":
      return r.note ?? "error";
    default:
      return r.overThreshold ? `over ${threshold}%` : "";
  }
}

/** One line saying what matters, for the top of a comment or terminal output. */
export function summarize(diff: CycleDiff): string {
  const groups = diff.rows.filter((r) => r.kind !== "error");
  const changed = groups.filter((r) => r.kind !== "same").length;
  const errors = diff.rows.length - groups.length;
  const parts = [
    ...(diff.resultChanges ? [`${diff.resultChanges} result change${diff.resultChanges > 1 ? "s" : ""}`] : []),
    ...(diff.overThreshold ? [`${diff.overThreshold} over the ${diff.threshold}% threshold`] : []),
    ...(errors ? [`${errors} scenario${errors > 1 ? "s" : ""} failed to run`] : []),
    `${changed} of ${groups.length} script group${groups.length === 1 ? "" : "s"} changed`,
  ];
  return parts.join(", ");
}

const MD_ESCAPE = /[|\\`*_<>[\]]/g;
const md = (s: string) => s.replace(/[\r\n]+/g, " ").replace(MD_ESCAPE, (c) => `\\${c}`);

/** The hidden marker that identifies the sticky comment, so it is updated instead of duplicated. */
export const COMMENT_MARKER = "<!-- ckb-cycles-report -->";

export interface MarkdownOptions {
  title?: string;
  /** e.g. a short commit hash, shown in the header line. */
  baseLabel?: string;
  headLabel?: string;
}

/**
 * A markdown comment: what changed in a table, unchanged groups folded away.
 * Result changes come first, since an accept turning into a reject (or the
 * reverse) matters more than any cycle count.
 */
export function formatMarkdown(diff: CycleDiff, options: MarkdownOptions = {}): string {
  const order: Record<RowKind, number> = { error: 0, result: 1, changed: 2, new: 3, removed: 4, same: 5 };
  const rank = (r: DiffRow) => order[r.kind] - (r.overThreshold ? 0.5 : 0);
  const rows = [...diff.rows].sort((a, b) => rank(a) - rank(b));
  const shown = rows.filter((r) => r.kind !== "same");
  const same = rows.filter((r) => r.kind === "same");

  const head = "| Scenario | Group | Script | Base | Head | Δ | Δ% | |\n|---|---|---|---:|---:|---:|---:|---|";
  const line = (r: DiffRow) => {
    const flag = note(r, diff.threshold);
    const strong = r.kind === "result" || r.kind === "error" || r.overThreshold;
    return (
      `| ${md(r.scenario)} | ${r.group ? `\`${r.group}\`` : ""} | ${md(r.script)} | ${cell(r.base)} | ${cell(r.head)}` +
      ` | ${r.delta === undefined ? "" : signed(r.delta)} | ${pct(r.percent)} | ${flag ? (strong ? `**${md(flag)}**` : md(flag)) : ""} |`
    );
  };

  const vs = options.baseLabel && options.headLabel ? ` (\`${md(options.baseLabel)}\` → \`${md(options.headLabel)}\`)` : "";
  const out = [COMMENT_MARKER, `### ${options.title ?? "Cycle report"}`, "", `${summarize(diff)}${vs}.`, ""];
  if (shown.length) out.push(head, ...shown.map(line), "");
  else out.push("No script group changed its cycles or its result.", "");
  if (same.length) {
    out.push(
      `<details><summary>${same.length} unchanged group${same.length === 1 ? "" : "s"}</summary>`,
      "",
      "| Scenario | Group | Script | Cycles | Result |",
      "|---|---|---|---:|---|",
      ...same.map((r) => `| ${md(r.scenario)} | \`${r.group}\` | ${md(r.script)} | ${fmt(r.head!.cycles ?? 0)} | ${r.head!.result} |`),
      "",
      "</details>",
      "",
    );
  }
  out.push("<sub>Generated by ckb-cycles (ckb-cycle-tools): each scenario replayed in ckb-debugger, one run per script group.</sub>");
  return out.join("\n");
}

/** The same table for a terminal. */
export function formatText(diff: CycleDiff): string {
  const header = ["SCENARIO", "GROUP", "SCRIPT", "BASE", "HEAD", "Δ", "Δ%", ""];
  const rows = diff.rows.map((r) => [
    r.scenario,
    r.group,
    r.script,
    cell(r.base),
    cell(r.head),
    r.delta === undefined ? "" : signed(r.delta),
    pct(r.percent),
    note(r, diff.threshold),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const right = new Set([3, 4, 5, 6]);
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (right.has(i) ? c.padStart(widths[i]) : c.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  return [summarize(diff), "", line(header), ...rows.map(line)].join("\n");
}

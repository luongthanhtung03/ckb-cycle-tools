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
  /**
   * The scenario could not run because a binary it needs does not exist where
   * `--binaries-from` points. On the base of a pull request, that is a scenario
   * whose code is new in the head: its groups count as new, not as a base error.
   */
  binaryMissing?: boolean;
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
  /**
   * The costliest functions of the run, heaviest self first (at most
   * FUNCTION_LIMIT). Only for a group whose binary has a `symbols` build.
   */
  functions?: FunctionResult[];
  /** Why `functions` were not recorded although asked for (the symbols build costs other cycles…). */
  functionsWarning?: string;
}

export interface FunctionResult {
  name: string;
  /** Cycles spent in the function itself. */
  self: number;
  /** Cycles spent in it and everything it called. */
  total: number;
}

/** How many functions a report keeps per group. */
export const FUNCTION_LIMIT = 15;

/**
 * One function's self cycles on each side. A side is undefined when it is not
 * known: no functions were recorded there, or the function is not in a list
 * that was cut at FUNCTION_LIMIT. In a shorter list, absent means 0.
 */
export interface FunctionDelta {
  name: string;
  base?: number;
  head?: number;
  /** Set when both sides are known. */
  delta?: number;
}

/** `error`: the head could not run the scenario. `base-error`: the base could not, so nothing was compared. */
export type RowKind = "same" | "changed" | "result" | "new" | "removed" | "error" | "base-error";

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
  /** Functions whose self cycles changed, largest change first (when the head recorded functions). */
  functions?: FunctionDelta[];
  /** The head's reason for not recording functions. */
  functionsWarning?: string;
}

export interface CycleDiff {
  rows: DiffRow[];
  /**
   * Groups whose accept/reject outcome changed (ok → exit 12, exit 12 → ok,
   * exit 12 → exit 13), and new groups that do not accept: a new group is
   * compared with "did not run".
   */
  resultChanges: number;
  /** Groups whose cycles grew by more than the threshold. */
  overThreshold: number;
  /** Scenarios the base could not run: their head groups had nothing to be compared with. */
  baseErrors: number;
  threshold?: number;
}

export interface DiffOptions {
  /** Percent. An increase above it is flagged, and makes `failed` true. */
  failAbove?: number;
  /** A changed outcome makes `failed` true. */
  failOnResultChange?: boolean;
}

/** The base side of a new group that does not accept: compared with "did not run". */
const NOT_RUN = "not run";

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
    // A base that could not run the scenario has nothing to compare against, so
    // every group is new. Unless the scenario's binary is new in the head, that
    // is the base being broken, and the gate must not pass over it in silence.
    if (h && b?.error && !b.binaryMissing) {
      rows.push({ scenario: name, group: "", script: "", kind: "base-error", overThreshold: false, note: `base: ${b.error}` });
    }
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
    baseErrors: rows.filter((r) => r.kind === "base-error").length,
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
  } else if (h && resultLabel(h) !== "ok") {
    // A new group that does not accept: against "did not run", its result changed.
    row.kind = "result";
    row.base = { result: NOT_RUN };
  }
  if (h?.functions) row.functions = functionDeltas(b?.functions, h.functions);
  if (h?.functionsWarning) row.functionsWarning = h.functionsWarning;
  return row;
}

/**
 * The functions whose self cycles differ between two lists, largest change
 * first. One whose other side is not known (see FunctionDelta) is kept, ranked
 * by the side that is.
 */
export function functionDeltas(base: FunctionResult[] | undefined, head: FunctionResult[]): FunctionDelta[] {
  const side = (list: FunctionResult[] | undefined, name: string) => {
    if (!list) return undefined;
    const f = list.find((f) => f.name === name);
    return f ? f.self : list.length < FUNCTION_LIMIT ? 0 : undefined;
  };
  const names = [...new Set([...head.map((f) => f.name), ...(base ?? []).map((f) => f.name)])];
  const size = (d: FunctionDelta) => Math.abs(d.delta ?? d.head ?? d.base ?? 0);
  return names
    .map((name): FunctionDelta => {
      const b = side(base, name);
      const h = side(head, name);
      return { name, ...(b !== undefined && { base: b }), ...(h !== undefined && { head: h }), ...(b !== undefined && h !== undefined && { delta: h - b }) };
    })
    .filter((d) => d.delta !== 0)
    .sort((x, y) => size(y) - size(x) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/**
 * Whether the diff should fail a check, per the options it was made with. A
 * scenario the head could not run always fails; one the base could not run
 * fails whenever a threshold is set, since nothing in it was checked.
 */
export function diffFailed(diff: CycleDiff, options: DiffOptions = {}): boolean {
  const gated = options.failAbove !== undefined || options.failOnResultChange === true;
  return (
    (options.failAbove !== undefined && diff.overThreshold > 0) ||
    (options.failOnResultChange === true && diff.resultChanges > 0) ||
    (gated && diff.baseErrors > 0) ||
    diff.rows.some((r) => r.kind === "error")
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : "0");
const pct = (p: number | undefined) =>
  p === undefined ? "" : p === 0 ? "0%" : `${p > 0 ? "+" : "-"}${Math.abs(p) < 0.01 ? "<0.01" : Math.abs(p).toFixed(2)}%`;
const cell = (s: { result: string; cycles?: number } | undefined) =>
  !s || s.result === NOT_RUN ? "—" : s.result === "ok" ? fmt(s.cycles ?? 0) : `${fmt(s.cycles ?? 0)} (${s.result})`;

function note(r: DiffRow, threshold?: number): string {
  switch (r.kind) {
    case "result":
      return r.base!.result === NOT_RUN
        ? `NEW, DOES NOT ACCEPT: ${r.head!.result}`
        : `RESULT CHANGED: ${r.base!.result} → ${r.head!.result}`;
    case "new":
      return "new";
    case "removed":
      return "removed";
    case "error":
      return r.note ?? "error";
    case "base-error":
      return `NOT COMPARED: ${r.note ?? "base: error"}`;
    default:
      return r.overThreshold ? `over ${threshold}%` : "";
  }
}

/** One line saying what matters, for the top of a comment or terminal output. */
export function summarize(diff: CycleDiff): string {
  const groups = diff.rows.filter((r) => r.kind !== "error" && r.kind !== "base-error");
  const changed = groups.filter((r) => r.kind !== "same").length;
  const errors = diff.rows.filter((r) => r.kind === "error").length;
  // A new group has no base, so no percentage: the threshold cannot apply to it.
  const unchecked =
    diff.threshold === undefined ? 0 : groups.filter((r) => !r.base || r.base.result === NOT_RUN).length;
  const s = (n: number) => (n > 1 ? "s" : "");
  const parts = [
    ...(diff.resultChanges ? [`${diff.resultChanges} result change${s(diff.resultChanges)}`] : []),
    ...(diff.overThreshold ? [`${diff.overThreshold} over the ${diff.threshold}% threshold`] : []),
    ...(errors ? [`${errors} scenario${s(errors)} failed to run`] : []),
    ...(diff.baseErrors ? [`${diff.baseErrors} scenario${s(diff.baseErrors)} could not run on the base`] : []),
    `${changed} of ${groups.length} script group${groups.length === 1 ? "" : "s"} changed`,
    ...(unchecked
      ? [`${unchecked} new group${s(unchecked)} not checked against the ${diff.threshold}% threshold (no base to compare with)`]
      : []),
  ];
  return parts.join(", ");
}

const MD_ESCAPE = /[|\\`*_<>[\]~&!]/g;
/**
 * Text from the PR's own files (scenario and script names, the title) as inert
 * markdown: one line, no table breaks, no formatting. GitHub links @mentions and
 * #refs after rendering, where a backslash is gone: a zero-width space stops them.
 */
const md = (s: string) =>
  s
    .replace(/[\r\n]+/g, " ")
    .replace(MD_ESCAPE, (c) => `\\${c}`)
    .replace(/([@#])(?=\w)/g, "$1\u200b");

/** Text for inside an HTML tag (a `<summary>`, which GitHub does not read as markdown). */
const html = (s: string) =>
  s
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([@#])(?=\w)/g, "$1\u200b");

/** How many changed functions a comment lists per group. */
export const FUNCTIONS_SHOWN = 10;

/** A folded block per group that recorded functions: which of them changed, or why none were recorded. */
function functionBlocks(rows: DiffRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const where = `${html(r.scenario)} · <code>${html(r.group)}</code> (${html(r.script)})`;
    if (r.functionsWarning) {
      out.push(`<details><summary>Functions in ${where}: not recorded</summary>`, "", md(r.functionsWarning), "", "</details>", "");
      continue;
    }
    if (!r.functions?.length) continue;
    const shown = r.functions.slice(0, FUNCTIONS_SHOWN);
    const more = r.functions.length - shown.length;
    const n = r.functions.length;
    out.push(
      `<details><summary>Functions in ${where}: ${n} function${n === 1 ? "" : "s"} changed</summary>`,
      "",
      "| Function | Base self | Head self | Δ |",
      "|---|---:|---:|---:|",
      ...shown.map((f) => `| ${md(f.name)} | ${fnCell(f.base)} | ${fnCell(f.head)} | ${f.delta === undefined ? "" : signed(f.delta)} |`),
      "",
      ...(more > 0 ? [`and ${more} more.`, ""] : []),
      `<sub>Self cycles, from ckb-debugger's profiler with the symbols build; — means not among the ${FUNCTION_LIMIT} costliest (or not recorded).</sub>`,
      "",
      "</details>",
      "",
    );
  }
  return out;
}

const fnCell = (n: number | undefined) => (n === undefined ? "—" : fmt(n));

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
  const order: Record<RowKind, number> = { error: 0, "base-error": 0.5, result: 1, changed: 2, new: 3, removed: 4, same: 5 };
  const rank = (r: DiffRow) => order[r.kind] - (r.overThreshold ? 0.5 : 0);
  const rows = [...diff.rows].sort((a, b) => rank(a) - rank(b));
  const shown = rows.filter((r) => r.kind !== "same");
  const same = rows.filter((r) => r.kind === "same");

  const head = "| Scenario | Group | Script | Base | Head | Δ | Δ% | |\n|---|---|---|---:|---:|---:|---:|---|";
  const line = (r: DiffRow) => {
    const flag = note(r, diff.threshold);
    const strong = r.kind === "result" || r.kind === "error" || r.kind === "base-error" || r.overThreshold;
    return (
      `| ${md(r.scenario)} | ${r.group ? `\`${r.group}\`` : ""} | ${md(r.script)} | ${cell(r.base)} | ${cell(r.head)}` +
      ` | ${r.delta === undefined ? "" : signed(r.delta)} | ${pct(r.percent)} | ${flag ? (strong ? `**${md(flag)}**` : md(flag)) : ""} |`
    );
  };

  const vs = options.baseLabel && options.headLabel ? ` (\`${md(options.baseLabel)}\` → \`${md(options.headLabel)}\`)` : "";
  const out = [COMMENT_MARKER, `### ${md(options.title ?? "Cycle report")}`, "", `${summarize(diff)}${vs}.`, ""];
  if (shown.length) out.push(head, ...shown.map(line), "", ...functionBlocks(shown));
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
  // Under the table, one line per group that recorded functions: the largest changes.
  const functions: string[] = [];
  for (const r of diff.rows.filter((r) => r.kind !== "same")) {
    const where = `${r.scenario} ${r.group}`;
    if (r.functionsWarning) functions.push(`functions in ${where} not recorded: ${r.functionsWarning}`);
    else if (r.functions?.length) {
      const top = r.functions
        .slice(0, 5)
        .map((f) => (f.delta !== undefined ? `${f.name} ${signed(f.delta)}` : `${f.name} ${fnText(f.base)} → ${fnText(f.head)}`));
      const more = r.functions.length - top.length;
      functions.push(`functions in ${where}: ${top.join(", ")}${more > 0 ? `, and ${more} more` : ""}`);
    }
  }
  return [summarize(diff), "", line(header), ...rows.map(line), ...(functions.length ? ["", ...functions] : [])].join("\n");
}

const fnText = (n: number | undefined) => (n === undefined ? "?" : fmt(n));

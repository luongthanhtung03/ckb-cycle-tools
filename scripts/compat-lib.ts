/**
 * The pure parts of the cross-version check (scripts/compat.ts): the release
 * manifest, the frozen scenario file, comparing runs against the reference
 * debugger, and the markdown report. No I/O here, so it is unit tested.
 */
import { createHash } from "node:crypto";
import type { MockTransaction } from "../src/mock.js";

/** One release asset: its file name on the GitHub release and the SHA-256 the release publishes for it. */
export interface Asset {
  asset: string;
  sha256: string;
}

export interface Release {
  version: string;
  tag: string;
  /** Native builds, by `process.platform`. */
  native: Partial<Record<"linux" | "win32" | "darwin", Asset>>;
  /** Before 0.200: groups are named with --cell-type/--cell-index/--script-group-type, not --script. */
  legacyCli?: boolean;
  /** The wasm32-wasip1 build, for releases that publish one. */
  wasm?: Asset;
}

export interface Manifest {
  /** The version every other run is compared with (the one the CLI and CI pin). */
  reference: string;
  repository: string;
  releases: Release[];
}

export function assetUrl(m: Manifest, r: Release, a: Asset): string {
  return `https://github.com/${m.repository}/releases/download/${r.tag}/${a.asset}`;
}

/** Throws unless `bytes` hash to the published SHA-256: a replaced or truncated download stops the check. */
export function checkSha256(bytes: Uint8Array, expected: string, what: string): void {
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== expected.toLowerCase()) throw new Error(`${what}: sha256 ${got}, the release publishes ${expected.toLowerCase()}`);
}

/** Where a scenario came from. */
export type Source = "testtool" | "benchmark" | "testnet" | "mainnet";

export interface Scenario {
  id: string;
  source: Source;
  /** What it is, in a few words. */
  title: string;
  /** For a transaction on chain. */
  hash?: string;
  /** The total the node reported, when it recorded one. */
  nodeCycles?: string;
  /** CKB-VM version for `hash_type: "type"` scripts: that of the block's epoch, or 2 off chain. */
  scriptVersion: 0 | 1 | 2;
  /** Script names by selector (`input.0.lock`), for the report. */
  names: Record<string, string>;
  mock: MockTransaction;
}

/**
 * The scenario file as stored: every cell data longer than BLOB_MIN is kept
 * once in `blobs` and named in the mocks as `blob:<sha256>`. Mainnet mocks
 * share the same megabyte-sized code cells, so this keeps the file small.
 */
export interface ScenarioFile {
  recordedAt: string;
  recordedWith: string;
  scenarios: Scenario[];
  blobs: Record<string, string>;
}

const BLOB_MIN = 4096;
const BLOB = /^blob:([0-9a-f]{64})$/;

type Cell = { data: string };
const cellsOf = (m: MockTransaction): Cell[] => [...m.mock_info.inputs, ...m.mock_info.cell_deps];

export function packScenarios(scenarios: Scenario[], meta: { recordedAt: string; recordedWith: string }): ScenarioFile {
  const blobs: Record<string, string> = {};
  const packed = scenarios.map((s) => {
    const mock = structuredClone(s.mock);
    for (const c of cellsOf(mock)) {
      if (c.data.length < BLOB_MIN) continue;
      const key = createHash("sha256").update(c.data).digest("hex");
      blobs[key] = c.data;
      c.data = `blob:${key}`;
    }
    return { ...s, mock };
  });
  return { ...meta, scenarios: packed, blobs };
}

export function unpackScenarios(file: ScenarioFile): Scenario[] {
  return file.scenarios.map((s) => {
    const mock = structuredClone(s.mock);
    for (const c of cellsOf(mock)) {
      const m = BLOB.exec(c.data);
      if (!m) continue;
      const data = file.blobs[m[1]];
      if (data === undefined) throw new Error(`${s.id}: missing blob ${m[1]}`);
      c.data = data;
    }
    return { ...s, mock };
  });
}

/** One group of one scenario, as one debugger ran it. */
export interface GroupResult {
  selector: string;
  result: number;
  error?: string;
  cycles: string;
}

/** One scenario under one debugger at one CKB-VM version. */
export interface Run {
  scenario: string;
  /** e.g. "native 1.1.1", "wasm 1.1.1", "wasm 0.200.1 (ckb-testtool)". */
  debugger: string;
  /** What the debugger printed for `--version`. */
  reported: string;
  scriptVersion: 0 | 1 | 2;
  groups: GroupResult[];
  /** Set when the debugger could not run the scenario at all (e.g. a flag it does not know). */
  failure?: string;
}

export const total = (r: Run) => r.groups.reduce((s, g) => s + BigInt(g.cycles), 0n);

/** How one run compares with the reference run of the same scenario at the same VM version. */
export type Verdict = "same" | "differs" | "failed";

export function compareRun(run: Run, ref: Run): { verdict: Verdict; diffs: string[] } {
  if (run.failure) return { verdict: "failed", diffs: [run.failure] };
  const diffs: string[] = [];
  const bySel = new Map(run.groups.map((g) => [g.selector, g]));
  for (const want of ref.groups) {
    const got = bySel.get(want.selector);
    if (!got) {
      diffs.push(`${want.selector}: missing`);
      continue;
    }
    if (got.cycles !== want.cycles) diffs.push(`${want.selector}: ${got.cycles} cycles, reference ${want.cycles}`);
    if (got.result !== want.result || (got.error ?? "") !== (want.error ?? "")) {
      diffs.push(`${want.selector}: result ${got.error ?? got.result}, reference ${want.error ?? want.result}`);
    }
  }
  return { verdict: diffs.length ? "differs" : "same", diffs };
}

export interface Comparison {
  scenario: string;
  debugger: string;
  scriptVersion: number;
  verdict: Verdict;
  diffs: string[];
}

/** Every run that is not the reference, against the reference run of its scenario and VM version. */
export function compareAll(runs: Run[], reference: string): Comparison[] {
  const refs = new Map(runs.filter((r) => r.debugger === reference).map((r) => [`${r.scenario}@${r.scriptVersion}`, r]));
  const out: Comparison[] = [];
  for (const r of runs) {
    if (r.debugger === reference) continue;
    const ref = refs.get(`${r.scenario}@${r.scriptVersion}`);
    if (!ref) continue;
    out.push({ scenario: r.scenario, debugger: r.debugger, scriptVersion: r.scriptVersion, ...compareRun(r, ref) });
  }
  return out;
}

const fmt = (n: bigint | string) => BigInt(n).toLocaleString("en-US");
const cell = (g: GroupResult) => (g.error ? `stopped: ${g.error}` : g.result === 0 ? fmt(g.cycles) : `${fmt(g.cycles)} (exit ${g.result})`);

export interface ReportInput {
  scenarios: Scenario[];
  runs: Run[];
  /** Debugger labels, in column order; the first is the reference. */
  debuggers: string[];
  /** Per debugger label: what it printed for --version, and where it came from. */
  about: Record<string, { reported: string; origin: string }>;
  platform: string;
  startedAt: string;
}

/**
 * The report: per scenario and group, the cycles under each debugger at the
 * scenario's own VM version (mismatches marked), then the same scenarios with
 * the reference debugger at every VM version, then any mismatch in full.
 */
export function renderCompat(input: ReportInput): string {
  const [reference] = input.debuggers;
  const comparisons = compareAll(input.runs, reference);
  const bad = comparisons.filter((c) => c.verdict !== "same");
  const atOwn = comparisons.filter((c) => input.scenarios.some((s) => s.id === c.scenario && s.scriptVersion === c.scriptVersion));
  const groupsRun = input.runs
    .filter((r) => r.debugger !== reference)
    .reduce((n, r) => n + r.groups.length, 0);
  const runOf = (sc: string, dbg: string, v: number) => input.runs.find((r) => r.scenario === sc && r.debugger === dbg && r.scriptVersion === v);
  const lines: string[] = [];
  lines.push(`Platform: ${input.platform}. Run started ${input.startedAt}. Reference: ${reference}.`, "");
  lines.push(
    `${input.scenarios.length} scenarios, ${input.debuggers.length} debugger builds. ` +
      `${comparisons.length} scenario runs compared with the reference (${groupsRun} script groups): ` +
      `${comparisons.filter((c) => c.verdict === "same").length} identical, ` +
      `${comparisons.filter((c) => c.verdict === "differs").length} different, ` +
      `${comparisons.filter((c) => c.verdict === "failed").length} could not run.`,
    "",
  );

  lines.push("## Debuggers", "", "| Build | `--version` | Source |", "|---|---|---|");
  for (const d of input.debuggers) lines.push(`| ${d} | ${input.about[d]?.reported ?? "?"} | ${input.about[d]?.origin ?? ""} |`);
  lines.push("");

  lines.push(
    "## Cycles per script group, at each scenario's own CKB-VM version",
    "",
    "Each cell is the group's cycles; `≠` marks a value that differs from the reference column. " +
      "VM is the version `hash_type: \"type\"` scripts ran on (data, data1 and data2 scripts name their own).",
    "",
  );
  // Columns that agree with the reference everywhere are folded into one, so the table stays readable.
  const others = input.debuggers.slice(1);
  const identical = others.filter((d) => !atOwn.some((c) => c.debugger === d && c.verdict !== "same"));
  const shown = others.filter((d) => !identical.includes(d));
  const head = [`Scenario`, `Group`, `VM`, reference, ...shown];
  if (identical.length) head.push(`${identical.length} other builds`);
  lines.push(`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i < 3 ? "---" : "--:")).join("|")}|`);
  for (const s of input.scenarios) {
    const ref = runOf(s.id, reference, s.scriptVersion);
    if (!ref) continue;
    const groups = ref.failure ? [{ selector: "(all)", result: -1, error: ref.failure, cycles: "0" }] : ref.groups;
    for (const [i, g] of groups.entries()) {
      const row = [i === 0 ? s.id : "", `${g.selector}${s.names[g.selector] ? ` ${s.names[g.selector]}` : ""}`, String(s.scriptVersion), cell(g)];
      for (const d of shown) {
        const r = runOf(s.id, d, s.scriptVersion);
        const got = r?.groups.find((x) => x.selector === g.selector);
        if (!r) row.push("not run");
        else if (r.failure) row.push(`failed`);
        else if (!got) row.push("missing");
        else row.push(got.cycles === g.cycles && got.result === g.result && (got.error ?? "") === (g.error ?? "") ? cell(got) : `≠ ${cell(got)}`);
      }
      if (identical.length) row.push("same");
      lines.push(`| ${row.join(" | ")} |`);
    }
    if (s.nodeCycles !== undefined) {
      const t = total(ref);
      lines.push(
        `| | total (node: ${fmt(s.nodeCycles)}) | | ${fmt(t)}${t === BigInt(s.nodeCycles) ? "" : " ≠ node"} |${shown.map(() => " |").join("")}${identical.length ? " |" : ""}`,
      );
    }
  }
  if (identical.length) lines.push("", `Identical to the reference in every group: ${identical.join(", ")}.`);
  lines.push("");

  const versions = [...new Set(input.runs.map((r) => r.scriptVersion))].sort();
  if (versions.length > 1) {
    lines.push(
      "## The same scenarios on every CKB-VM version (reference debugger)",
      "",
      "Total cycles of all groups with `--script-version` 0, 1 and 2. Only `hash_type: \"type\"` scripts follow the flag. " +
        "A scenario whose scripts are all data/data1/data2 costs the same on every row.",
      "",
    );
    const vh = ["Scenario", ...versions.map((v) => `VM ${v}`)];
    lines.push(`| ${vh.join(" | ")} |`, `|---|${versions.map(() => "--:").join("|")}|`);
    for (const s of input.scenarios) {
      const row = [s.id];
      for (const v of versions) {
        const r = runOf(s.id, reference, v);
        if (!r) row.push("");
        else if (r.failure) row.push(`not run: ${shortFailure(r.failure)}`);
        else {
          const stopped = r.groups.filter((g) => g.error || g.result !== 0).length;
          row.push(`${fmt(total(r))}${v === s.scriptVersion ? " (own)" : ""}${stopped ? `, ${stopped} group(s) rejected` : ""}`);
        }
      }
      lines.push(`| ${row.join(" | ")} |`);
    }
    lines.push("");
  }

  lines.push("## Mismatches", "");
  if (!bad.length) lines.push("None: every build gave the reference's cycles and result for every group, at every VM version run.");
  for (const c of bad) lines.push(`- ${c.debugger}, ${c.scenario}, VM ${c.scriptVersion}: ${c.verdict}. ${c.diffs.join("; ")}`);
  lines.push("");
  return lines.join("\n");
}

/** A failure in a few words: the debugger's own error name when it panicked, else the start of the message. */
export function shortFailure(failure: string): string {
  const err = /Err` value: (\w+(?:\(\d+\))?)/.exec(failure);
  return err ? `debugger refused, ${err[1]}` : failure.length > 60 ? `${failure.slice(0, 60)}…` : failure;
}

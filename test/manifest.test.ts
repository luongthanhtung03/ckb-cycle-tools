// Reproducibility manifest (review #46, point 4): what a report was measured
// with, and a diff that does not compare reports that did not measure the same thing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { diffFailed, diffReports, formatMarkdown, formatText, INPUTS_CHANGED, type CycleReport, type GroupResult } from "../src/diff.js";
import { canonicalJson, fileDigest, gitCommit, inputsHash, scenarioInputs } from "../src/manifest.js";
import type { DebuggerOutput } from "../src/profile.js";
import { formatReport, runReport } from "../src/report.js";

const VM = "0xb95123c71a870e3f0f74a7ee1dab8268dbfbc1407b46733ebd1b41f854b4324a";
const MOCK = resolve("benchmarks/session-lock/mocks/spend-exactly-max-per-tx.json");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const fakeDebugger = async (args: string[]): Promise<DebuggerOutput> =>
  args[0] === "--version"
    ? { stdout: "ckb-debugger 1.1.1\n", stderr: "", exitCode: 0 }
    : { stdout: "Run result: 0\nAll cycles: 539(0.0M)\n", stderr: "", exitCode: 0 };

/** A repository-like directory with a mock, a binary and a cycles.json. */
function project(config: Record<string, unknown> = {}, mockBytes = readFileSync(MOCK)) {
  const dir = mkdtempSync(join(tmpdir(), "ckb-manifest-"));
  writeFileSync(join(dir, "m.json"), mockBytes);
  writeFileSync(join(dir, "vm"), "built vm");
  writeFileSync(
    join(dir, "cycles.json"),
    JSON.stringify({ binaries: { vm: { path: "vm", codeHash: VM } }, scenarios: [{ name: "charge", mock: "m.json" }], ...config }),
  );
  return dir;
}

const run = async (dir: string, options: Parameters<typeof runReport>[1] = {}) => {
  const { errors: _, notices: __, ...r } = await runReport(join(dir, "cycles.json"), { runDebugger: fakeDebugger, ...options });
  // Through JSON, as the Action passes reports.
  return JSON.parse(JSON.stringify(r)) as CycleReport;
};

describe("report manifest", () => {
  it("records the tool, the debugger, each scenario's VM, inputs and swapped-in binaries", async () => {
    const dir = project();
    const r = await run(dir, { toolchain: "  rustc 1.85.0 (4d91de4e4 2025-02-17)\n" });
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(r.manifest).toMatchObject({
      schema: 1,
      tool: { name: pkg.name, version: pkg.version },
      debugger: { version: "ckb-debugger 1.1.1" },
      toolchain: "rustc 1.85.0 (4d91de4e4 2025-02-17)",
    });
    const [s] = r.manifest!.scenarios;
    expect(s).toEqual({
      name: "charge",
      scriptVersion: 2,
      inputs: inputsHash({ kind: "mock" }, readFileSync(MOCK)),
      binaries: [{ name: "vm", path: "vm", sha256: sha("built vm"), size: 8 }],
    });
    // A temp directory is no git checkout: no commit, and no failure.
    expect(r.manifest!.git).toBeUndefined();
    expect(formatReport(r)).toContain(`manifest: toolchain: rustc 1.85.0 (4d91de4e4 2025-02-17) · ${pkg.name} ${pkg.version}`);
  });

  it("records the commit of a git checkout", async () => {
    const head = await gitCommit(process.cwd());
    const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    expect(head).toBe(git.status === 0 ? git.stdout.trim() : undefined);
    expect(await gitCommit(mkdtempSync(join(tmpdir(), "ckb-nogit-")))).toBeUndefined();
    expect(await gitCommit(join(tmpdir(), "no-such-dir-ckb-manifest"))).toBeUndefined();
  });

  it("hashes the native debugger binary that every scenario ran", async () => {
    const dir = project();
    const fake = join(dir, "ckb-debugger-fake");
    writeFileSync(fake, "not really a debugger");
    const { manifest } = await runReport(join(dir, "cycles.json"), { debuggerPath: fake });
    expect(manifest.debugger).toMatchObject({ path: fake, sha256: sha("not really a debugger") });
    expect(await fileDigest(fake)).toEqual({ sha256: sha("not really a debugger"), size: 21 });
  });

  it("records a WebAssembly debugger's build id when the caller runs one", async () => {
    const r = await run(project(), { debuggerBuild: { wasm: "ab".repeat(32) } });
    expect(r.manifest!.debugger).toEqual({ version: "ckb-debugger 1.1.1", wasm: "ab".repeat(32) });
  });

  it("an input hash follows the bytes and what decides the run, not the file's path or the scenario's name", () => {
    const bytes = readFileSync(MOCK);
    const base = inputsHash(scenarioInputs({ name: "a", mock: "x.json" }, undefined), bytes);
    expect(inputsHash(scenarioInputs({ name: "b", mock: "moved/x.json", functions: true }, undefined), bytes)).toBe(base);
    expect(inputsHash(scenarioInputs({ name: "a", mock: "x.json" }, undefined), Buffer.concat([bytes, Buffer.from(" ")]))).not.toBe(base);
    expect(inputsHash(scenarioInputs({ name: "a", mock: "x.json", scriptVersion: 1 }, undefined), bytes)).not.toBe(base);
    expect(inputsHash(scenarioInputs({ name: "a", mock: "x.json", binaries: ["vm"] }, undefined), bytes)).not.toBe(base);
    expect(scenarioInputs({ name: "a", mock: "x.json", binaries: ["b", "a"] }, undefined)).toEqual({ kind: "mock", binaries: ["a", "b"] });
    expect(scenarioInputs({ name: "t", tx: `0x${"AB".repeat(32)}` }, "mainnet")).toEqual({ kind: "tx", tx: `0x${"ab".repeat(32)}`, network: "mainnet" });
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });

  // The Action with base-config: head runs both sides from the PR's cycles.json and
  // mocks, the base with --binaries-from: the inputs are the same by construction.
  it("base-config: head gives equal input hashes, so every group is compared", async () => {
    const dir = project();
    const empty = mkdtempSync(join(tmpdir(), "ckb-base-"));
    const head = await run(dir);
    const base = await run(dir, { binariesRoot: empty });
    expect(base.manifest!.scenarios[0].inputs).toBe(head.manifest!.scenarios[0].inputs);
    const d = diffReports(base, head, { failAbove: 5 });
    expect(d.inputsChanged).toBeUndefined();
    expect(d.rows.every((r) => !r.inputsChanged)).toBe(true);
    expect(d.environment).toBeUndefined();
    expect(d.notes).toBeUndefined();
  });

  it("a head that edits the scenario's mock is not compared, and fails a gated diff", async () => {
    const mock = JSON.parse(readFileSync(MOCK, "utf8"));
    const base = await run(project({}, Buffer.from(JSON.stringify(mock))));
    mock.tx.witnesses = [...mock.tx.witnesses, "0x00"];
    const head = await run(project({}, Buffer.from(JSON.stringify(mock))));
    const d = diffReports(base, head, { failAbove: 5 });
    expect(d.inputsChanged).toBe(2);
    expect(d.changedScenarios).toEqual(["charge"]);
    for (const r of d.rows) expect(r).toMatchObject({ kind: "new", inputsChanged: true, notCompared: INPUTS_CHANGED });
    // Not counted as removed or new: allow-removed does not let it through.
    expect(d.removed).toBe(0);
    expect(d.newGroups).toBe(0);
    expect(diffFailed(d, { failAbove: 5 })).toBe(true);
    expect(diffFailed(d, { failOnResultChange: true })).toBe(true);
    expect(diffFailed(d, { failAbove: 5, allowRemoved: true })).toBe(true);
    expect(diffFailed(d, { failAbove: 5, allowChangedInputs: true })).toBe(false);
    // Ungated: reported, not a failure.
    expect(diffFailed(d)).toBe(false);
    const md = formatMarkdown(d);
    expect(md).toContain("**NOT COMPARED: inputs changed");
    expect(md).toContain("2 groups NOT COMPARED: the inputs of 1 scenario changed");
    expect(formatText(d)).toContain("NOT COMPARED: inputs changed");
  });

  it("a base group the head no longer has, in a scenario whose inputs changed, is not compared either", () => {
    const g = (selector: string): GroupResult => ({ selector, role: "lock", script: "s", codeHash: "0x00", hashType: "type", result: 0, cycles: 100 });
    const report = (inputs: string, groups: GroupResult[]): CycleReport => ({
      tool: "ckb-cycles",
      version: 1,
      scenarios: [{ name: "x", groups }],
      manifest: { schema: 1, tool: { name: "ckb-cycle-tools", version: "1.3.0" }, debugger: { version: "ckb-debugger 1.1.1" }, scenarios: [{ name: "x", inputs, scriptVersion: 2 }] },
    });
    const d = diffReports(report("aa", [g("input.0.lock"), g("input.1.lock")]), report("bb", [g("input.0.lock")]), { failAbove: 1 });
    expect(d.rows.map((r) => [r.kind, r.inputsChanged])).toEqual([["new", true], ["removed", true]]);
    expect(d.removed).toBe(0);
    expect(formatText(d)).toContain("NOT IN THE HEAD (NOT COMPARED: inputs changed");
  });
});

describe("diff: environment from the manifests", () => {
  const g: GroupResult = { selector: "input.0.lock", role: "lock", script: "s", codeHash: "0x00", hashType: "type", result: 0, cycles: 100 };
  const report = (m: Partial<NonNullable<CycleReport["manifest"]>> | null, scenario: { scriptVersion?: number } = {}): CycleReport => ({
    tool: "ckb-cycles",
    version: 1,
    scenarios: [{ name: "x", groups: [g] }],
    ...(m && {
      manifest: {
        schema: 1,
        tool: { name: "ckb-cycle-tools", version: "1.3.0" },
        debugger: { version: "ckb-debugger 1.1.1", sha256: "11".repeat(32) },
        scenarios: [{ name: "x", inputs: "cc".repeat(32), scriptVersion: 2, ...scenario }],
        ...m,
      },
    }),
  });

  it("another ckb-debugger binary fails a gated diff, and is a prominent note otherwise", () => {
    const head = report({ debugger: { version: "ckb-debugger 1.1.1", sha256: "22".repeat(32) } });
    const d = diffReports(report({}), head);
    expect(d.environment).toEqual([`ckb-debugger binary: base sha256 ${"11".repeat(32)}, head sha256 ${"22".repeat(32)}`]);
    expect(diffFailed(d)).toBe(false);
    expect(diffFailed(d, { failAbove: 5 })).toBe(true);
    expect(diffFailed(d, { failOnResultChange: true })).toBe(true);
    expect(formatMarkdown(d)).toContain("**The base and head ran in different environments**");
    expect(formatText(d)).toContain("environment differs: ckb-debugger binary");
  });

  it("another debugger version, or native against WebAssembly, fails a gated diff", () => {
    const v = diffReports(report({}), report({ debugger: { version: "ckb-debugger 1.2.0", sha256: "11".repeat(32) } }));
    expect(v.environment).toEqual(["ckb-debugger version: base ckb-debugger 1.1.1, head ckb-debugger 1.2.0"]);
    expect(diffFailed(v, { failAbove: 5 })).toBe(true);
    const w = diffReports(report({}), report({ debugger: { version: "ckb-debugger 1.1.1", wasm: "33".repeat(32) } }));
    expect(w.environment).toEqual(["ckb-debugger: one side ran the native binary, the other the WebAssembly build"]);
  });

  it("another CKB-VM version for a scenario fails a gated diff", () => {
    const d = diffReports(report({}), report({}, { scriptVersion: 1 }));
    expect(d.environment).toEqual(["scenario x: CKB-VM version 2 on the base, 1 on the head"]);
    expect(diffFailed(d, { failAbove: 5 })).toBe(true);
    expect(diffFailed(diffReports(report({}), report({})), { failAbove: 5 })).toBe(false);
  });

  it("a report without a manifest is a note, never a failure; two old reports diff as before", () => {
    const d = diffReports(report(null), report({}), { failAbove: 5 });
    expect(d.notes).toEqual([expect.stringMatching(/^the base report has no manifest/)]);
    expect(diffFailed(d, { failAbove: 5, failOnResultChange: true })).toBe(false);
    expect(formatMarkdown(d)).toContain("**Note:** the base report has no manifest");
    const old = diffReports(report(null), report(null), { failAbove: 5 });
    expect(old.notes).toBeUndefined();
    expect(old.manifests).toBeUndefined();
    // The Action's placeholder base (no cycles.json on the base, or its build failed) measured nothing: no note.
    const empty: CycleReport = { tool: "ckb-cycles", version: 1, scenarios: [] };
    expect(diffReports(empty, report({})).notes).toBeUndefined();
  });

  it("a different toolchain is a note", () => {
    const d = diffReports(report({ toolchain: "rustc 1.84.0" }), report({ toolchain: "rustc 1.85.0" }), { failAbove: 5 });
    expect(d.notes).toEqual(["the toolchain differs: base rustc 1.84.0; head rustc 1.85.0"]);
    expect(diffFailed(d, { failAbove: 5 })).toBe(false);
  });

  it("reads a malformed manifest without failing", () => {
    const bad = { ...report(null), manifest: { scenarios: "x", debugger: 5, tool: null, git: [1] } } as unknown as CycleReport;
    const d = diffReports(bad, report({}), { failAbove: 5 });
    expect(diffFailed(d, { failAbove: 5 })).toBe(false);
    expect(() => formatMarkdown(d)).not.toThrow();
  });

  it("shows each side's manifest in one short line", () => {
    const m = { git: { commit: "ab".repeat(20) }, toolchain: "rustc 1.85.0" };
    const md = formatMarkdown(diffReports(report(m), report(m)));
    expect(md).toContain(`<sub>head: ckb-debugger 1.1.1 (sha256 ${"11".repeat(6)}) · commit ${"ab".repeat(6)} · toolchain: rustc 1.85.0 · ckb-cycle-tools 1.3.0</sub>`);
  });
});

// Every manifest string can come from the PR: its build prints the toolchain, its
// cycles.json names the paths, and a hand-made report can say anything. Same
// rules as other report text (security-audit.test.ts).
describe("audit: manifest text from a pull request", () => {
  const hostile = "rustc 1.85\n::error title=Spoofed::pwned @maintainer #1 <img src=x onerror=alert(1)> | ` [x](https://evil.example)\u202e\u001b[2J";
  const report = (side: "base" | "head"): CycleReport => ({
    tool: "ckb-cycles",
    version: 1,
    scenarios: [{ name: "x", groups: [{ selector: "input.0.lock", role: "lock", script: "s", codeHash: "0x00", hashType: "type", result: 0, cycles: 100 }] }],
    manifest: {
      schema: 1,
      tool: { name: "ckb-cycle-tools\n::warning::x", version: "1.3.0" },
      debugger: { version: `ckb-debugger ${side}\n::add-mask::x`, sha256: `${side}\n::stop-commands::t` },
      git: { commit: "not-a-commit\n::error::c" },
      toolchain: `${hostile} ${side}`,
      scenarios: [{ name: "x", inputs: side, scriptVersion: 2 }],
    },
  });

  it("a toolchain, debugger or commit string cannot start a log line or a workflow command", async () => {
    const d = diffReports(report("base"), report("head"));
    const text = formatText(d);
    expect(text.split("\n").some((l) => /^\s*::/.test(l))).toBe(false);
    expect(text).not.toMatch(/[\u001b\u202e]/);
    const r = await run(project(), { toolchain: hostile });
    const out = formatReport(r);
    expect(out.split("\n").some((l) => /^\s*::/.test(l))).toBe(false);
    expect(out).not.toMatch(/[\u001b\u202e]/);
    expect(formatReport(report("head")).split("\n").some((l) => /^\s*::/.test(l))).toBe(false);
  });

  it("is inert markdown in the comment: no HTML, no table break, no mention, no link", () => {
    const md = formatMarkdown(diffReports(report("base"), report("head")));
    // Escaped: GitHub shows the text, renders no tag.
    expect(md).not.toMatch(/(?<!\\)<img/);
    expect(md).toContain("\\<img");
    expect(md).not.toMatch(/@maintainer/);
    expect(md).toContain("@\u200bmaintainer");
    expect(md).not.toContain("https://evil");
    expect(md).not.toMatch(/[\u001b\u202e]/);
    // Every manifest line is one line: the hostile newline did not end it.
    for (const l of md.split("\n").filter((l) => l.includes("toolchain"))) expect(l).toMatch(/(^<sub>.*<\/sub>$)|(^\*\*Note:\*\*)/);
    expect(md.split("\n").some((l) => l.startsWith("::"))).toBe(false);
  });

  it("a long toolchain is clipped in the report and in the comment", async () => {
    const r = await run(project(), { toolchain: "x".repeat(10_000) });
    expect(r.manifest!.toolchain!.length).toBe(4096);
    const md = formatMarkdown(diffReports(r, r));
    for (const l of md.split("\n")) expect(l.length).toBeLessThan(700);
  });
});

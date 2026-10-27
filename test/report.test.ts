import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
import { diffReports, formatMarkdown, type CycleReport } from "../src/diff.js";
import { functionCosts, parseFolded } from "../src/flame.js";
import type { DebuggerOutput } from "../src/profile.js";
import { formatReport, parseCyclesConfig, runReport } from "../src/report.js";

const H = "0x" + "ab".repeat(32);

describe("parseCyclesConfig", () => {
  it("reads this repository's own cycles.json", () => {
    const c = parseCyclesConfig(readFileSync("cycles.json", "utf8"));
    expect(c.scenarios.length).toBeGreaterThan(0);
    // Every mock it names is committed, and is a ckb-debugger mock transaction.
    for (const s of c.scenarios.filter((s) => s.mock)) {
      expect(JSON.parse(readFileSync(s.mock!, "utf8"))).toHaveProperty("mock_info");
    }
  });

  it("takes each of the three scenario forms", () => {
    const c = parseCyclesConfig(
      JSON.stringify({
        binaries: { mine: { path: "build/mine", codeHash: H } },
        scenarios: [
          { name: "a", tx: H },
          { name: "b", file: "tx.json", binaries: ["mine"] },
          { name: "c", mock: "mock.json", scriptVersion: 1 },
        ],
      }),
    );
    expect(c.scenarios.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("takes a binary's symbols build and functions, per scenario or for all", () => {
    const c = parseCyclesConfig(
      JSON.stringify({
        functions: true,
        binaries: { mine: { path: "build/mine", codeHash: H, symbols: "build/mine.debug" } },
        scenarios: [{ name: "a", tx: H }, { name: "b", tx: H, functions: false }],
      }),
    );
    expect(c.binaries!.mine.symbols).toBe("build/mine.debug");
    expect(c.functions).toBe(true);
    expect(c.scenarios[1].functions).toBe(false);
  });

  it.each([
    ["not JSON", "{", /not valid JSON/],
    ["no scenarios", "{}", /expected \{ "scenarios"/],
    ["two sources", JSON.stringify({ scenarios: [{ name: "a", tx: H, file: "x" }] }), /exactly one of/],
    ["no source", JSON.stringify({ scenarios: [{ name: "a" }] }), /exactly one of/],
    ["a bad hash", JSON.stringify({ scenarios: [{ name: "a", tx: "0x12" }] }), /transaction hash/],
    ["a duplicate name", JSON.stringify({ scenarios: [{ name: "a", tx: H }, { name: "a", tx: H }] }), /two scenarios/],
    ["an unknown binary", JSON.stringify({ scenarios: [{ name: "a", tx: H, binaries: ["x"] }] }), /unknown binary "x"/],
    ["a binary with both matchers", JSON.stringify({ binaries: { x: { path: "p", codeHash: H, outPoint: { tx_hash: H, index: "0x0" } } }, scenarios: [] }), /either "outPoint" or "codeHash"/],
    ["a binary with neither", JSON.stringify({ binaries: { x: { path: "p" } }, scenarios: [] }), /either "outPoint" or "codeHash"/],
    ["a bad out point", JSON.stringify({ binaries: { x: { path: "p", outPoint: { tx_hash: H, index: 1 } } }, scenarios: [] }), /"outPoint" must be/],
    ["a mock that is not a path", JSON.stringify({ scenarios: [{ name: "a", mock: { path: "x" } }] }), /"mock" must be a path/],
    ["a bad name", JSON.stringify({ names: { "0x12": "x" }, scenarios: [] }), /--name expects/],
    ["a bad network", JSON.stringify({ network: "devnet", scenarios: [] }), /"network"/],
    ["empty symbols", JSON.stringify({ binaries: { x: { path: "p", codeHash: H, symbols: "" } }, scenarios: [] }), /"symbols" must be a path/],
    ["a non-boolean functions", JSON.stringify({ functions: "yes", scenarios: [] }), /"functions" must be true or false/],
    ["a scenario's non-boolean functions", JSON.stringify({ scenarios: [{ name: "a", tx: H, functions: 1 }] }), /scenario "a": "functions"/],
    ["functions without symbols", JSON.stringify({ binaries: { x: { path: "p", codeHash: H } }, scenarios: [{ name: "a", tx: H, functions: true }] }), /needs a binary with "symbols"/],
  ])("refuses %s", (_, json, message) => {
    expect(() => parseCyclesConfig(json)).toThrow(message);
  });
});

describe("formatReport", () => {
  it("prints one row per group, and why a scenario did not run", () => {
    const out = formatReport({
      tool: "ckb-cycles",
      version: 1,
      debugger: "ckb-debugger 1.1.1",
      scenarios: [
        {
          name: "overspend",
          groups: [
            { selector: "input.0.lock", role: "lock", script: "session-lock", codeHash: H, hashType: "data2", result: 12, cycles: 12_893 },
          ],
          warnings: ["mine: args are not rewritten"],
        },
        { name: "gone", error: "ENOENT: gone.json", groups: [] },
      ],
    });
    expect(out.split("\n")).toEqual([
      "SCENARIO   GROUP         SCRIPT        RESULT   CYCLES",
      "overspend  input.0.lock  session-lock  exit 12  12,893",
      "gone                                   error",
      "",
      "gone: ENOENT: gone.json",
      "",
      "overspend: warning: mine: args are not rewritten",
      "",
      "ckb-debugger 1.1.1",
    ]);
  });
});

describe("runReport", () => {
  it("records a scenario whose binary is missing, and goes on with the rest", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ckb-cycles-"));
    const seen: string[] = [];
    const r = await runReport("cycles.json", { binariesRoot: empty, onScenario: (s) => seen.push(s.name) });
    const config = parseCyclesConfig(readFileSync("cycles.json", "utf8"));
    expect(seen).toEqual(config.scenarios.map((s) => s.name));
    for (const s of r.scenarios) {
      expect(s.groups).toEqual([]);
      expect(s.error).toMatch(/cannot read .* build it first/);
      // Absent from that checkout: diff counts its groups as new, not the base as broken.
      expect(s.binaryMissing).toBe(true);
    }
    expect(r.errors).toHaveLength(config.scenarios.length);
  });

  // Security review, 27 Oct: in CI the cycles.json is the pull request's.
  it("with roots, reads nothing the config names outside them", async () => {
    const outside = mkdtempSync(join(tmpdir(), "ckb-outside-"));
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, "TOKEN=abcdef");
    const repo = mkdtempSync(join(tmpdir(), "ckb-repo-"));
    writeFileSync(
      join(repo, "cycles.json"),
      JSON.stringify({
        binaries: { b: { path: `../${basename(outside)}/secret.txt`, codeHash: H } },
        scenarios: [
          { name: "absolute", mock: secret, binaries: [] },
          { name: "dotdot", file: `../${basename(outside)}/secret.txt`, binaries: [] },
          { name: "binary", mock: secret, binaries: ["b"] },
        ],
      }),
    );
    const r = await runReport(join(repo, "cycles.json"), { roots: [repo] });
    for (const s of r.scenarios) {
      expect(s.error).toMatch(/is outside the checkout/);
      // Not a word of the file reached the report (JSON.parse quotes the start of what it read).
      expect(s.error).not.toContain("TOKEN");
    }
    // Without roots (local use), the same config does read the file.
    const open = await runReport(join(repo, "cycles.json"));
    expect(open.scenarios[0].error).toContain("TOKEN");
  });

  it.skipIf(process.platform === "win32")("with roots, follows a symlink before deciding", async () => {
    const { symlinkSync } = await import("node:fs");
    const outside = mkdtempSync(join(tmpdir(), "ckb-outside-"));
    writeFileSync(join(outside, "secret.json"), "TOKEN=abcdef");
    const repo = mkdtempSync(join(tmpdir(), "ckb-repo-"));
    symlinkSync(join(outside, "secret.json"), join(repo, "mock.json"));
    writeFileSync(join(repo, "cycles.json"), JSON.stringify({ scenarios: [{ name: "link", mock: "mock.json" }] }));
    const r = await runReport(join(repo, "cycles.json"), { roots: [repo] });
    expect(r.scenarios[0].error).toMatch(/is outside the checkout/);
  });

  it("with roots, still tells a binary missing from the base from one outside", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ckb-cycles-"));
    const r = await runReport("cycles.json", { binariesRoot: empty, roots: [".", empty] });
    for (const s of r.scenarios) expect(s.binaryMissing).toBe(true);
  });

  const bytecode = "benchmarks/session-lock/dist/session-lock.bc";
  const ready = existsSync(bytecode) && (() => { try { resolveDebugger(); return true; } catch { return false; } })();
  it.skipIf(!ready)("replays the committed mocks with the built bytecode, offline", async () => {
    const r = await runReport("cycles.json");
    expect(r.errors).toEqual([]);
    const lock = (name: string) => r.scenarios.find((s) => s.name.endsWith(name))!.groups.find((g) => g.selector === "input.0.lock")!;
    expect(lock("spend exactly max_per_tx")).toMatchObject({ script: "session-lock (ckb-js-vm)", result: 0 });
    expect(lock("one shannon over max_per_tx").result).toBe(12);
    expect(lock("args too short").result).toBe(10);
    expect(lock("pays the allowed recipient").cycles).toBeGreaterThan(1_000_000);
  });
});

describe("runReport with functions", () => {
  // The session lock's mock: input.0.lock runs ckb-js-vm (by type hash), input.1.lock always-success.
  const VM = "0xb95123c71a870e3f0f74a7ee1dab8268dbfbc1407b46733ebd1b41f854b4324a";
  const mock = resolve("benchmarks/session-lock/mocks/spend-exactly-max-per-tx.json");
  const folded = readFileSync("test/fixtures/session-lock-charge.flamegraph.txt", "utf8");

  /** A cycles.json in a fresh directory, with a binary and (unless `symbols` is false) its symbols build. */
  const setup = (config: { functions?: boolean; scenarioFunctions?: boolean; symbols?: boolean }) => {
    const dir = mkdtempSync(join(tmpdir(), "ckb-cycles-"));
    writeFileSync(join(dir, "vm"), "built");
    if (config.symbols !== false) writeFileSync(join(dir, "vm.debug"), "unstripped");
    writeFileSync(
      join(dir, "cycles.json"),
      JSON.stringify({
        ...(config.functions !== undefined && { functions: config.functions }),
        binaries: { vm: { path: "vm", codeHash: VM, symbols: "vm.debug" } },
        scenarios: [{ name: "charge", mock, ...(config.scenarioFunctions !== undefined && { functions: config.scenarioFunctions }) }],
      }),
    );
    return dir;
  };

  /** Stands in for ckb-debugger: fixed cycles, the fixture as the flamegraph, `--bin` costing `binCycles`. */
  const fakeDebugger = (binCycles = 20_999) => {
    const runs: string[][] = [];
    const run = async (args: string[]): Promise<DebuggerOutput> => {
      runs.push(args);
      if (args[0] === "--version") return { stdout: "ckb-debugger 1.1.1\n", stderr: "", exitCode: 0 };
      const out = args.indexOf("--flamegraph-output");
      if (out >= 0) writeFileSync(args[out + 1], folded);
      const selector = args[args.indexOf("--script") + 1];
      const cycles = selector === "input.0.lock" ? (args.includes("--bin") ? binCycles : 20_999) : 539;
      return { stdout: `Run result: 0\nAll cycles: ${cycles}(0.0M)\n`, stderr: "", exitCode: 0 };
    };
    return { runs, run };
  };

  it("records the costliest functions of a group whose binary has symbols", async () => {
    const dir = setup({ functions: true });
    const { runs, run } = fakeDebugger();
    const r = await runReport(join(dir, "cycles.json"), { runDebugger: run });
    expect(r.errors).toEqual([]);
    const [lock, other] = r.scenarios[0].groups;
    expect(lock).toMatchObject({ selector: "input.0.lock", script: "vm", cycles: 20_999 });
    const expected = functionCosts(parseFolded(folded))
      .slice(0, 15)
      .map((f) => ({ name: f.name, self: Number(f.self), total: Number(f.total) }));
    expect(lock.functions).toEqual(expected);
    expect(lock.functions![0]).toMatchObject({ name: "session_lock::lock_hash", self: 4_490 });
    expect(lock).not.toHaveProperty("functionsWarning");
    // Only the group with symbols is profiled, with the symbols build.
    expect(other).not.toHaveProperty("functions");
    const flame = runs.filter((a) => a.includes("--enable-flamegraph"));
    expect(flame).toHaveLength(1);
    expect(flame[0]).toEqual(expect.arrayContaining(["--script", "input.0.lock", "--bin", join(dir, "vm.debug")]));
    expect(formatReport(r)).toContain("charge input.0.lock: costliest functions (self cycles): session_lock::lock_hash 4,490");
  });

  it("records a warning instead when the symbols build costs other cycles", async () => {
    const dir = setup({ scenarioFunctions: true });
    const r = await runReport(join(dir, "cycles.json"), { runDebugger: fakeDebugger(21_100).run });
    const lock = r.scenarios[0].groups[0];
    expect(lock.cycles).toBe(20_999);
    expect(lock).not.toHaveProperty("functions");
    expect(lock.functionsWarning).toMatch(/symbols build vm\.debug runs 21,100 cycles \(ok\), the binary 20,999 \(ok\): not the same code/);
  });

  it("says so on the group when the symbols build is missing, and still measures it", async () => {
    const dir = setup({ functions: true, symbols: false });
    const { runs, run } = fakeDebugger();
    const r = await runReport(join(dir, "cycles.json"), { runDebugger: run });
    expect(r.errors).toEqual([]);
    expect(r.scenarios[0].groups[0]).toMatchObject({ cycles: 20_999, functionsWarning: "cannot read the symbols build vm.debug: build it first" });
    expect(runs.some((a) => a.includes("--enable-flamegraph"))).toBe(false);
  });

  it("leaves the report as it was when functions are not asked for", async () => {
    for (const dir of [setup({}), setup({ functions: true, scenarioFunctions: false })]) {
      const { runs, run } = fakeDebugger();
      const r = await runReport(join(dir, "cycles.json"), { runDebugger: run });
      for (const g of r.scenarios[0].groups) expect(Object.keys(g).sort()).toEqual(["codeHash", "cycles", "hashType", "result", "role", "script", "selector"]);
      expect(runs.some((a) => a.includes("--enable-flamegraph"))).toBe(false);
    }
  });

  it("diffs a head with functions against a base report without them", async () => {
    const { errors: _, ...head } = await runReport(join(setup({ functions: true }), "cycles.json"), { runDebugger: fakeDebugger().run });
    const { errors: __, ...base } = await runReport(join(setup({}), "cycles.json"), { runDebugger: fakeDebugger().run });
    // Through JSON, as the Action passes them.
    const d = diffReports(JSON.parse(JSON.stringify(base)) as CycleReport, JSON.parse(JSON.stringify(head)) as CycleReport);
    expect(d.rows.map((r) => r.kind)).toEqual(["same", "same"]);
    expect(d.rows[0].functions![0]).toEqual({ name: "session_lock::lock_hash", head: 4_490 });
    // Unchanged groups stay folded away, functions or not.
    expect(formatMarkdown(d)).not.toContain("Functions in");
  });
});

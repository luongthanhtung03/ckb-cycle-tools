import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDebugger } from "../src/debugger.js";
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
    ["a bad name", JSON.stringify({ names: { "0x12": "x" }, scenarios: [] }), /--name expects/],
    ["a bad network", JSON.stringify({ network: "devnet", scenarios: [] }), /"network"/],
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
    }
    expect(r.errors).toHaveLength(config.scenarios.length);
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

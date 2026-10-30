// Security audit, 30 Oct: findings shown as failing tests. Each says what the
// code should do; they fail until the finding is fixed.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DebuggerOutput } from "../src/profile.js";
import { formatReport, runReport } from "../src/report.js";

const MOCK = resolve("benchmarks/session-lock/mocks/spend-exactly-max-per-tx.json");

/** A stand-in debugger that keeps a copy of every tx file it was given. */
const recordingDebugger = () => {
  const txFiles: string[] = [];
  const run = async (args: string[]): Promise<DebuggerOutput> => {
    if (args[0] === "--version") return { stdout: "ckb-debugger 1.1.1\n", stderr: "", exitCode: 0 };
    const at = args.indexOf("--tx-file");
    if (at >= 0) txFiles.push(readFileSync(args[at + 1], "utf8"));
    return { stdout: "Run result: 0\nAll cycles: 539(0.0M)\n", stderr: "", exitCode: 0 };
  };
  return { txFiles, run };
};

describe("audit: report with --root (untrusted cycles.json)", () => {
  // ckb-debugger expands `{{ data <path> }}` / `{{ hash <path> }}` directives in a
  // tx file before parsing it (mock_tx_embed.rs), reading any path on the runner.
  // A PR's mock that carries one escapes the --root confinement.
  it("does not hand ckb-debugger a mock with file-embedding directives", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ckb-repo-"));
    const mock = JSON.parse(readFileSync(MOCK, "utf8"));
    mock.tx.witnesses = [...mock.tx.witnesses, "0x{{ data ../outside-the-checkout }}"];
    writeFileSync(join(repo, "pr-mock.json"), JSON.stringify(mock));
    writeFileSync(join(repo, "cycles.json"), JSON.stringify({ scenarios: [{ name: "embed", mock: "pr-mock.json" }] }));
    const { txFiles, run } = recordingDebugger();
    const r = await runReport(join(repo, "cycles.json"), { roots: [repo], runDebugger: run });
    expect(txFiles.some((t) => t.includes("{{"))).toBe(false);
    expect(r.scenarios[0].error).toMatch(/\{\{/);
  });

  // The config's "rpc" is honoured under --root: a PR picks the URL the runner
  // POSTs to, and the node's error message is reflected into the report.
  it("does not let the PR's cycles.json choose the node", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "REFLECTED-FROM-PR-CHOSEN-HOST" } }));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    try {
      const repo = mkdtempSync(join(tmpdir(), "ckb-repo-"));
      writeFileSync(
        join(repo, "cycles.json"),
        JSON.stringify({ rpc: `http://127.0.0.1:${port}/internal`, scenarios: [{ name: "t", tx: `0x${"ab".repeat(32)}` }] }),
      );
      const { run } = recordingDebugger();
      await runReport(join(repo, "cycles.json"), { roots: [repo], runDebugger: run, timeoutMs: 5000 });
      expect(hits).toEqual([]);
    } finally {
      server.close();
    }
  });
});

describe("audit: terminal / CI log output", () => {
  // formatReport prints scenario names, warnings and function names as they
  // are. A PR's scenario name with a newline starts a new log line, which
  // GitHub Actions reads as a workflow command (::error::, ::add-mask::,
  // ::stop-commands::); an ESC byte drives the terminal.
  it("keeps names from the config on one line, without control characters", () => {
    const out = formatReport({
      tool: "ckb-cycles",
      version: 1,
      scenarios: [{ name: "x\n::error title=Spoofed::looks like the tool\u001b[2J", error: "boom", groups: [] }],
    });
    expect(out.split("\n").some((l) => l.startsWith("::"))).toBe(false);
    expect(out).not.toMatch(/\u001b/);
  });
});

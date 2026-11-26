/**
 * The CLI's usage text: every option a command accepts is listed on that
 * command's usage line, and `ckb-cycles <command> --help` prints the usage
 * (exit 0) instead of failing on an unknown option.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src", "cli.ts");
const source = readFileSync(SRC, "utf8");
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", SRC, ...args], { encoding: "utf8", env: { ...process.env, CKB_DEBUGGER_PATH: "" } });

const USAGE = /const USAGE = `([\s\S]*?)`;/.exec(source)![1];

/** The usage lines of one command: its `ckb-cycles <command>` line and the indented lines after it. */
function usageOf(command: string | undefined): string {
  const lines = USAGE.split("\n");
  const start = lines.findIndex((l) => (command ? new RegExp(`ckb-cycles ${command}\\b`).test(l) : /ckb-cycles <tx-hash>/.test(l)));
  expect(start, `usage line for ${command ?? "<tx-hash>"}`).toBeGreaterThanOrEqual(0);
  const out = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    // The transaction form goes on with `ckb-cycles --file <tx.json> [same options]`.
    if (!/^ {18}\[/.test(l) && !(!command && /ckb-cycles --file/.test(l))) break;
    out.push(l);
  }
  return out.join("\n");
}

/** The option names a parseArgs call in `fn` accepts. */
function optionsOf(fn: string): string[] {
  const body = new RegExp(`${fn}\\([^)]*\\)[^{]*\\{[\\s\\S]*?options: \\{([\\s\\S]*?)\\n {4}\\},`).exec(source);
  expect(body, fn).not.toBeNull();
  return [...body![1].matchAll(/^\s+"?([a-z-]+)"?: \{ type/gm)].map((m) => m[1]);
}

describe("usage text", () => {
  const commands: [string | undefined, string][] = [
    [undefined, "main"],
    ["report", "reportCommand"],
    ["diff", "diffCommand"],
    ["mock", "mockCommand"],
    ["scan", "scanCommand"],
    ["bench", "benchCommand"],
    ["flame", "flameCommand"],
  ];

  it.each(commands)("lists every option of %s on its usage line", (command, fn) => {
    const usage = usageOf(command);
    const options = optionsOf(fn).filter((o) => o !== "help");
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(usage, `--${o} for ${command ?? "<tx-hash>"}`).toContain(o === "out" ? "-o <" : `--${o}`);
  });

  it.each(["report", "diff", "mock", "scan", "bench", "flame"])("ckb-cycles %s --help prints the usage", (command) => {
    // -h for one command, --help for the rest: each run starts tsx, which takes seconds.
    const r = cli(command, command === "flame" ? "-h" : "--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("usage: ckb-cycles");
    expect(r.stderr).toBe("");
  }, 60_000);

  it("ckb-cycles --help still prints it, and a bad option is still an error", () => {
    expect(cli("--help").status).toBe(0);
    const r = cli("flame", "--nope");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Unknown option '--nope'/);
  }, 60_000);
});

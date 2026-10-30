#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { diffFailed, diffReports, formatMarkdown, formatText, termLine, termLines, type CycleReport } from "./diff.js";
import { buildMockTransaction, httpRpc, mockFromTransaction } from "./mock.js";
import { flameTree, foldedTotal, formatFolded, functionCosts, renderFlameSvg } from "./flame.js";
import { flameTransaction, parseNames, profileTransaction, readTransactionJson, type Profile } from "./profile.js";
import { PUBLIC_RPC } from "./replay.js";
import { formatReport, runReport } from "./report.js";
import { formatScan, scanTestMocks } from "./scan.js";

const USAGE = `usage: ckb-cycles <tx-hash> [--mainnet] [--rpc <url>] [--timeout <s>] [--debugger <path>]
                  [--json] [--name <code-hash>[:<hash-type>]=<label> ...]
       ckb-cycles --file <tx.json> [same options]
       ckb-cycles report <cycles.json> [--json <out.json>] [--binaries-from <dir>]
                  [--root <dir> ...] [--rpc <url>] [--timeout <s>] [--debugger <path>]
       ckb-cycles diff <base.json> <head.json> [--markdown] [--fail-above <percent>]
                  [--fail-on-result-change] [--allow-removed] [--title <s>]
                  [--base-label <s>] [--head-label <s>]
       ckb-cycles mock <tx-hash> | --file <tx.json>  [-o <mock.json>] [--mainnet] [--rpc <url>]
                  [--timeout <s>]
       ckb-cycles scan <mocks-dir> [--binaries <dir>] [-o <cycles.json>] [--functions]
       ckb-cycles flame <tx-hash> | --file <tx.json>  [-o <dir>] [--script <selector> ...]
                  [--bin <code-hash>=<elf> ...] [--top <n>] [--mainnet] [--rpc <url>] [--debugger <path>]

Replays a CKB transaction in ckb-debugger, one run per script group, and prints
the cycles each group cost.

  <tx-hash>    a committed transaction; the sum is checked against the node
  --file       a transaction that is not on chain: one about to be sent, or one
               the node rejected. Shows which script refuses it and why. JSON in
               the node's RPC shape, a get_transaction result, or ccc.stringify(tx)
  --rpc        the node to ask. Its chain and hardfork epochs (get_consensus)
               decide the CKB-VM version, whatever the flags say; --mainnet with
               a node that serves another chain stops with an error
  --timeout    seconds to wait for each RPC answer (default 30)
  --name       a label for your own script, shown instead of its code hash;
               repeat for several. Without :<hash-type> it applies to all of them

Exit codes: 0 every script accepts (and the sum matches the node's)
            1 a script rejects, or the sum differs from the node's
            2 usage or environment error: bad arguments, node unreachable,
              transaction not found, ckb-debugger missing or unreadable output

  report       runs every scenario in a cycles.json (see README) and records each
               script group's result and cycles; --json writes them for diff.
               --binaries-from <dir> reads the binaries from another checkout
               (the PR's base). A binary with "symbols" in a scenario with
               "functions" also records the group's costliest functions.
               --root <dir> (repeatable) refuses any file the config names
               outside those directories, symlinks resolved: for CI, where
               the cycles.json comes from a pull request;
               its "rpc" is then ignored (--rpc still applies)
               Exits 2 if a scenario could not run, or a binary matched no
               cell dep in any scenario (both also in the JSON's "errors"):
               a rejection is a result, not an error. A binary missing from
               --binaries-from is left as the mock has it: only the groups
               whose code it is are marked, and not compared
  diff         compares two reports group by group: Δ cycles, Δ%, and any group
               whose result changed (ok → exit 12, or back). --fail-above exits 1
               when a group grows by more than that percentage (a new group
               has no base, so no percentage: it is never over the threshold),
               --fail-on-result-change when a result changed, including a new
               group that does not accept, or a group the VM stopped (also
               over any --fail-above). A scenario the head could not run
               always exits 1. With either flag set, so does anything left
               unchecked: a scenario the base could not run, an error in
               either report, a base group with nothing in the head to
               compare with (removed, renamed, moved, or its binary not built
               on the base); --allow-removed accepts the last
  mock         saves a transaction as a ckb-debugger mock transaction, every cell
               it touches included, so a scenario can replay it with no node
  scan         writes a cycles.json from the mock transactions a test suite wrote
               (ckb-testtool with CKB_CYCLES_MOCKS set, see integrations/ckb-testtool):
               one scenario per file, and each file in --binaries (default
               build/release) that a test deployed, matched by its data hash, with
               <name>.debug as its symbols build. --functions records each group's
               costliest functions. -o defaults to cycles.json
  flame        where inside each script the cycles go: ckb-debugger's flamegraph
               mode per script group. Prints the costliest functions and writes
               <dir>/<selector>.svg and .folded (for speedscope or inferno), in
               ./flame by default. A deployed binary is usually stripped, so it is
               one frame: --bin gives an unstripped build of the same code (its
               cycles are checked against the deployed binary's). The profile
               leaves out loading the binary, so it is a little under the group's
               cycles`;

const fmt = (n: bigint) => n.toLocaleString("en-US");
const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

function table(p: Profile): string {
  const total = p.measuredCycles || 1n;
  const rows = p.groups.map((g) => [
    g.role,
    termLine(g.name ?? short(g.codeHash)),
    g.selector,
    g.error ? "error" : g.result === 0 ? "ok" : `exit ${g.result}`,
    fmt(g.cycles),
    `${((Number(g.cycles) / Number(total)) * 100).toFixed(1)}%`,
  ]);
  const head = ["GROUP", "SCRIPT", "RUN AT", "RESULT", "CYCLES", "SHARE"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i >= 4 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ");

  const title = p.nodeCycles === undefined && p.status === "not on chain" ? "tx not on chain" : `tx ${p.hash}  (${p.status})`;
  const out = [title, "", line(head), ...rows.map(line), ""];
  out.push(`measured (sum of groups)  ${fmt(p.measuredCycles)}`);
  if (p.nodeCycles !== undefined) {
    const match = p.nodeCycles === p.measuredCycles;
    out.push(`reported by node          ${fmt(p.nodeCycles)}  ${match ? "✓ match" : "✗ MISMATCH"}`);
  } else if (p.status === "committed") {
    out.push("reported by node          not recorded by this node (try another with --rpc)");
  }
  out.push(`${termLine(p.env.debugger)} · CKB-VM v${p.env.scriptVersion} for type scripts · ${p.env.network} · ${p.env.rpcUrl}`);
  for (const g of p.groups.filter((g) => g.error)) out.push("", `${g.selector} stopped: ${termLine(g.error!)}`);
  for (const g of p.groups.filter((g) => g.logs.length)) {
    out.push("", `${g.selector} logged:`, ...g.logs.map((l) => `  ${termLine(l)}`));
  }
  return out.join("\n");
}

/** `--timeout <seconds>` → milliseconds; usage error (exit 2) for anything but a positive number. */
function timeoutOf(value: string | undefined): { timeoutMs?: number } {
  if (value === undefined) return {};
  const seconds = Number(value);
  if (!(seconds > 0)) throw new Error("--timeout expects a number of seconds, e.g. 30");
  return { timeoutMs: seconds * 1000 };
}


const toJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function reportCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "string" },
      rpc: { type: "string" },
      timeout: { type: "string" },
      debugger: { type: "string" },
      "binaries-from": { type: "string" },
      root: { type: "string", multiple: true },
    },
  });
  if (positionals.length !== 1) {
    console.log(USAGE);
    return 2;
  }
  const report = await runReport(positionals[0], {
    ...(values.rpc && { rpcUrl: values.rpc }),
    ...timeoutOf(values.timeout),
    ...(values.debugger && { debuggerPath: values.debugger }),
    ...(values["binaries-from"] && { binariesRoot: values["binaries-from"] }),
    ...(values.root && { roots: values.root }),
    onScenario: (s) => console.error(`${s.error ? "✗" : "·"} ${termLine(s.name)}`),
  });
  const { errors, notices, ...data } = report;
  // The errors go in the JSON too: a gated diff fails on them, so a CI step that
  // ignores this exit code (the Action's `|| true`) still gets the verdict.
  if (values.json) await writeFile(values.json, toJson({ ...data, ...(errors.length && { errors }) }) + "\n");
  console.log(formatReport(data));
  for (const n of notices ?? []) console.error(`warning: ${termLine(n)}`);
  for (const e of errors) console.error(`error: ${termLines(e)}`);
  return errors.length ? 2 : 0;
}

async function readReport(path: string): Promise<CycleReport> {
  const r = JSON.parse(await readFile(path, "utf8"));
  if (r?.tool !== "ckb-cycles" || !Array.isArray(r.scenarios)) throw new Error(`${path} is not a ckb-cycles report`);
  return r;
}

async function diffCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      markdown: { type: "boolean" },
      "fail-above": { type: "string" },
      "fail-on-result-change": { type: "boolean" },
      "allow-removed": { type: "boolean" },
      "base-label": { type: "string" },
      "head-label": { type: "string" },
      title: { type: "string" },
    },
  });
  if (positionals.length !== 2) {
    console.log(USAGE);
    return 2;
  }
  const failAbove = values["fail-above"] === undefined ? undefined : Number(values["fail-above"]);
  if (failAbove !== undefined && !(failAbove >= 0)) {
    console.error("error: --fail-above expects a percentage, e.g. 5");
    return 2;
  }
  const options = {
    ...(failAbove !== undefined && { failAbove }),
    failOnResultChange: values["fail-on-result-change"],
    allowRemoved: values["allow-removed"],
  };
  const diff = diffReports(await readReport(positionals[0]), await readReport(positionals[1]), options);
  console.log(
    values.markdown
      ? formatMarkdown(diff, {
          ...(values.title && { title: values.title }),
          ...(values["base-label"] && { baseLabel: values["base-label"] }),
          ...(values["head-label"] && { headLabel: values["head-label"] }),
        })
      : formatText(diff),
  );
  return diffFailed(diff, options) ? 1 : 0;
}

async function mockCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      out: { type: "string", short: "o" },
      mainnet: { type: "boolean" },
      rpc: { type: "string" },
      timeout: { type: "string" },
    },
  });
  const [hash] = positionals;
  if (positionals.length > 1 || !hash === !values.file || (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash))) {
    console.log(USAGE);
    return 2;
  }
  const rpc = httpRpc(values.rpc ?? PUBLIC_RPC[values.mainnet ? "mainnet" : "testnet"], timeoutOf(values.timeout));
  const mock = values.file
    ? await mockFromTransaction(rpc, readTransactionJson(await readFile(values.file, "utf8")))
    : (await buildMockTransaction(rpc, hash)).mock;
  if (values.out) await writeFile(values.out, toJson(mock) + "\n");
  else console.log(toJson(mock));
  return 0;
}

async function scanCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      binaries: { type: "string" },
      out: { type: "string", short: "o" },
      functions: { type: "boolean" },
    },
  });
  if (positionals.length !== 1) {
    console.log(USAGE);
    return 2;
  }
  const binariesDir = values.binaries ?? "build/release";
  const r = await scanTestMocks(positionals[0], {
    binariesDir,
    ...(values.out && { out: values.out }),
    ...(values.functions && { functions: true }),
  });
  console.error(formatScan(r, binariesDir));
  return 0;
}

/** `--bin 0xabc…=target/release/my-script` → flameTransaction's bins. */
function parseBins(flags: string[]): Record<string, string> {
  const bins: Record<string, string> = {};
  for (const flag of flags) {
    const m = /^(0x[0-9a-fA-F]{64})=(.+)$/.exec(flag);
    if (!m) throw new Error(`--bin expects <code-hash>=<path to an ELF>, got "${flag}"`);
    bins[m[1].toLowerCase()] = m[2];
  }
  return bins;
}

async function flameCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      out: { type: "string", short: "o" },
      script: { type: "string", multiple: true },
      bin: { type: "string", multiple: true },
      top: { type: "string" },
      mainnet: { type: "boolean" },
      rpc: { type: "string" },
      timeout: { type: "string" },
      debugger: { type: "string" },
      name: { type: "string", multiple: true },
    },
  });
  const [hash] = positionals;
  if (positionals.length > 1 || !hash === !values.file || (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash))) {
    console.log(USAGE);
    return 2;
  }
  const top = values.top === undefined ? 8 : Number(values.top);
  if (!(Number.isInteger(top) && top > 0)) throw new Error("--top expects a positive whole number");
  const target = values.file ? readTransactionJson(await readFile(values.file, "utf8")) : hash;
  const { plan, groups, debugger: version } = await flameTransaction(target, {
    ...(values.mainnet && { network: "mainnet" as const }),
    ...(values.rpc && { rpcUrl: values.rpc }),
    ...timeoutOf(values.timeout),
    ...(values.debugger && { debuggerPath: values.debugger }),
    scriptNames: parseNames(values.name ?? []),
    bins: parseBins(values.bin ?? []),
    ...(values.script && { scripts: values.script }),
    readFile: (path) => readFile(path, "utf8"),
  });
  if (!groups.length) {
    console.error("error: no script group to profile (check --script)");
    return 2;
  }
  const dir = values.out ?? "flame";
  await mkdir(dir, { recursive: true });
  const out: string[] = [`tx ${plan.hash}  (${plan.status})`, ""];
  let bad = false;
  for (const g of groups) {
    const label = termLine(g.name ?? short(g.codeHash));
    const profiled = foldedTotal(g.folded);
    out.push(`${g.selector}  ${label}  ${g.error ? "error" : g.result === 0 ? "ok" : `exit ${g.result}`}  ${fmt(g.cycles)} cycles`);
    if (g.bin) {
      // Same cycles and the same verdict, and neither run stopped by the VM: two stopped
      // runs both report 0 cycles, which proves nothing (review, 27 Oct).
      const same = g.deployedCycles === g.cycles && g.deployedResult === g.result && !g.error && !g.deployedError;
      out.push(`  --bin ${termLine(g.bin)}: ${same ? "same cycles as the deployed binary" : `✗ ${fmt(g.deployedCycles ?? 0n)} cycles, result ${g.deployedError ? "vm error" : g.deployedResult} with the deployed binary: this build is not that code`}`);
      bad ||= !same;
    }
    if (!g.folded.size) {
      out.push("  no profile written (the run stopped before it could be profiled?)", "");
      continue;
    }
    const costs = functionCosts(g.folded);
    if (costs.length === 1) out.push("  one frame: the binary has no symbols. Pass an unstripped build with --bin <code-hash>=<elf>");
    out.push(`  profiled ${fmt(profiled)} cycles (loading the binary is not profiled)`, "  SELF        TOTAL       FUNCTION");
    for (const c of costs.slice(0, top)) out.push(`  ${fmt(c.self).padStart(10)}  ${fmt(c.total).padStart(10)}  ${termLine(c.name)}`);
    const base = join(dir, g.selector);
    await writeFile(`${base}.folded`, formatFolded(g.folded) + "\n");
    await writeFile(`${base}.svg`, renderFlameSvg(flameTree(g.folded, g.selector), { title: `${g.selector} · ${label}` }));
    out.push(`  → ${base}.svg, ${base}.folded`, "");
  }
  out.push(`${termLine(version)} · CKB-VM v${plan.scriptVersion} for type scripts · ${plan.network} · ${plan.rpcUrl}`);
  console.log(out.join("\n"));
  return bad || groups.some((g) => g.result !== 0) ? 1 : 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "report") return reportCommand(rest);
  if (command === "diff") return diffCommand(rest);
  if (command === "mock") return mockCommand(rest);
  if (command === "flame") return flameCommand(rest);
  if (command === "scan") return scanCommand(rest);

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mainnet: { type: "boolean" },
      rpc: { type: "string" },
      timeout: { type: "string" },
      debugger: { type: "string" },
      json: { type: "boolean" },
      file: { type: "string" },
      name: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });
  const [hash] = positionals;
  if (values.help || (!hash && !values.file) || (hash && values.file)) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    console.error("error: expected a transaction hash: 0x followed by 64 hex characters");
    return 2;
  }
  const target = values.file ? readTransactionJson(await readFile(values.file, "utf8")) : hash;

  const p = await profileTransaction(target, {
    // Only an explicit --mainnet is passed on, and checked against the node;
    // without it, the node itself says which chain it serves.
    ...(values.mainnet && { network: "mainnet" as const }),
    ...(values.rpc && { rpcUrl: values.rpc }),
    ...timeoutOf(values.timeout),
    ...(values.debugger && { debuggerPath: values.debugger }),
    scriptNames: parseNames(values.name ?? []),
  });

  if (values.json) {
    console.log(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } else {
    console.log(table(p));
  }
  const mismatch = p.nodeCycles !== undefined && p.nodeCycles !== p.measuredCycles;
  return mismatch || p.groups.some((g) => g.result !== 0) ? 1 : 0;
}

// 1 is a verdict (a script rejects, a sum differs, a diff over its thresholds);
// anything thrown is the tool not getting that far: 2, so a CI job asserting a
// rejection with `test $? = 1` does not pass when the node is down.
main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`error: ${termLines(e instanceof Error ? e.message : String(e))}`);
    process.exit(2);
  },
);

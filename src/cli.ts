#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { diffFailed, diffReports, formatMarkdown, formatText, type CycleReport } from "./diff.js";
import { buildMockTransaction, httpRpc, mockFromTransaction } from "./mock.js";
import { parseNames, profileTransaction, readTransactionJson, type Profile } from "./profile.js";
import { formatReport, runReport } from "./report.js";

const USAGE = `usage: ckb-cycles <tx-hash> [--mainnet] [--rpc <url>] [--debugger <path>] [--json]
                  [--name <code-hash>[:<hash-type>]=<label> ...]
       ckb-cycles --file <tx.json> [same options]
       ckb-cycles report <cycles.json> [--json <out.json>] [--binaries-from <dir>]
                  [--rpc <url>] [--debugger <path>]
       ckb-cycles diff <base.json> <head.json> [--markdown] [--fail-above <percent>]
                  [--fail-on-result-change] [--title <s>] [--base-label <s>] [--head-label <s>]
       ckb-cycles mock <tx-hash> | --file <tx.json>  [-o <mock.json>] [--mainnet] [--rpc <url>]

Replays a CKB transaction in ckb-debugger, one run per script group, and prints
the cycles each group cost.

  <tx-hash>    a committed transaction; the sum is checked against the node
  --file       a transaction that is not on chain: one about to be sent, or one
               the node rejected. Shows which script refuses it and why. JSON in
               the node's RPC shape, a get_transaction result, or ccc.stringify(tx)
  --name       a label for your own script, shown instead of its code hash;
               repeat for several. Without :<hash-type> it applies to all of them

Exits 1 if any script rejects, or if the sum differs from the node's.

  report       runs every scenario in a cycles.json (see README) and records each
               script group's result and cycles; --json writes them for diff.
               --binaries-from <dir> reads the binaries from another checkout
               (the PR's base). Exits 1 only if a scenario could not run: a
               rejection is a result, not an error
  diff         compares two reports group by group: Δ cycles, Δ%, and any group
               whose result changed (ok → exit 12, or back). --fail-above exits 1
               when a group grows by more than that percentage,
               --fail-on-result-change when a result changed; a scenario the
               head could not run always exits 1
  mock         saves a transaction as a ckb-debugger mock transaction, every cell
               it touches included, so a scenario can replay it with no node`;

const fmt = (n: bigint) => n.toLocaleString("en-US");
const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

function table(p: Profile): string {
  const total = p.measuredCycles || 1n;
  const rows = p.groups.map((g) => [
    g.role,
    g.name ?? short(g.codeHash),
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
  out.push(`${p.env.debugger} · CKB-VM v${p.env.scriptVersion} for type scripts · ${p.env.network} · ${p.env.rpcUrl}`);
  for (const g of p.groups.filter((g) => g.error)) out.push("", `${g.selector} stopped: ${g.error}`);
  for (const g of p.groups.filter((g) => g.logs.length)) {
    out.push("", `${g.selector} logged:`, ...g.logs.map((l) => `  ${l}`));
  }
  return out.join("\n");
}

const toJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function reportCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "string" },
      rpc: { type: "string" },
      debugger: { type: "string" },
      "binaries-from": { type: "string" },
    },
  });
  if (positionals.length !== 1) {
    console.log(USAGE);
    return 2;
  }
  const report = await runReport(positionals[0], {
    ...(values.rpc && { rpcUrl: values.rpc }),
    ...(values.debugger && { debuggerPath: values.debugger }),
    ...(values["binaries-from"] && { binariesRoot: values["binaries-from"] }),
    onScenario: (s) => console.error(`${s.error ? "✗" : "·"} ${s.name}`),
  });
  const { errors, ...data } = report;
  if (values.json) await writeFile(values.json, toJson(data) + "\n");
  console.log(formatReport(data));
  for (const e of errors) console.error(`error: ${e}`);
  return errors.length ? 1 : 0;
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
  const options = { ...(failAbove !== undefined && { failAbove }), failOnResultChange: values["fail-on-result-change"] };
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
    },
  });
  const [hash] = positionals;
  if (positionals.length > 1 || !hash === !values.file || (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash))) {
    console.log(USAGE);
    return 2;
  }
  const rpc = httpRpc(values.rpc ?? (values.mainnet ? "https://mainnet.ckb.dev/" : "https://testnet.ckb.dev/"));
  const mock = values.file
    ? await mockFromTransaction(rpc, readTransactionJson(await readFile(values.file, "utf8")))
    : (await buildMockTransaction(rpc, hash)).mock;
  if (values.out) await writeFile(values.out, toJson(mock) + "\n");
  else console.log(toJson(mock));
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "report") return reportCommand(rest);
  if (command === "diff") return diffCommand(rest);
  if (command === "mock") return mockCommand(rest);

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mainnet: { type: "boolean" },
      rpc: { type: "string" },
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
    network: values.mainnet ? "mainnet" : "testnet",
    ...(values.rpc && { rpcUrl: values.rpc }),
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

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);

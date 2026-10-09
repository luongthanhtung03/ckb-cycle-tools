#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { profileTransaction, readTransactionJson, type Profile } from "./profile.js";

const USAGE = `usage: ckb-cycles <tx-hash> [--mainnet] [--rpc <url>] [--debugger <path>] [--json]
       ckb-cycles --file <tx.json> [same options]

Replays a CKB transaction in ckb-debugger, one run per script group, and prints
the cycles each group cost.

  <tx-hash>    a committed transaction; the sum is checked against the node
  --file       a transaction that is not on chain: one about to be sent, or one
               the node rejected. Shows which script refuses it and why. JSON in
               the node's RPC shape, a get_transaction result, or ccc.stringify(tx)

Exits 1 if any script rejects, or if the sum differs from the node's.`;

const fmt = (n: bigint) => n.toLocaleString("en-US");
const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

function table(p: Profile): string {
  const total = p.measuredCycles || 1n;
  const rows = p.groups.map((g) => [
    g.role,
    g.name ?? short(g.codeHash),
    g.selector,
    g.result === 0 ? "ok" : `exit ${g.result}`,
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
  }
  for (const g of p.groups.filter((g) => g.logs.length)) {
    out.push("", `${g.selector} logged:`, ...g.logs.map((l) => `  ${l}`));
  }
  return out.join("\n");
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mainnet: { type: "boolean" },
      rpc: { type: "string" },
      debugger: { type: "string" },
      json: { type: "boolean" },
      file: { type: "string" },
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

/**
 * Mainnet cycle atlas: a one-off snapshot of what the scripts in recent CKB
 * mainnet transactions cost, per script group, measured with this repo's own
 * replay (the same planning and checks as `ckb-cycles <tx-hash>`).
 *
 * Read-only JSON-RPC against a public node, one transaction at a time, with a
 * pause between requests and retries on network errors. Each transaction's
 * groups must add up to the node's total; anything else is recorded and listed,
 * never aggregated and never dropped.
 *
 * Usage: npm run atlas -- [--rpc <url>] [--max-txs <n>] [--to <block>] [--blocks <n>]
 *                         [--stride <n>] [--delay <ms>] [--out <dir>] [--debugger <path>]
 *                         [--resume] [--report-only <dir>]
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ccc } from "@ckb-ccc/core";
import { knownScriptNames } from "../src/analyze.js";
import { checkDebuggerPath, resolveDebugger } from "../src/debugger.js";
import { buildMockTransaction, httpRpc, isCellbase, nodeConsensus, scriptVersionAt, type MockTransaction, type Rpc, type RpcTransaction } from "../src/mock.js";
import { runNativeDebugger } from "../src/profile.js";
import { groupsOf, PUBLIC_RPC, replayGroups, type ReplayPlan } from "../src/replay.js";
import { aggregate, nameGroup, renderMarkdown, verdictOf, type AtlasMeta, type TxRecord } from "./atlas-lib.js";

const { values: flags } = parseArgs({
  options: {
    rpc: { type: "string", default: PUBLIC_RPC.mainnet },
    mainnet: { type: "string" },
    "max-txs": { type: "string", default: "500" },
    to: { type: "string" },
    blocks: { type: "string", default: "20000" },
    stride: { type: "string", default: "1" },
    delay: { type: "string", default: "100" },
    timeout: { type: "string", default: "60" },
    out: { type: "string" },
    debugger: { type: "string" },
    resume: { type: "boolean", default: false },
    "report-only": { type: "string" },
  },
});

// The local date names the folder: the day the run was made where it was made.
const today = new Date().toLocaleDateString("en-CA");
const reproduceCommand = (m: { rpcUrl: string; fromBlock: number; toBlock: number; stride: number }, maxTxs: number) =>
  `npm ci\nnpm run atlas -- --rpc ${m.rpcUrl} --to ${m.toBlock} --blocks ${m.toBlock - m.fromBlock + 1} --stride ${m.stride} --max-txs ${maxTxs}`;

/** Re-renders report.md from a data.json, e.g. after a change to the report layout. */
async function reportOnly(dir: string) {
  const data = JSON.parse(await readFile(join(dir, "data.json"), "utf8"));
  const atlas = aggregate(data.meta, data.transactions);
  await writeFile(join(dir, "report.md"), renderMarkdown(atlas, { reproduce: reproduceCommand(data.meta, data.summary.sampled) }));
  console.log(`wrote ${join(dir, "report.md")}`);
}

/**
 * The node, politely: at most a few requests in flight, a gap between them,
 * retries with backoff on network and gateway errors, and a cache of the
 * committed transactions and headers (cell deps repeat in almost every tx).
 */
function politeRpc(url: string, timeoutMs: number, gapMs: number): Rpc {
  const base = httpRpc(url, { timeoutMs, concurrency: 4 });
  const cache = new Map<string, Promise<unknown>>();
  const MAX_CACHE = 4000;
  let next = 0;
  const pace = async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
  const call = async <T>(method: string, params: unknown[]): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      await pace();
      try {
        return await base<T>(method, params);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /cannot reach|no answer|HTTP (429|5\d\d)|did not answer with JSON-RPC/.test(msg);
        if (!transient || attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      }
    }
  };
  return <T>(method: string, params: unknown[]) => {
    if (method !== "get_transaction" && method !== "get_header") return call<T>(method, params);
    const key = `${method}:${JSON.stringify(params)}`;
    let p = cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = call<T>(method, params).then((r) => {
        // Only a committed transaction is final; anything else is asked again next time.
        const status = (r as { tx_status?: { status?: string } } | null)?.tx_status?.status;
        if (method === "get_transaction" && status !== "committed") cache.delete(key);
        return r;
      });
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    }
    return p;
  };
}

/**
 * The cell dep that holds a group's code, and the blake2b of its data: for a
 * data* hash type the cell whose data hashes to the code hash, for "type" the
 * cell whose type script does. `memo` keeps data hashes per out point.
 */
function codeCellOf(mock: MockTransaction, codeHash: string, hashType: string, memo: Map<string, string>): { binaryHash: string; codeCell: string } | undefined {
  for (const d of mock.mock_info.cell_deps) {
    const op = `${d.cell_dep.out_point.tx_hash}:${Number(d.cell_dep.out_point.index)}`;
    let dataHash = memo.get(op);
    if (!dataHash) {
      dataHash = ccc.hashCkb(d.data);
      memo.set(op, dataHash);
    }
    const t = d.output.type;
    const match =
      hashType === "type"
        ? t !== null && ccc.Script.from({ codeHash: t.code_hash, hashType: t.hash_type as ccc.HashType, args: t.args }).hash() === codeHash
        : dataHash === codeHash;
    if (match) return { binaryHash: dataHash, codeCell: op };
  }
  return undefined;
}

async function main() {
  if (flags["report-only"]) return reportOnly(flags["report-only"]);

  const rpcUrl = flags.mainnet ?? flags.rpc!;
  const maxTxs = Number(flags["max-txs"]);
  const stride = Math.max(1, Number(flags.stride));
  const maxBlocks = Number(flags.blocks);
  const gapMs = Number(flags.delay);
  const outDir = flags.out ?? join("atlas", today);
  const rpc = politeRpc(rpcUrl, Number(flags.timeout) * 1000, gapMs);

  // The node, not a flag, says which chain it serves: the atlas is mainnet only.
  const consensus = await nodeConsensus(rpc);
  if (consensus.network !== "mainnet") throw new Error(`${rpcUrl} serves ${consensus.network}, not mainnet`);

  const debuggerPath = flags.debugger ? checkDebuggerPath(flags.debugger) : resolveDebugger();
  const exec = (args: string[]) => runNativeDebugger(debuggerPath, args);
  const version = await exec(["--version"]).then((r) => r.stdout.trim() || "unknown");
  const known = await knownScriptNames(new ccc.ClientPublicMainnet({ url: rpcUrl }));
  let toolCommit: string | undefined;
  try {
    toolCommit = execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // Not a checkout: the report just leaves it out.
  }

  await mkdir(outDir, { recursive: true });
  const progressFile = join(outDir, "progress.jsonl");
  const runFile = join(outDir, "run.json");

  // A resumed run keeps the first run's window, so the sample stays one window.
  let run: { toBlock: number; startedAt: string };
  const done = new Map<string, TxRecord>();
  if (flags.resume && existsSync(runFile)) {
    run = JSON.parse(await readFile(runFile, "utf8"));
    if (existsSync(progressFile)) {
      for (const line of (await readFile(progressFile, "utf8")).split("\n").filter(Boolean)) {
        const r = JSON.parse(line) as TxRecord;
        done.set(r.hash, r);
      }
    }
    console.log(`resuming: ${done.size} transactions already replayed`);
  } else {
    // Stay a few dozen blocks behind the tip, past any reorg.
    const tip = Number(await rpc<string>("get_tip_block_number", []));
    run = { toBlock: flags.to !== undefined ? Number(flags.to) : tip - 24, startedAt: new Date().toISOString() };
    await writeFile(runFile, JSON.stringify(run));
    await writeFile(progressFile, "");
  }

  const records: TxRecord[] = [];
  const memo = new Map<string, string>();
  const versions = new Set<number>();
  const dir = await mkdtemp(join(tmpdir(), "ckb-atlas-"));
  const txFile = join(dir, "tx.json");
  let cellbaseSkipped = 0;
  let blocksSampled = 0;
  let fromBlock = run.toBlock;
  const started = Date.now();

  try {
    // Whole blocks only, newest first: the sample is every transaction in its blocks.
    for (let n = run.toBlock; n > run.toBlock - maxBlocks && records.length < maxTxs; n -= stride) {
      const block = await rpc<{ header: { number: string; epoch: string }; transactions: (RpcTransaction & { hash: string })[] }>(
        "get_block_by_number",
        ["0x" + n.toString(16)],
      );
      blocksSampled++;
      fromBlock = n;
      const epoch = Number(BigInt(block.header.epoch) & 0xffffffn);
      const scriptVersion = scriptVersionAt(consensus.vmEpochs, epoch);
      versions.add(scriptVersion);
      for (const tx of block.transactions) {
        if (isCellbase(tx)) {
          cellbaseSkipped++;
          continue;
        }
        const prior = done.get(tx.hash);
        if (prior) {
          records.push(prior);
          continue;
        }
        const record = await replayOne(rpc, tx.hash, n, scriptVersion, rpcUrl);
        records.push(record);
        await appendFile(progressFile, JSON.stringify(record) + "\n");
        const rate = (Date.now() - started) / 1000 / Math.max(1, records.length - done.size);
        console.log(
          `[${records.length}/${maxTxs}] block ${n} ${tx.hash.slice(0, 12)} ${record.verdict} ${record.measuredCycles} cycles, ${record.groups.length} groups (${rate.toFixed(1)} s/tx)`,
        );
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  async function replayOne(rpc: Rpc, hash: string, blockNumber: number, scriptVersion: 0 | 1 | 2, rpcUrl: string): Promise<TxRecord> {
    try {
      const { mock, cycles, status } = await buildMockTransaction(rpc, hash);
      const groups = groupsOf(mock);
      const cells = groups.map((g) => codeCellOf(mock, g.codeHash, g.hashType, memo));
      groups.forEach((g, i) => (g.name = nameGroup(g, known, cells[i]?.binaryHash)));
      const plan: ReplayPlan = { hash, status, ...(cycles !== undefined && { nodeCycles: cycles }), mock, groups, scriptVersion, network: "mainnet", rpcUrl };
      await writeFile(txFile, JSON.stringify(mock));
      const profile = await replayGroups(plan, exec, { txFile, debugger: version });
      // replayGroups names Type ID itself; keep the atlas's name for it.
      const named = profile.groups.map((g, i) => ({ ...g, name: groups[i].name! }));
      return {
        hash,
        block: blockNumber,
        nodeCycles: cycles === undefined ? null : String(cycles),
        measuredCycles: String(profile.measuredCycles),
        ...verdictOf(cycles, named),
        groups: named.map((g, i) => ({
          role: g.role,
          codeHash: g.codeHash,
          hashType: g.hashType,
          label: g.name,
          cycles: String(g.cycles),
          result: g.result,
          ...(g.error && { error: g.error }),
          ...(cells[i] && { codeCell: cells[i].codeCell }),
        })),
      };
    } catch (e) {
      return { hash, block: blockNumber, nodeCycles: null, measuredCycles: "0", verdict: "error", reason: e instanceof Error ? e.message.split("\n")[0] : String(e), groups: [] };
    }
  }

  const meta: AtlasMeta = {
    rpcUrl,
    chain: consensus.chain,
    fromBlock,
    toBlock: run.toBlock,
    stride,
    blocksSampled,
    cellbaseSkipped,
    debugger: version,
    scriptVersion: Math.max(...versions),
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    ...(toolCommit && { toolCommit }),
  };
  const atlas = aggregate(meta, records);
  await writeFile(join(outDir, "data.json"), JSON.stringify(atlas, null, 1) + "\n");
  await writeFile(join(outDir, "report.md"), renderMarkdown(atlas, { reproduce: reproduceCommand(meta, records.length) }));
  const s = atlas.summary;
  console.log(`\n${s.sampled} transactions: ${s.matched} matched, ${s.mismatched} mismatch, ${s.notRecorded} not recorded, ${s.errors} errors`);
  console.log(`wrote ${join(outDir, "report.md")} and data.json`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);

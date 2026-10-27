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
 *
 * Targeted samples, added to an existing atlas folder (`--out`) as their own
 * report section: for each `--script` (a name such as xudt, omnilock, spore,
 * or a code hash with --hash-type and --role), the most recent transactions in
 * which it ran, found through the indexer RPC, up to --max-txs (default 40):
 *
 *        npm run atlas -- --out <dir> --script <name|code hash> [--script ...]
 *                         [--args <prefix>] [--hash-type <t>] [--role lock|type]
 *                         [--to <block>] [--max-window <blocks>] [--resume]
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
import {
  aggregate,
  aggregateTargeted,
  nameGroup,
  relabel,
  renderMarkdown,
  resolveTarget,
  selectRecent,
  targetSpec,
  verdictOf,
  type Atlas,
  type AtlasMeta,
  type IndexerTx,
  type Target,
  type TargetedRun,
  type TargetedSample,
  type TxRecord,
} from "./atlas-lib.js";

const { values: flags } = parseArgs({
  options: {
    rpc: { type: "string", default: PUBLIC_RPC.mainnet },
    mainnet: { type: "string" },
    "max-txs": { type: "string" },
    to: { type: "string" },
    blocks: { type: "string", default: "20000" },
    stride: { type: "string", default: "1" },
    delay: { type: "string", default: "100" },
    timeout: { type: "string", default: "60" },
    out: { type: "string" },
    debugger: { type: "string" },
    resume: { type: "boolean", default: false },
    "report-only": { type: "string" },
    script: { type: "string", multiple: true },
    args: { type: "string" },
    "hash-type": { type: "string" },
    role: { type: "string" },
    "max-window": { type: "string", default: "1000000" },
  },
});

// The local date names the folder: the day the run was made where it was made.
const today = new Date().toLocaleDateString("en-CA");
const reproduceCommand = (m: { rpcUrl: string; fromBlock: number; toBlock: number; stride: number }, maxTxs: number) =>
  `npm ci\nnpm run atlas -- --rpc ${m.rpcUrl} --to ${m.toBlock} --blocks ${m.toBlock - m.fromBlock + 1} --stride ${m.stride} --max-txs ${maxTxs}`;

const reproduceTargeted = (run: TargetedRun, dir: string) =>
  `npm run atlas -- --out ${dir.replace(/\\/g, "/")} --rpc ${run.meta.rpcUrl} --to ${run.meta.toBlock} --max-txs ${run.meta.maxTxs} \\\n  ` +
  run.samples.map((s) => `--script ${targetSpec(s.target)}`).join(" ");

/** Writes data.json and report.md for an atlas, with its targeted samples when it has them. */
async function writeAtlas(dir: string, atlas: Atlas) {
  await writeFile(join(dir, "data.json"), JSON.stringify(atlas, null, 1) + "\n");
  await writeFile(
    join(dir, "report.md"),
    renderMarkdown(atlas, {
      reproduce: reproduceCommand(atlas.meta, atlas.summary.sampled),
      ...(atlas.targeted && { reproduceTargeted: reproduceTargeted(atlas.targeted, dir) }),
    }),
  );
  console.log(`wrote ${join(dir, "report.md")} and data.json`);
}

/**
 * Rebuilds data.json's aggregates and report.md from its recorded transactions,
 * e.g. after a change to the report layout, or to name scripts identified since
 * the run. Nothing is replayed or fetched.
 */
async function reportOnly(dir: string) {
  const data = JSON.parse(await readFile(join(dir, "data.json"), "utf8")) as Atlas;
  const atlas = aggregate(data.meta, relabel(data.transactions));
  if (data.targeted) {
    atlas.targeted = {
      meta: data.targeted.meta,
      samples: data.targeted.samples.map((s) => aggregateTargeted(s.target, s.query, relabel(s.transactions))),
    };
  }
  await writeAtlas(dir, atlas);
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

/** What every replay needs: the node, the debugger, and the script names. */
interface ReplayContext {
  rpc: Rpc;
  rpcUrl: string;
  consensus: Awaited<ReturnType<typeof nodeConsensus>>;
  exec: (args: string[]) => ReturnType<typeof runNativeDebugger>;
  version: string;
  known: Map<string, string>;
  toolCommit?: string;
  /** Data hashes of cell deps, by out point. */
  memo: Map<string, string>;
  txFile: string;
}

async function replayContext(rpcUrl: string, txFile: string): Promise<ReplayContext> {
  const rpc = politeRpc(rpcUrl, Number(flags.timeout) * 1000, Number(flags.delay));
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
  return { rpc, rpcUrl, consensus, exec, version, known, toolCommit, memo: new Map(), txFile };
}

/**
 * Replays one transaction group by group and compares the sum with the node.
 * The CKB-VM version is the one of the transaction's epoch unless given.
 * Never throws: a failure is an "error" record with its reason.
 */
async function replayOne(ctx: ReplayContext, hash: string, blockNumber: number, scriptVersion?: 0 | 1 | 2): Promise<TxRecord> {
  try {
    const { mock, cycles, status, epoch } = await buildMockTransaction(ctx.rpc, hash);
    const version = scriptVersion ?? (epoch === undefined ? undefined : scriptVersionAt(ctx.consensus.vmEpochs, epoch));
    if (version === undefined) throw new Error(`transaction ${hash} is not committed (${status})`);
    const groups = groupsOf(mock);
    const cells = groups.map((g) => codeCellOf(mock, g.codeHash, g.hashType, ctx.memo));
    groups.forEach((g, i) => (g.name = nameGroup(g, ctx.known, cells[i]?.binaryHash)));
    const plan: ReplayPlan = {
      hash,
      status,
      ...(cycles !== undefined && { nodeCycles: cycles }),
      mock,
      groups,
      scriptVersion: version,
      network: "mainnet",
      rpcUrl: ctx.rpcUrl,
    };
    await writeFile(ctx.txFile, JSON.stringify(mock));
    const profile = await replayGroups(plan, ctx.exec, { txFile: ctx.txFile, debugger: ctx.version });
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

/* ------------------------------------------------------- targeted samples */

/**
 * Every indexer transaction for a script in blocks [from, to]. One prefix
 * query first; a busy script makes the indexer time out on that, so it is then
 * asked one more args byte at a time (256 smaller queries, each split again if
 * it still times out). The union is the same set of transactions either way.
 */
async function indexerTxs(rpc: Rpc, t: Target, from: number, to: number): Promise<IndexerTx[]> {
  const page = async (args: string): Promise<IndexerTx[]> => {
    const out: IndexerTx[] = [];
    let cursor: string | null = null;
    for (;;) {
      const res: { objects: IndexerTx[]; last_cursor: string } = await rpc("get_transactions", [
        {
          script: { code_hash: t.codeHash, hash_type: t.hashType, args },
          script_type: t.role,
          script_search_mode: "prefix",
          group_by_transaction: true,
          // The range's end is exclusive.
          filter: { block_range: ["0x" + from.toString(16), "0x" + (to + 1).toString(16)] },
        },
        "desc",
        "0x64",
        cursor,
      ]);
      out.push(...res.objects);
      if (res.objects.length < 100) return out;
      cursor = res.last_cursor;
    }
  };
  const search = async (args: string, depth: number): Promise<IndexerTx[]> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await page(args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/timeout/i.test(msg)) throw e;
        // Split a byte further; retry the narrowest queries a few times before giving up.
        if (depth < 2) break;
        if (attempt >= 4) throw new Error(`the indexer timed out on ${t.name} args ${args}: ${msg}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    const results: IndexerTx[] = [];
    const prefixes = Array.from({ length: 256 }, (_, i) => args + i.toString(16).padStart(2, "0"));
    // A few at a time; politeRpc still paces every request.
    for (let i = 0; i < prefixes.length; i += 4) {
      const batch = await Promise.all(prefixes.slice(i, i + 4).map((p) => search(p, depth + 1)));
      for (const b of batch) results.push(...b);
    }
    return results;
  };
  return search(t.args ?? "0x", 0);
}

/**
 * The most recent `n` transactions in which a target ran, looking back from
 * `toBlock` in a window that grows five-fold until there are enough or it
 * reaches `maxWindow` blocks.
 */
async function findRecent(rpc: Rpc, t: Target, n: number, toBlock: number, maxWindow: number) {
  for (let window = 20_000; ; window = Math.min(window * 5, maxWindow)) {
    const fromBlock = Math.max(0, toBlock - window + 1);
    const objects = await indexerTxs(rpc, t, fromBlock, toBlock);
    const all = selectRecent(objects, t.role, Number.MAX_SAFE_INTEGER);
    console.log(`  ${t.name}: ${all.length} transactions ran it in blocks ${fromBlock} to ${toBlock}`);
    if (all.length >= n || window >= maxWindow || fromBlock === 0) {
      return { selected: all.slice(0, n), query: { fromBlock, toBlock, found: all.length } };
    }
  }
}

async function runTargeted(specs: string[]) {
  const rpcUrl = flags.mainnet ?? flags.rpc!;
  const outDir = flags.out ?? join("atlas", today);
  const dataFile = join(outDir, "data.json");
  if (!existsSync(dataFile)) throw new Error(`${dataFile} not found: targeted samples are added to an existing atlas (pass --out <dir>)`);
  const maxTxs = Number(flags["max-txs"] ?? 40);
  const maxWindow = Number(flags["max-window"]);
  const targets = specs.map((spec) =>
    resolveTarget(spec, {
      ...(flags["hash-type"] && { hashType: flags["hash-type"] }),
      ...(flags.role && { role: flags.role }),
      ...(flags.args && { args: flags.args }),
    }),
  );
  const data = JSON.parse(await readFile(dataFile, "utf8")) as Atlas;

  const dir = await mkdtemp(join(tmpdir(), "ckb-atlas-"));
  const progressFile = join(outDir, "targeted-progress.jsonl");
  const ctx = await replayContext(rpcUrl, join(dir, "tx.json"));
  // Resuming keeps the replays already made, keyed by target and transaction.
  const done = new Map<string, TxRecord>();
  if (flags.resume && existsSync(progressFile)) {
    for (const line of (await readFile(progressFile, "utf8")).split("\n").filter(Boolean)) {
      const { target, record } = JSON.parse(line) as { target: string; record: TxRecord };
      done.set(`${target}|${record.hash}`, record);
    }
    console.log(`resuming: ${done.size} targeted replays already made`);
  } else {
    await writeFile(progressFile, "");
  }
  const tip = Number(await ctx.rpc<string>("get_tip_block_number", []));
  // Stay a few dozen blocks behind the tip, past any reorg.
  const toBlock = flags.to !== undefined ? Number(flags.to) : (data.targeted?.meta.toBlock ?? tip - 24);
  const startedAt = new Date().toISOString();
  const samples: TargetedSample[] = [];
  try {
    for (const t of targets) {
      console.log(`${t.name}: searching back from block ${toBlock}`);
      const { selected, query } = await findRecent(ctx.rpc, t, maxTxs, toBlock, maxWindow);
      const records: TxRecord[] = [];
      for (const { hash, block } of selected) {
        const key = `${t.name}|${hash}`;
        let record = done.get(key);
        if (!record) {
          record = await replayOne(ctx, hash, block);
          await appendFile(progressFile, JSON.stringify({ target: t.name, record }) + "\n");
        }
        records.push(record);
        console.log(`  [${records.length}/${selected.length}] block ${block} ${hash.slice(0, 12)} ${record.verdict} ${record.measuredCycles} cycles`);
      }
      const sample = aggregateTargeted(t, query, records);
      samples.push(sample);
      const m = sample.summary;
      console.log(`  ${t.name}: ${m.sampled} replayed, ${m.matched} matched, ${m.mismatched} mismatch, ${m.notRecorded} not recorded, ${m.errors} errors`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Samples of other targets from an earlier run stay; one of the same name is replaced.
  const names = new Set(samples.map((s) => s.target.name));
  const kept = (data.targeted?.samples ?? []).filter((s) => !names.has(s.target.name));
  const atlas: Atlas = { ...aggregate(data.meta, relabel(data.transactions)) };
  atlas.targeted = {
    meta: {
      rpcUrl,
      chain: ctx.consensus.chain,
      debugger: ctx.version,
      toBlock,
      maxTxs,
      startedAt: data.targeted && kept.length ? data.targeted.meta.startedAt : startedAt,
      finishedAt: new Date().toISOString(),
      ...(ctx.toolCommit && { toolCommit: ctx.toolCommit }),
    },
    samples: [...kept, ...samples],
  };
  await writeAtlas(outDir, atlas);
}

/* ---------------------------------------------------------- random sample */

async function main() {
  if (flags["report-only"]) return reportOnly(flags["report-only"]);
  if (flags.script?.length) return runTargeted(flags.script);

  const rpcUrl = flags.mainnet ?? flags.rpc!;
  const maxTxs = Number(flags["max-txs"] ?? 500);
  const stride = Math.max(1, Number(flags.stride));
  const maxBlocks = Number(flags.blocks);
  const outDir = flags.out ?? join("atlas", today);
  const dir = await mkdtemp(join(tmpdir(), "ckb-atlas-"));
  const ctx = await replayContext(rpcUrl, join(dir, "tx.json"));
  const { rpc, consensus } = ctx;

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
  const versions = new Set<number>();
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
        const record = await replayOne(ctx, tx.hash, n, scriptVersion);
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

  const meta: AtlasMeta = {
    rpcUrl,
    chain: consensus.chain,
    fromBlock,
    toBlock: run.toBlock,
    stride,
    blocksSampled,
    cellbaseSkipped,
    debugger: ctx.version,
    scriptVersion: Math.max(...versions),
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    ...(ctx.toolCommit && { toolCommit: ctx.toolCommit }),
  };
  const atlas = aggregate(meta, records);
  await writeAtlas(outDir, atlas);
  const s = atlas.summary;
  console.log(`\n${s.sampled} transactions: ${s.matched} matched, ${s.mismatched} mismatch, ${s.notRecorded} not recorded, ${s.errors} errors`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);

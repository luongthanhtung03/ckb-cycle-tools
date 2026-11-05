/**
 * The pure half of scripts/hardfork-check.ts: the record format, the verdict,
 * the fixture packing and the Markdown table. No network, no debugger, so the
 * tests can use it as is.
 */
import type { MockTransaction } from "../src/mock.js";
import { replayGroups, type ReplayPlan, type RunDebugger } from "../src/replay.js";

export type Network = "mainnet" | "testnet";
export type Fork = "mirana" | "meepo";
export type Side = "before" | "after";
/**
 * Why a transaction was picked: `secp` only the default secp256k1/blake160
 * lock runs; `type` some other `hash_type: "type"` script runs (its VM version
 * follows the block's epoch); `data` some script with `hash_type` data, data1
 * or data2 runs (its VM version is named by the hash type, not the epoch).
 */
export type Kind = "secp" | "type" | "data";

export interface Case {
  network: Network;
  fork: Fork;
  side: Side;
  kind: Kind;
  hash: string;
}

export interface GroupRecord {
  role: "lock" | "type";
  codeHash: string;
  hashType: string;
  name?: string;
  selector: string;
  /** The VM version the node runs this group on (hash type, or the block's version for "type"). */
  vm: 0 | 1 | 2;
  /** Cycles and exit code with ckb-debugger's `--script-version` set to 0, 1 and 2. */
  runs: Record<"0" | "1" | "2", { cycles: string; result: number; error?: string }>;
}

export interface CaseRecord extends Case {
  block: number;
  /** The epoch number (low 24 bits of the packed epoch) of the block. */
  epoch: number;
  /** Index of the transaction in its block (0 is the cellbase). */
  index: number;
  /** The epoch the fork activated at, from the node's get_consensus. */
  forkEpoch: number;
  /**
   * What each node asked said: `tx` is `cycles` from get_transaction, `block`
   * the block's entry for it from get_block with `with_cycles`, both as the
   * node returned them (hex), null when absent.
   */
  nodes: NodeCycles[];
  /** `cycles` from the Nervos explorer API, or null when it gave none. */
  explorerCycles: string | null;
  /** The CKB-VM version the replay chose for `hash_type: "type"` scripts (planReplay). */
  scriptVersion: 0 | 1 | 2;
  groups: GroupRecord[];
  /** Sum of the groups at the chosen version: what `ckb-cycles <hash>` reports. */
  sum: string;
  /** The sum with `--script-version` 0, 1 and 2, every group run on it. */
  sums: Record<"0" | "1" | "2", string>;
  /** Where the total compared with came from. */
  oracle: "node" | "explorer" | null;
  /** With oracle "node": the node whose number it is. */
  oracleUrl?: string;
  /** When a node and the explorer both have a total: whether they agree. */
  explorerAgrees?: boolean;
  total: string | null;
  verdict: "match" | "mismatch" | "no total";
  /** The `--script-version` values whose sum equals the total (all accepting). */
  versionsMatching: number[];
}

export interface NodeCycles {
  url: string;
  tx: string | null;
  block: string | null;
}

export interface HardforkData {
  meta: {
    startedAt: string;
    finishedAt: string;
    debugger: string;
    toolCommit?: string;
    rpc: Record<Network, string>;
    /** Further nodes asked for block cycles, in order, after `rpc`. */
    cyclesRpc: Record<Network, string[]>;
    explorer: Record<Network, string>;
    /** Fork epochs and their first blocks, per network, from get_consensus and get_epoch_by_number. */
    forks: Record<Network, Record<Fork, { epoch: number; startBlock: number }>>;
  };
  cases: CaseRecord[];
}

const VERSIONS = ["0", "1", "2"] as const;

/** The VM version the node selects for one script (ckb-script TxData::select_version). */
export function vmOf(hashType: string, typeVersion: 0 | 1 | 2): 0 | 1 | 2 {
  if (hashType === "data") return 0;
  if (hashType === "data1") return 1;
  if (hashType === "data2") return 2;
  return typeVersion;
}

export interface VersionRun {
  name?: string;
  cycles: string;
  result: number;
  error?: string;
}

/**
 * Every group of a plan run with `--script-version` forced to `version`, one
 * debugger run per group. A group the debugger cannot run at that version at
 * all (it panics with InvalidVmVersion for a data1 script on v0, as the node
 * refuses one before its fork) is recorded as a VM error, not thrown.
 */
export async function runAtVersion(
  plan: ReplayPlan,
  version: 0 | 1 | 2,
  run: RunDebugger,
  options: { txFile: string; debugger: string },
): Promise<VersionRun[]> {
  const out: VersionRun[] = [];
  for (const g of plan.groups) {
    try {
      const p = await replayGroups({ ...plan, groups: [g], scriptVersion: version }, run, options);
      const r = p.groups[0];
      out.push({ ...(r.name && { name: r.name }), cycles: String(r.cycles), result: r.result, ...(r.error && { error: r.error.split("\n")[0].slice(0, 200) }) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const why = /InvalidVmVersion\(\d\)/.exec(msg)?.[0] ?? msg.split("\n")[0].slice(0, 200);
      out.push({ cycles: "0", result: -1, error: `ckb-debugger could not run it: ${why}` });
    }
  }
  return out;
}

const nonZero = (hex: string | null) => (hex !== null && BigInt(hex) > 0n ? BigInt(hex) : undefined);

/**
 * The total to compare with: the node's own number when it has one (some
 * public nodes report 0x0 for old blocks: unknown, not zero), else the
 * explorer's.
 */
export function oracleOf(r: Pick<CaseRecord, "nodes" | "explorerCycles">): {
  oracle: CaseRecord["oracle"];
  oracleUrl?: string;
  total: bigint | undefined;
  explorerAgrees?: boolean;
} {
  const explorer = r.explorerCycles === null || BigInt(r.explorerCycles) === 0n ? undefined : BigInt(r.explorerCycles);
  for (const n of r.nodes) {
    const total = nonZero(n.tx) ?? nonZero(n.block);
    if (total !== undefined) {
      return { oracle: "node", oracleUrl: n.url, total, ...(explorer !== undefined && { explorerAgrees: explorer === total }) };
    }
  }
  if (explorer !== undefined) return { oracle: "explorer", total: explorer };
  return { oracle: null, total: undefined };
}

/** Fills sum, sums, oracle, total, verdict and versionsMatching from the groups. */
export function judge(
  r: Omit<CaseRecord, "sum" | "sums" | "oracle" | "oracleUrl" | "explorerAgrees" | "total" | "verdict" | "versionsMatching">,
): CaseRecord {
  const sumAt = (v: (typeof VERSIONS)[number]) => r.groups.reduce((s, g) => s + BigInt(g.runs[v].cycles), 0n);
  const okAt = (v: (typeof VERSIONS)[number]) => r.groups.every((g) => g.runs[v].result === 0 && !g.runs[v].error);
  const sums = { "0": String(sumAt("0")), "1": String(sumAt("1")), "2": String(sumAt("2")) };
  const chosen = String(r.scriptVersion) as (typeof VERSIONS)[number];
  const { oracle, oracleUrl, total, explorerAgrees } = oracleOf(r);
  const accepted = okAt(chosen);
  const verdict = total === undefined ? "no total" : accepted && BigInt(sums[chosen]) === total ? "match" : "mismatch";
  const versionsMatching =
    total === undefined ? [] : VERSIONS.filter((v) => okAt(v) && BigInt(sums[v]) === total).map(Number);
  return {
    ...r,
    sum: sums[chosen],
    sums,
    oracle,
    ...(oracleUrl && { oracleUrl }),
    ...(explorerAgrees !== undefined && { explorerAgrees }),
    total: total === undefined ? null : String(total),
    verdict,
    versionsMatching,
  };
}

/* ------------------------------------------------------------ fixtures */

/** Recorded mocks, with large cell data stored once (the secp256k1 table is in almost every one). */
export interface PackedFixture {
  blobs: Record<string, string>;
  cases: (CaseRecord & { mock: MockTransaction })[];
}

const BLOB_MIN = 4096;

/** Replaces every data field of at least 4 KiB with `blob:<index>`, the data kept once in `blobs`. */
export function packFixture(cases: (CaseRecord & { mock: MockTransaction })[]): PackedFixture {
  const blobs: Record<string, string> = {};
  const ids = new Map<string, string>();
  const ref = (data: string) => {
    if (data.length < BLOB_MIN * 2) return data;
    let id = ids.get(data);
    if (!id) {
      id = String(ids.size);
      ids.set(data, id);
      blobs[id] = data;
    }
    return `blob:${id}`;
  };
  return {
    blobs,
    cases: cases.map((c) => ({
      ...c,
      mock: {
        mock_info: {
          inputs: c.mock.mock_info.inputs.map((i) => ({ ...i, data: ref(i.data) })),
          cell_deps: c.mock.mock_info.cell_deps.map((d) => ({ ...d, data: ref(d.data) })),
          header_deps: c.mock.mock_info.header_deps,
        },
        tx: { ...c.mock.tx, outputs_data: c.mock.tx.outputs_data.map(ref) },
      },
    })),
  };
}

/** The inverse of packFixture. */
export function unpackFixture(p: PackedFixture): (CaseRecord & { mock: MockTransaction })[] {
  const deref = (data: string) => {
    if (!data.startsWith("blob:")) return data;
    const blob = p.blobs[data.slice(5)];
    if (blob === undefined) throw new Error(`fixture: missing ${data}`);
    return blob;
  };
  return p.cases.map((c) => ({
    ...c,
    mock: {
      mock_info: {
        inputs: c.mock.mock_info.inputs.map((i) => ({ ...i, data: deref(i.data) })),
        cell_deps: c.mock.mock_info.cell_deps.map((d) => ({ ...d, data: deref(d.data) })),
        header_deps: c.mock.mock_info.header_deps,
      },
      tx: { ...c.mock.tx, outputs_data: c.mock.tx.outputs_data.map(deref) },
    },
  }));
}

/* ------------------------------------------------------------ report */

export const EXPLORER_PAGE: Record<Network, string> = {
  mainnet: "https://explorer.nervos.org/transaction/",
  testnet: "https://testnet.explorer.nervos.org/transaction/",
};

const FORK_NAME: Record<Fork, string> = { mirana: "Mirana (CKB2021, VM v1)", meepo: "Meepo (CKB2023, VM v2)" };
const fmt = (s: string | null) => (s === null ? "—" : BigInt(s).toLocaleString("en-US"));
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const fmtHex = (s: string | null) => (s === null ? "null" : `\`${s}\``);

/** The VM each group ran on, compressed: e.g. "type v1, data v0". */
export function vmSummary(r: CaseRecord): string {
  const seen = new Map<string, number>();
  for (const g of r.groups) seen.set(g.hashType, g.vm);
  return [...seen].map(([h, v]) => `${h} v${v}`).join(", ") || "—";
}

/** One line per other version: what the sum would have been, and whether it matches. */
function otherVersions(r: CaseRecord): string {
  return (["0", "1", "2"] as const)
    .filter((v) => Number(v) !== r.scriptVersion)
    .map((v) => {
      const failed = r.groups.some((g) => g.runs[v].result !== 0 || g.runs[v].error);
      const s = failed ? "rejects" : fmt(r.sums[v]);
      const eq = r.total !== null && !failed && r.sums[v] === r.total ? " (=)" : "";
      return `v${v}: ${s}${eq}`;
    })
    .join("; ");
}

export function renderMarkdown(data: HardforkData, reproduce: string): string {
  const { meta, cases } = data;
  const lines: string[] = [];
  const counts = { match: 0, mismatch: 0, "no total": 0 } as Record<CaseRecord["verdict"], number>;
  for (const c of cases) counts[c.verdict]++;
  lines.push(
    "<!-- Generated by scripts/hardfork-check.ts from compat/hardfork.json; the prose sections are kept by hand in this file's header. -->",
    "",
    "## Results",
    "",
    `Run ${meta.startedAt} to ${meta.finishedAt} with ${meta.debugger}${meta.toolCommit ? ` at commit \`${meta.toolCommit.slice(0, 12)}\`` : ""}.`,
    `Nodes: ${meta.rpc.mainnet} (mainnet), ${meta.rpc.testnet} (testnet). Explorer API: ${meta.explorer.mainnet}, ${meta.explorer.testnet}.`,
    "",
    `${cases.length} transactions: ${counts.match} match, ${counts.mismatch} mismatch, ${counts["no total"]} with no total to compare.`,
    "",
    "Fork epochs, from each node's `get_consensus` (`hardfork_features`, RFC 0032 and RFC 0049), and the first block of that epoch (`get_epoch_by_number`):",
    "",
    "| Network | Fork | Epoch | First block |",
    "|---|---|---|---|",
  );
  for (const net of ["mainnet", "testnet"] as const) {
    for (const fork of ["mirana", "meepo"] as const) {
      const f = meta.forks[net]?.[fork];
      if (f) lines.push(`| ${net} | ${FORK_NAME[fork]} | ${f.epoch} | ${f.startBlock.toLocaleString("en-US")} |`);
    }
  }
  lines.push(
    "",
    `Node totals: one line per node asked, for each network first ${hostOf(meta.rpc.mainnet)} / ${hostOf(meta.rpc.testnet)}, then ${[...meta.cyclesRpc.mainnet, ...meta.cyclesRpc.testnet].map(hostOf).join(", ")}: ` +
      "`cycles` from `get_transaction` / the block's entry from `get_block` with `with_cycles`, raw (null: absent). The first non-zero one is the total compared with; with none, the explorer's. Explorer total: `cycles` from the Nervos explorer API. Our sum: the per-group cycles at the VM version the replay chose, what `ckb-cycles <hash>` prints. VM: the version each hash type ran on. Other VMs: the sum with ckb-debugger's `--script-version` forced to the other values, every group; `(=)` marks one that would also have matched, so that transaction does not tell the versions apart.",
    "",
    "| Network | Fork | Side | Kind | Block | Epoch | Transaction | Node totals (tx / block) | Explorer total | Our sum | VM | Result | Other VMs |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const c of cases) {
    const link = `[${c.hash.slice(0, 10)}…](${EXPLORER_PAGE[c.network]}${c.hash})`;
    const node = c.nodes.map((n) => `${fmtHex(n.tx)} / ${fmtHex(n.block)}`).join("<br>");
    const against = c.oracle === "node" ? `node ${hostOf(c.oracleUrl!)}` : c.oracle;
    const result = c.verdict === "match" ? `match (${against})` : c.verdict === "mismatch" ? `**mismatch** (${against})` : "no total";
    lines.push(
      `| ${c.network} | ${c.fork} | ${c.side} | ${c.kind} | ${c.block.toLocaleString("en-US")} | ${c.epoch} | ${link} | ${node} | ${fmt(c.explorerCycles)} | ${fmt(c.sum)} | ${vmSummary(c)} | ${result} | ${otherVersions(c)} |`,
    );
  }
  lines.push("", "### Groups", "");
  for (const c of cases) {
    lines.push(`- \`${c.hash}\` (${c.network}, block ${c.block}, epoch ${c.epoch}, tx ${c.index}):`);
    for (const g of c.groups) {
      const runs = (["0", "1", "2"] as const)
        .map((v) => {
          const run = g.runs[v];
          return `v${v} ${run.result === 0 && !run.error ? BigInt(run.cycles).toLocaleString("en-US") : run.error ? "VM error" : `exit ${run.result}`}`;
        })
        .join(", ");
      lines.push(`  - ${g.role} ${g.name ?? g.codeHash.slice(0, 18) + "…"} (${g.hashType}, runs on v${g.vm}): ${runs}`);
    }
  }
  lines.push("", "### Reproduce", "", "```sh", reproduce, "```", "");
  return lines.join("\n");
}

/**
 * The pure half of the mainnet cycle atlas (scripts/atlas.ts): naming script
 * groups, aggregating per-group cycles by script, and rendering the report.
 * No network and no ckb-debugger here, so the tests run it on fixtures.
 */

/** One script group of a replayed transaction, as the atlas records it. */
export interface GroupRecord {
  role: "lock" | "type";
  codeHash: string;
  hashType: string;
  /** Display name, from nameGroup. */
  label: string;
  /** Decimal string: cycles do not fit a JSON number safely. */
  cycles: string;
  /** Exit code; 0 accepted. */
  result: number;
  error?: string;
  /** The cell dep holding the script's code, `txHash:index`; absent for Type ID (built in). */
  codeCell?: string;
}

/** One sampled transaction and how its replay compared with the node. */
export interface TxRecord {
  hash: string;
  block: number;
  /** The node's total, decimal; null when the node did not record it (0x0). */
  nodeCycles: string | null;
  /** Sum of the groups ckb-debugger measured, decimal. */
  measuredCycles: string;
  /**
   * match: the groups add up to the node's total and every group accepted.
   * mismatch: they do not (or a group rejected a committed transaction).
   * not-recorded: the node gave no total to compare with.
   * error: the replay could not run (RPC or ckb-debugger failure).
   * Only "match" is aggregated; every other record is counted and listed.
   */
  verdict: "match" | "mismatch" | "not-recorded" | "error";
  reason?: string;
  groups: GroupRecord[];
}

export interface AtlasMeta {
  rpcUrl: string;
  chain: string;
  /** Lowest and highest block sampled, inclusive. */
  fromBlock: number;
  toBlock: number;
  /** Every `stride`-th block in the range was sampled; 1 means every block. */
  stride: number;
  blocksSampled: number;
  /** Cellbase transactions in the sampled blocks: they run no scripts. */
  cellbaseSkipped: number;
  debugger: string;
  scriptVersion: number;
  /** ISO date-time the run started and finished. */
  startedAt: string;
  finishedAt: string;
  /** The ckb-cycle-tools commit the run used, when known. */
  toolCommit?: string;
}

export interface ScriptRow {
  label: string;
  role: "lock" | "type";
  codeHash: string;
  hashType: string;
  /** Script groups measured (one per transaction where the script ran). */
  groups: number;
  min: string;
  median: string;
  p90: string;
  max: string;
  total: string;
  /** Share of all cycles of the matched transactions, 0..1. */
  share: number;
  /** The transaction whose group cost is closest to the median. */
  exampleTx: string;
  /** The cell dep the script's code was loaded from, first seen. */
  codeCell?: string;
}

export interface Distribution {
  count: number;
  min: string;
  median: string;
  p90: string;
  max: string;
  total: string;
}

export interface Atlas {
  meta: AtlasMeta;
  summary: {
    sampled: number;
    matched: number;
    mismatched: number;
    notRecorded: number;
    errors: number;
  };
  /** Total cycles per matched transaction. */
  txCycles: Distribution;
  /** Matched transactions by the scripts that ran in them, commonest first. */
  combinations: { scripts: string; transactions: number; medianCycles: string }[];
  scripts: ScriptRow[];
  /** Everything not aggregated, with why: never silently dropped. */
  excluded: { hash: string; block: number; verdict: TxRecord["verdict"]; nodeCycles: string | null; measuredCycles: string; reason?: string }[];
  transactions: TxRecord[];
}

/* ------------------------------------------------------------------ naming */

/** CCC's KnownScript names → the names people use for them. */
const DISPLAY: Record<string, string> = {
  Secp256k1Blake160: "secp256k1_blake160",
  Secp256k1Multisig: "secp256k1_multisig (legacy)",
  Secp256k1MultisigV2Beta: "secp256k1_multisig v2 beta",
  Secp256k1MultisigV2: "secp256k1_multisig v2",
  AnyoneCanPay: "anyone-can-pay",
  NervosDao: "Nervos DAO",
  TypeId: "Type ID",
  SUdt: "sUDT",
  XUdt: "xUDT",
  JoyId: "JoyID",
  OmniLock: "Omnilock",
};

/**
 * Mainnet scripts CCC core does not list, from @ckb-ccc/spore's
 * SCRIPTS_SPORE_MAINNET and SCRIPTS_CLUSTER_MAINNET (codeHash:hashType).
 */
export const EXTRA_MAINNET_SCRIPTS: Record<string, string> = {
  "0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5:data1": "Spore",
  "0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075:data1": "Spore Cluster",
  "0xcfba73b58b6f30e70caed8a999748781b164ef9a1e218424a6fb55ebf641cb33:type": "Spore (DID)",
};

/**
 * Binaries recognised by content (blake2b of the code cell's data), whatever
 * the code hash points to them by: ckb-js-vm as shipped in ckb-testtool 1.0.5.
 * A different ckb-js-vm build is not recognised and shows as unknown.
 */
export const KNOWN_BINARIES: Record<string, string> = {
  "0xbeb3f510a608fbe97654da3dddb35b0214f3dcec6e252141720e9c9c32a6a461": "CKB-JS-VM",
};

/**
 * Omnilock's auth flag (the first byte of its args) → the signature scheme,
 * as numbered in ckb-auth (AuthAlgorithmIdType).
 */
export const OMNILOCK_AUTH: Record<number, string> = {
  0x00: "CKB secp256k1",
  0x01: "Ethereum",
  0x02: "EOS",
  0x03: "Tron",
  0x04: "Bitcoin",
  0x05: "Dogecoin",
  0x06: "CKB multisig",
  0x07: "Schnorr",
  0x08: "RSA",
  0x09: "ISO 9796-2",
  0x0a: "Litecoin",
  0x0b: "Cardano",
  0x0c: "Monero",
  0x0d: "Solana",
  0x0e: "Ripple",
  0x0f: "secp256r1",
  0x12: "Ethereum displaying",
  0xfc: "owner lock",
  0xfd: "exec",
  0xfe: "dynamic linking",
};

/**
 * Omnilock args: auth flag (1 byte) ‖ auth content (20) ‖ omnilock flags (1)
 * ‖ optional fields. The mode is the auth scheme, plus "ACP" when the
 * anyone-can-pay flag (0b10) is set. Undefined when the args are too short.
 */
export function omnilockMode(args: string): string | undefined {
  const hex = args.replace(/^0x/, "");
  if (hex.length < 42) return undefined;
  const auth = parseInt(hex.slice(0, 2), 16);
  const scheme = OMNILOCK_AUTH[auth] ?? `auth 0x${hex.slice(0, 2)}`;
  const flags = hex.length >= 44 ? parseInt(hex.slice(42, 44), 16) : 0;
  return flags & 0b10 ? `${scheme}, ACP` : scheme;
}

/**
 * A group's display name. `known` maps codeHash:hashType (lowercase) to a CCC
 * KnownScript name or a display name; `binaryHash` is the blake2b of the code
 * cell's data, when it was found. Unknown scripts are named by their code hash.
 */
export function nameGroup(
  g: { role: string; codeHash: string; hashType: string; args: string },
  known: ReadonlyMap<string, string>,
  binaryHash?: string,
): string {
  const key = `${g.codeHash.toLowerCase()}:${g.hashType}`;
  const raw = known.get(key) ?? EXTRA_MAINNET_SCRIPTS[key];
  if (raw === "OmniLock") {
    const mode = omnilockMode(g.args);
    return mode ? `Omnilock (${mode})` : "Omnilock";
  }
  if (raw) return DISPLAY[raw] ?? raw;
  const binary = binaryHash && KNOWN_BINARIES[binaryHash.toLowerCase()];
  if (binary) return binary;
  return `unknown ${g.codeHash.slice(0, 10)}…${g.codeHash.slice(-4)}`;
}

/* ------------------------------------------------------------- aggregation */

/** Nearest-rank percentile of sorted values: always a value that was observed. */
export function percentile(sorted: readonly bigint[], p: number): bigint {
  if (!sorted.length) throw new Error("percentile of nothing");
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
const abs = (n: bigint) => (n < 0n ? -n : n);

function distribution(values: bigint[]): Distribution {
  const sorted = [...values].sort(cmp);
  if (!sorted.length) return { count: 0, min: "0", median: "0", p90: "0", max: "0", total: "0" };
  return {
    count: sorted.length,
    min: String(sorted[0]),
    median: String(percentile(sorted, 50)),
    p90: String(percentile(sorted, 90)),
    max: String(sorted.at(-1)),
    total: String(sorted.reduce((s, v) => s + v, 0n)),
  };
}

/**
 * Builds the atlas from the sampled transactions. Only "match" records are
 * aggregated; every other one goes to `excluded` with its reason. Rows are
 * keyed by role, code hash, hash type and label (so each Omnilock auth mode is
 * its own row), and sorted by total cycles, largest first.
 */
export function aggregate(meta: AtlasMeta, records: TxRecord[]): Atlas {
  const matched = records.filter((r) => r.verdict === "match");
  const grandTotal = matched.reduce((s, r) => s + BigInt(r.measuredCycles), 0n);

  const rows = new Map<
    string,
    { label: string; role: "lock" | "type"; codeHash: string; hashType: string; codeCell?: string; samples: { cycles: bigint; tx: string }[] }
  >();
  for (const r of matched) {
    for (const g of r.groups) {
      const key = `${g.role}|${g.codeHash}|${g.hashType}|${g.label}`;
      let row = rows.get(key);
      if (!row) {
        row = { label: g.label, role: g.role, codeHash: g.codeHash, hashType: g.hashType, samples: [] };
        rows.set(key, row);
      }
      row.codeCell ??= g.codeCell;
      row.samples.push({ cycles: BigInt(g.cycles), tx: r.hash });
    }
  }

  const scripts: ScriptRow[] = [...rows.values()].map((row) => {
    const d = distribution(row.samples.map((s) => s.cycles));
    const median = BigInt(d.median);
    // The first sample nearest the median: a real transaction to look at.
    const example = row.samples.reduce((best, s) => (abs(s.cycles - median) < abs(best.cycles - median) ? s : best));
    return {
      label: row.label,
      role: row.role,
      codeHash: row.codeHash,
      hashType: row.hashType,
      groups: d.count,
      min: d.min,
      median: d.median,
      p90: d.p90,
      max: d.max,
      total: d.total,
      share: grandTotal ? Number((BigInt(d.total) * 1_000_000n) / grandTotal) / 1_000_000 : 0,
      exampleTx: example.tx,
      ...(row.codeCell && { codeCell: row.codeCell }),
    };
  });
  scripts.sort((a, b) => cmp(BigInt(b.total), BigInt(a.total)) || b.groups - a.groups || a.label.localeCompare(b.label));

  const excluded = records
    .filter((r) => r.verdict !== "match")
    .map((r) => ({
      hash: r.hash,
      block: r.block,
      verdict: r.verdict,
      nodeCycles: r.nodeCycles,
      measuredCycles: r.measuredCycles,
      ...(r.reason && { reason: r.reason }),
    }));

  return {
    meta,
    summary: {
      sampled: records.length,
      matched: matched.length,
      mismatched: records.filter((r) => r.verdict === "mismatch").length,
      notRecorded: records.filter((r) => r.verdict === "not-recorded").length,
      errors: records.filter((r) => r.verdict === "error").length,
    },
    txCycles: distribution(matched.map((r) => BigInt(r.measuredCycles))),
    combinations: combinationsOf(matched),
    scripts,
    excluded,
    transactions: records,
  };
}

/** "secp256k1_blake160 + xUDT", with "3 x " for a script that ran as several groups. */
export function combinationOf(r: TxRecord): string {
  const counts = new Map<string, number>();
  for (const g of r.groups) counts.set(g.label, (counts.get(g.label) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, n]) => (n > 1 ? `${n} x ${label}` : label))
    .join(" + ");
}

function combinationsOf(matched: TxRecord[]): Atlas["combinations"] {
  const by = new Map<string, bigint[]>();
  for (const r of matched) {
    const k = combinationOf(r);
    by.set(k, [...(by.get(k) ?? []), BigInt(r.measuredCycles)]);
  }
  return [...by]
    .map(([scripts, cycles]) => ({ scripts, transactions: cycles.length, medianCycles: String(percentile([...cycles].sort(cmp), 50)) }))
    .sort((a, b) => b.transactions - a.transactions || a.scripts.localeCompare(b.scripts));
}

/**
 * The verdict for one replayed transaction: a match needs the node's total,
 * the same sum, and every group accepting.
 */
export function verdictOf(nodeCycles: bigint | undefined, groups: { cycles: bigint; result: number; error?: string }[]): Pick<TxRecord, "verdict" | "reason"> {
  const measured = groups.reduce((s, g) => s + g.cycles, 0n);
  const rejected = groups.find((g) => g.result !== 0 || g.error);
  if (rejected) return { verdict: "mismatch", reason: `a group rejected on replay: ${rejected.error ?? `exit ${rejected.result}`}` };
  if (nodeCycles === undefined) return { verdict: "not-recorded", reason: "the node reports no cycles for this transaction" };
  if (nodeCycles !== measured) return { verdict: "mismatch", reason: `measured ${measured} vs node ${nodeCycles} (${measured - nodeCycles > 0n ? "+" : ""}${measured - nodeCycles})` };
  return { verdict: "match" };
}

/* --------------------------------------------------------------- rendering */

const num = (s: string | bigint) => BigInt(s).toLocaleString("en-US");
const pct = (x: number) => (x > 0 && x < 0.0001 ? "<0.01%" : `${(x * 100).toFixed(x >= 0.001 || x === 0 ? 1 : 2)}%`);
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const txLink = (h: string) => `[${shortHash(h)}](https://explorer.nervos.org/transaction/${h})`;

/** The markdown report for an atlas. Plain text and tables, no emoji. */
export function renderMarkdown(a: Atlas, opts: { reproduce?: string } = {}): string {
  const m = a.meta;
  const s = a.summary;
  const range = m.stride === 1 ? `${m.fromBlock} to ${m.toBlock}` : `${m.fromBlock} to ${m.toBlock}, every ${m.stride}th block`;
  const lines: string[] = [];
  lines.push(`# CKB mainnet cycle atlas: blocks ${m.fromBlock} to ${m.toBlock}`);
  lines.push("");
  lines.push(
    `What the scripts in recent CKB mainnet transactions cost in cycles, measured per script group by replaying ` +
      `each transaction in ckb-debugger with [ckb-cycle-tools](../../README.md). A transaction counts only when ` +
      `its groups add up exactly to the cycles the node reported for it; anything else is listed under Excluded, ` +
      `not dropped.`,
  );
  lines.push("");
  lines.push("## Sample");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Node | ${m.rpcUrl} (chain \`${m.chain}\`) |`);
  lines.push(`| Blocks | ${range} (${m.blocksSampled} blocks) |`);
  lines.push(`| Transactions replayed | ${s.sampled} (${m.cellbaseSkipped} cellbase transactions skipped: they run no scripts) |`);
  lines.push(`| Matched the node exactly | ${s.matched} |`);
  lines.push(`| Excluded | ${s.mismatched} mismatch, ${s.notRecorded} not recorded by the node, ${s.errors} could not be replayed |`);
  lines.push(`| ckb-debugger | ${m.debugger}, CKB-VM version ${m.scriptVersion} |`);
  lines.push(`| Run | ${m.startedAt} to ${m.finishedAt}${m.toolCommit ? `, ckb-cycle-tools ${m.toolCommit.slice(0, 7)}` : ""} |`);
  lines.push("");
  const t = a.txCycles;
  if (t.count) {
    lines.push(
      `Per matched transaction: median ${num(t.median)} cycles, p90 ${num(t.p90)}, min ${num(t.min)}, max ${num(t.max)}; ` +
        `${num(t.total)} cycles in all.`,
    );
    lines.push("");
  }
  lines.push("## Cost per script group");
  lines.push("");
  lines.push(
    "One row per script (code hash and hash type; Omnilock split by auth mode). Groups: how many times the script " +
      "ran as a group, which is once per transaction for most scripts. Share: its part of all cycles in the matched " +
      "transactions. Median and p90 are nearest-rank, so each is a cost that was actually measured. The example is " +
      "the transaction whose group cost is closest to the median.",
  );
  lines.push("");
  lines.push("| Script | Role | Groups | Min | Median | p90 | Max | Share | Example |");
  lines.push("|---|---|--:|--:|--:|--:|--:|--:|---|");
  for (const r of a.scripts) {
    lines.push(
      `| ${r.label} | ${r.role} | ${r.groups} | ${num(r.min)} | ${num(r.median)} | ${num(r.p90)} | ${num(r.max)} | ${pct(r.share)} | ${txLink(r.exampleTx)} |`,
    );
  }
  lines.push("");
  lines.push("Code hashes, and the cell each script's code was loaded from:");
  lines.push("");
  const seen = new Set<string>();
  for (const r of a.scripts) {
    const k = `${r.codeHash}:${r.hashType}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const labels = [...new Set(a.scripts.filter((x) => `${x.codeHash}:${x.hashType}` === k).map((x) => x.label.replace(/ \(.*\)$/, "")))];
    const cell = r.codeCell ? `, code in ${txLink(r.codeCell.split(":")[0])} output ${r.codeCell.split(":")[1]}` : "";
    lines.push(`- ${labels.join(", ")}: \`${r.codeHash}\` (${r.hashType})${cell}`);
  }
  lines.push("");
  if (a.combinations.length) {
    lines.push("## What ran together");
    lines.push("");
    lines.push("Matched transactions by the scripts that ran in them (\"2 x\" is one script running as two groups, e.g. inputs with two different owners).");
    lines.push("");
    lines.push("| Scripts | Transactions | Median cycles |");
    lines.push("|---|--:|--:|");
    for (const c of a.combinations.slice(0, 10)) lines.push(`| ${c.scripts} | ${c.transactions} | ${num(c.medianCycles)} |`);
    if (a.combinations.length > 10) lines.push(`| ${a.combinations.length - 10} other combinations | ${a.combinations.slice(10).reduce((s, c) => s + c.transactions, 0)} | |`);
    lines.push("");
  }
  lines.push("## Excluded");
  lines.push("");
  if (!a.excluded.length) {
    lines.push("None: every sampled transaction matched the node's total exactly.");
  } else {
    lines.push("| Transaction | Block | Verdict | Node | Measured | Reason |");
    lines.push("|---|--:|---|--:|--:|---|");
    for (const e of a.excluded) {
      lines.push(
        `| ${txLink(e.hash)} | ${e.block} | ${e.verdict} | ${e.nodeCycles === null ? "-" : num(e.nodeCycles)} | ${num(e.measuredCycles)} | ${(e.reason ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200)} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Method and limits");
  lines.push("");
  lines.push(
    "- Each transaction is rebuilt as a ckb-debugger mock transaction from the node (input cells, cell deps with dep " +
      "groups expanded, header deps), then every script group runs once in the native ckb-debugger, on the CKB-VM " +
      "version of the transaction's epoch. Type ID is verified natively by the node and charged its fixed 1,000,000 " +
      "cycles, as the node does.",
  );
  lines.push(
    "- The sample is every non-cellbase transaction in a window of recent blocks, so it reflects what was busy on " +
      "mainnet in that window, not all of mainnet history. A different window will give different shares.",
  );
  lines.push(
    "- Names come from CCC's mainnet table of known scripts, plus Spore and Cluster from @ckb-ccc/spore. Scripts it " +
      "does not know show as unknown with their code hash; Omnilock's mode is read from the first byte of its args.",
  );
  lines.push("- The raw per-transaction results are in data.json next to this file.");
  if (opts.reproduce) {
    lines.push("");
    lines.push("## Reproduce");
    lines.push("");
    lines.push("```");
    lines.push(opts.reproduce);
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}

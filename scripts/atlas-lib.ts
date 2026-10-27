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
  /** The targeted samples (`--script`), kept apart from the random sample above. */
  targeted?: TargetedRun;
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
 * Mainnet scripts CCC core does not list (codeHash:hashType), each with where
 * its code hash is published. A script is named here only when a public source
 * gives this exact code hash, or the chain ties it to one that does.
 */
export const EXTRA_MAINNET_SCRIPTS: Record<string, string> = {
  // @ckb-ccc/spore SCRIPTS_SPORE_MAINNET and SCRIPTS_CLUSTER_MAINNET.
  "0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5:data1": "Spore",
  "0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075:data1": "Spore Cluster",
  "0xcfba73b58b6f30e70caed8a999748781b164ef9a1e218424a6fb55ebf641cb33:type": "Spore (DID)",
  // d.id's on-chain time oracle (ckb-time-script): github.com/dotbitHQ/ckb-time-script
  // migrations/mainnet/2021-08-24-000000.json gives both type IDs and code cell data
  // hashes, and dotbitHQ/ckb-time-generator config/mainnet.yaml uses them with the
  // code cells the atlas loads them from (0xae3197c3…:0 and 0x3ba4c4b6…:0).
  "0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43:type": "d.id time oracle (index state)",
  "0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79:type": "d.id time oracle (info)",
  // The Bitcoin SPV light client (utxostack/ckb-bitcoin-spv-contracts, the binary is
  // ckb-bitcoin-spv-type-lock). The RGB++ lock's config cell (0xcb4d9f97…:1, the
  // current version of the config dep published in utxostack/rgbpp-sdk) names the
  // client's type script hash 0xd0cd2ad2…, which is this code hash with the client
  // args; RGB++ lock transactions carry that client cell as a cell dep.
  "0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d:type": "Bitcoin SPV client (RGB++)",
  // d.id (formerly .bit) account system: dotbitHQ/did-config config.yaml lists das-lock
  // by this code hash, and the ConfigCellMain witness in dotbitHQ/das_parser_tool's
  // README has this hash first in its TypeIdTable, which das-types schemas/cell.mol
  // defines as account_cell.
  "0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137:type": "d.id das-lock",
  "0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918:type": "d.id AccountCell type",
  // utxostack/rgbpp-sdk packages/ckb/src/constants/index.ts, MainnetInfo.
  "0xbc6c568a1a0d0a09f6844dc9d74ddb4343c32143ff25f727c59edf4fb72d6936:type": "RGB++ lock",
  "0x70d64497a075bd651e98ac030455ea200637ee325a12ad08aff03f1a117e5a62:type": "BTC time lock (RGB++)",
  // utxostack/rgbpp-sdk COMPATIBLE_XUDT_TYPE_SCRIPTS ("RUSD Mainnet", "USDI Mainnet").
  "0x26a33e0815888a4a0614a0b7d09fa951e0993ff21e55905510104a0b1312032b:type": "RUSD (xUDT compatible)",
  "0xbfa35a9c38a676682b65ade8f02be164d48632281477e36f8dc2f41f79e56bfc:type": "USDI (xUDT compatible)",
  // nervina-labs/ckb-dex-sdk src/constants/index.ts, MainnetInfo.DexLockScript (a
  // lock for orders listed for sale, seen with Spore and JoyID).
  "0xab0ede4350a201bd615892044ea9edf12180189572e49a7ff3f78cce179ae09f:type": "ckb-dex lock",
  // iCKB: ickb/contracts scripts/deployment/mainnet/migrations/2024-09-12-151119.json
  // (data hashes; the scripts are referenced by data1).
  "0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3:data1": "iCKB logic",
  "0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a:data1": "iCKB limit order",
  "0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0:data1": "iCKB owned owner",
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

/**
 * Names recorded groups that were unknown when they were replayed, from the
 * current EXTRA_MAINNET_SCRIPTS: how a report picks up scripts identified after
 * the run without replaying anything. Every other label, and every number, is
 * kept as recorded. Returns new records.
 */
export function relabel(records: TxRecord[]): TxRecord[] {
  return records.map((r) => ({
    ...r,
    groups: r.groups.map((g) => {
      if (!g.label.startsWith("unknown ")) return g;
      const label = EXTRA_MAINNET_SCRIPTS[`${g.codeHash.toLowerCase()}:${g.hashType}`];
      return label ? { ...g, label } : g;
    }),
  }));
}

/* ----------------------------------------------------------------- targets */

/** A script to sample on purpose (`--script`), as the indexer searches for it. */
export interface Target {
  /** Display name, also the section heading. */
  name: string;
  codeHash: string;
  hashType: string;
  /** Where the script runs: a lock runs for inputs only, a type for inputs and outputs. */
  role: "lock" | "type";
  /** Args prefix to search by; every args when absent. */
  args?: string;
}

/**
 * The scripts `--script <name>` knows, by the names the CLI accepts. Code
 * hashes are CCC's mainnet KnownScript values, or the EXTRA_MAINNET_SCRIPTS
 * sources above.
 */
export const TARGETS: Record<string, Omit<Target, "name"> & { label: string }> = {
  xudt: { label: "xUDT", codeHash: "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95", hashType: "data1", role: "type" },
  sudt: { label: "sUDT", codeHash: "0x5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5", hashType: "type", role: "type" },
  omnilock: { label: "Omnilock", codeHash: "0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26", hashType: "type", role: "lock" },
  acp: { label: "anyone-can-pay", codeHash: "0xd369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354", hashType: "type", role: "lock" },
  joyid: { label: "JoyID", codeHash: "0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323", hashType: "type", role: "lock" },
  multisig: { label: "secp256k1_multisig (legacy)", codeHash: "0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8", hashType: "type", role: "lock" },
  "pw-lock": { label: "PWLock", codeHash: "0xbf43c3602455798c1a61a596e0d95278864c552fafe231c063b3fabf97a8febc", hashType: "type", role: "lock" },
  cota: { label: "COTA", codeHash: "0x1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df", hashType: "type", role: "type" },
  spore: { label: "Spore", codeHash: "0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5", hashType: "data1", role: "type" },
  cluster: { label: "Spore Cluster", codeHash: "0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075", hashType: "data1", role: "type" },
  "type-id": { label: "Type ID", codeHash: "0x00000000000000000000000000000000000000000000000000545950455f4944", hashType: "type", role: "type" },
  dao: { label: "Nervos DAO", codeHash: "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e", hashType: "type", role: "type" },
  "unique-type": { label: "UniqueType", codeHash: "0x2c8c11c985da60b0a330c61a85507416d6382c130ba67f0c47ab071e00aec628", hashType: "data1", role: "type" },
  "rgbpp-lock": { label: "RGB++ lock", codeHash: "0xbc6c568a1a0d0a09f6844dc9d74ddb4343c32143ff25f727c59edf4fb72d6936", hashType: "type", role: "lock" },
  "btc-time-lock": { label: "BTC time lock (RGB++)", codeHash: "0x70d64497a075bd651e98ac030455ea200637ee325a12ad08aff03f1a117e5a62", hashType: "type", role: "lock" },
  "spv-client": { label: "Bitcoin SPV client (RGB++)", codeHash: "0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d", hashType: "type", role: "type" },
  "ickb-logic": { label: "iCKB logic", codeHash: "0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3", hashType: "data1", role: "type" },
  "ickb-limit-order": { label: "iCKB limit order", codeHash: "0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a", hashType: "data1", role: "lock" },
  "ickb-owned-owner": { label: "iCKB owned owner", codeHash: "0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0", hashType: "data1", role: "lock" },
  "dex-lock": { label: "ckb-dex lock", codeHash: "0xab0ede4350a201bd615892044ea9edf12180189572e49a7ff3f78cce179ae09f", hashType: "type", role: "lock" },
  "das-lock": { label: "d.id das-lock", codeHash: "0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137", hashType: "type", role: "lock" },
  "did-account": { label: "d.id AccountCell type", codeHash: "0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918", hashType: "type", role: "type" },
};

/**
 * `--script` → a Target. The spec is a name from TARGETS (any case) or a raw
 * code hash, optionally `codeHash:hashType:role`, then optionally `@<args
 * prefix>` to narrow the search, e.g. `omnilock@0x01` for Omnilock's Ethereum
 * auth. `opts` gives the defaults for what the spec leaves out (a raw code
 * hash: hash type "type", role "type").
 */
export function resolveTarget(spec: string, opts: { hashType?: string; role?: string; args?: string } = {}): Target {
  const at = spec.indexOf("@");
  const base = at < 0 ? spec : spec.slice(0, at);
  const args = (at < 0 ? opts.args : spec.slice(at + 1))?.toLowerCase();
  if (args !== undefined && !/^0x([0-9a-f]{2})*$/.test(args)) throw new Error(`args must be whole bytes of hex, got ${args}`);
  const withArgs = (t: Target): Target => (args && args !== "0x" ? { ...t, name: `${t.name}, args ${args}`, args } : t);
  const checkRole = (role: string | undefined) => {
    if (role !== undefined && role !== "lock" && role !== "type") throw new Error(`role must be lock or type, got ${role}`);
    return role as "lock" | "type" | undefined;
  };
  const raw = /^(0x[0-9a-fA-F]{64})(?::([a-z0-9]+))?(?::([a-z]+))?$/.exec(base);
  if (raw) {
    const codeHash = raw[1].toLowerCase();
    const hashType = raw[2] ?? opts.hashType ?? "type";
    if (!["type", "data", "data1", "data2"].includes(hashType)) throw new Error(`hash type must be type, data, data1 or data2, got ${hashType}`);
    const role = checkRole(raw[3] ?? opts.role) ?? "type";
    const name = EXTRA_MAINNET_SCRIPTS[`${codeHash}:${hashType}`] ?? `${codeHash.slice(0, 10)}…${codeHash.slice(-4)} (${hashType})`;
    return withArgs({ name, codeHash, hashType, role });
  }
  const known = TARGETS[base.toLowerCase()];
  if (!known) throw new Error(`unknown script "${base}": use a code hash, or one of ${Object.keys(TARGETS).join(", ")}`);
  const { label, ...t } = known;
  const role = checkRole(opts.role);
  return withArgs({ name: label, ...t, ...(role && { role }) });
}

/** The `--script` spec that resolves to a target again: its TARGETS name when it has one. */
export function targetSpec(t: Target): string {
  const name = Object.keys(TARGETS).find((k) => {
    const x = TARGETS[k];
    return x.codeHash === t.codeHash && x.hashType === t.hashType && x.role === t.role;
  });
  return `${name ?? `${t.codeHash}:${t.hashType}:${t.role}`}${t.args ? `@${t.args}` : ""}`;
}

/** One transaction from the indexer's get_transactions, grouped by transaction. */
export interface IndexerTx {
  tx_hash: string;
  block_number: string;
  tx_index: string;
  /** Where the searched script is: ["input" | "output", index]. */
  cells: [string, string][];
}

/**
 * The most recent `n` transactions in which the target actually ran: a lock
 * only runs for the inputs it guards (an output's lock runs nothing), a type
 * for inputs and outputs. Newest block first, then latest in the block.
 */
export function selectRecent(objects: readonly IndexerTx[], role: "lock" | "type", n: number): { hash: string; block: number }[] {
  const byHash = new Map<string, IndexerTx>();
  for (const o of objects) {
    const prior = byHash.get(o.tx_hash);
    byHash.set(o.tx_hash, prior ? { ...prior, cells: [...prior.cells, ...o.cells] } : o);
  }
  return [...byHash.values()]
    .filter((o) => role === "type" || o.cells.some(([io]) => io === "input"))
    .sort((a, b) => Number(b.block_number) - Number(a.block_number) || Number(b.tx_index) - Number(a.tx_index))
    .slice(0, n)
    .map((o) => ({ hash: o.tx_hash, block: Number(o.block_number) }));
}

export type TargetRow = Omit<ScriptRow, "share">;

/**
 * One target's sample: how it was found, and its replays aggregated as in the
 * random sample, but without shares (the transactions were picked by script).
 */
export interface TargetedSample {
  target: Target;
  query: {
    /** Blocks searched, inclusive. */
    fromBlock: number;
    toBlock: number;
    /** Transactions in that window in which the target ran. */
    found: number;
  };
  summary: Atlas["summary"];
  txCycles: Distribution;
  /** The target's own rows (several for Omnilock, one per auth mode). */
  targetRows: TargetRow[];
  /** Every script in these transactions, the target included. */
  scripts: TargetRow[];
  combinations: Atlas["combinations"];
  excluded: Atlas["excluded"];
  transactions: TxRecord[];
}

export interface TargetedRun {
  meta: {
    rpcUrl: string;
    chain: string;
    debugger: string;
    /** Highest block searched; each target looks back from here. */
    toBlock: number;
    /** Transactions replayed per target, at most. */
    maxTxs: number;
    /** The widest window searched back, in blocks. */
    maxWindow?: number;
    startedAt: string;
    finishedAt: string;
    toolCommit?: string;
  };
  samples: TargetedSample[];
}

/** A target's sample from its replays; only matches are aggregated, as in `aggregate`. */
export function aggregateTargeted(target: Target, query: TargetedSample["query"], records: TxRecord[]): TargetedSample {
  const s = summarize(records);
  const scripts = s.scripts.map(({ share: _share, ...row }) => row);
  return {
    target,
    query,
    summary: s.summary,
    txCycles: s.txCycles,
    targetRows: scripts.filter((r) => r.codeHash === target.codeHash && r.hashType === target.hashType && r.role === target.role),
    scripts,
    combinations: s.combinations,
    excluded: s.excluded,
    transactions: records,
  };
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
  return { meta, ...summarize(records) };
}

function summarize(records: TxRecord[]): Omit<Atlas, "meta" | "targeted"> {
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

/** A target row's name: the script's label, with the searched args prefix when there was one. */
function rowLabel(t: Target, label: string): string {
  const same = t.name === label || t.name.startsWith(label.replace(/ \(.*\)$/, ""));
  if (!same) return `${t.name}: ${label}`;
  return t.args ? `${label}, args ${t.args}` : label;
}

/**
 * The "Targeted samples" section: one sample per `--script` target, kept apart
 * from the random sample (no shares, no shared totals).
 */
export function renderTargeted(run: TargetedRun): string[] {
  const m = run.meta;
  const lines: string[] = [];
  lines.push("## Targeted samples");
  lines.push("");
  lines.push(
    "A second, separate sample. The random sample above saw too few transactions of some well-known scripts to say " +
      "what they cost, so for each script below the node's indexer (`get_transactions`) was asked for the most recent " +
      "mainnet transactions in which that script ran, and up to " +
      `${m.maxTxs} of them were replayed the same way, with the same check against the node's total. These ` +
      "transactions were picked because of the script, so they show what the script costs when it runs, not how " +
      "much of mainnet it is: there are no shares here, and none of them is counted in the random sample above.",
  );
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Node | ${m.rpcUrl} (chain \`${m.chain}\`) |`);
  lines.push(`| Searched back from | block ${m.toBlock} |`);
  lines.push(`| ckb-debugger | ${m.debugger} |`);
  lines.push(`| Run | ${m.startedAt} to ${m.finishedAt}${m.toolCommit ? `, ckb-cycle-tools ${m.toolCommit.slice(0, 7)}` : ""} |`);
  lines.push("");
  lines.push(
    "Cost of the searched script per group. Found: transactions in the searched window in which the script ran; " +
      "the most recent of them were replayed. Only replays that matched the node's total count toward the costs; " +
      "the rest are listed under each script.",
  );
  lines.push("");
  lines.push("| Script | Blocks searched | Found | Replayed | Matched | Groups | Min | Median | p90 | Max |");
  lines.push("|---|---|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const s of run.samples) {
    const q = `${s.query.fromBlock} to ${s.query.toBlock}`;
    const head = `${s.query.found} | ${s.summary.sampled} | ${s.summary.matched}`;
    if (!s.targetRows.length) {
      lines.push(`| ${s.target.name} | ${q} | ${head} | 0 | | | | |`);
      continue;
    }
    for (const r of s.targetRows) {
      lines.push(`| ${rowLabel(s.target, r.label)} | ${q} | ${head} | ${r.groups} | ${num(r.min)} | ${num(r.median)} | ${num(r.p90)} | ${num(r.max)} |`);
    }
  }
  lines.push("");
  for (const s of run.samples) {
    const t = s.target;
    lines.push(`### ${t.name}`);
    lines.push("");
    lines.push(
      `Searched for ${t.role} script \`${t.codeHash}\` (${t.hashType})${t.args ? `, args starting ${t.args}` : ""} in blocks ` +
        `${s.query.fromBlock} to ${s.query.toBlock}: ${s.query.found} transaction${s.query.found === 1 ? "" : "s"} ran it, ` +
        `${s.summary.sampled} replayed, ${s.summary.matched} matched the node.`,
    );
    lines.push("");
    if (!s.summary.sampled) {
      lines.push("No transaction in the window ran this script, so there is nothing to measure.");
      lines.push("");
      continue;
    }
    if (s.targetRows.length) {
      lines.push("| Script | Role | Groups | Min | Median | p90 | Max | Example |");
      lines.push("|---|---|--:|--:|--:|--:|--:|---|");
      for (const r of s.targetRows) {
        lines.push(`| ${r.label} | ${r.role} | ${r.groups} | ${num(r.min)} | ${num(r.median)} | ${num(r.p90)} | ${num(r.max)} | ${txLink(r.exampleTx)} |`);
      }
      lines.push("");
      const cell = s.targetRows.find((r) => r.codeCell)?.codeCell;
      if (cell) {
        lines.push(`Code loaded from ${txLink(cell.split(":")[0])} output ${cell.split(":")[1]}.`);
        lines.push("");
      }
    }
    const c = s.txCycles;
    if (c.count) {
      lines.push(`Whole transactions: median ${num(c.median)} cycles, p90 ${num(c.p90)}, min ${num(c.min)}, max ${num(c.max)}. What ran with it:`);
      lines.push("");
      lines.push("| Scripts | Transactions | Median cycles |");
      lines.push("|---|--:|--:|");
      for (const k of s.combinations.slice(0, 5)) lines.push(`| ${k.scripts} | ${k.transactions} | ${num(k.medianCycles)} |`);
      if (s.combinations.length > 5) lines.push(`| ${s.combinations.length - 5} other combinations | ${s.combinations.slice(5).reduce((n, k) => n + k.transactions, 0)} | |`);
      lines.push("");
    }
    if (s.excluded.length) {
      lines.push("Excluded:");
      lines.push("");
      lines.push("| Transaction | Block | Verdict | Node | Measured | Reason |");
      lines.push("|---|--:|---|--:|--:|---|");
      for (const e of s.excluded) lines.push(excludedRow(e));
      lines.push("");
    }
  }
  return lines;
}

const excludedRow = (e: Atlas["excluded"][number]) =>
  `| ${txLink(e.hash)} | ${e.block} | ${e.verdict} | ${e.nodeCycles === null ? "-" : num(e.nodeCycles)} | ${num(e.measuredCycles)} | ${(e.reason ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200)} |`;

/** The markdown report for an atlas. Plain text and tables, no emoji. */
export function renderMarkdown(a: Atlas, opts: { reproduce?: string; reproduceTargeted?: string } = {}): string {
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
    // Several rows of one script (Omnilock's modes) share a line under the name without the mode.
    const all = [...new Set(a.scripts.filter((x) => `${x.codeHash}:${x.hashType}` === k).map((x) => x.label))];
    const labels = all.length > 1 ? [...new Set(all.map((l) => l.replace(/ \(.*\)$/, "")))] : all;
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
    for (const e of a.excluded) lines.push(excludedRow(e));
  }
  lines.push("");
  if (a.targeted) lines.push(...renderTargeted(a.targeted));
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
    "- Names come from CCC's mainnet table of known scripts, plus a short table in scripts/atlas-lib.ts of scripts " +
      "whose code hash is published elsewhere (Spore and Cluster from @ckb-ccc/spore; d.id, RGB++, iCKB and ckb-dex from " +
      "their own repositories, each with its source). Scripts in neither show as unknown with their code hash; " +
      "Omnilock's mode is read from the first byte of its args.",
  );
  if (a.targeted) {
    lines.push(
      "- A targeted sample is the most recent transactions in which one script ran (a lock only counts where it " +
        "guards an input, since an output's lock does not run), found with the indexer RPC in a window that widens " +
        "until enough are found. Busy scripts are searched one first args byte at a time, which finds the same " +
        "transactions in smaller requests.",
    );
  }
  lines.push("- The raw per-transaction results are in data.json next to this file.");
  if (opts.reproduce) {
    lines.push("");
    lines.push("## Reproduce");
    lines.push("");
    lines.push("```");
    lines.push(opts.reproduce);
    lines.push("```");
    if (opts.reproduceTargeted) {
      lines.push("");
      lines.push("The targeted samples, into the same folder:");
      lines.push("");
      lines.push("```");
      lines.push(opts.reproduceTargeted);
      lines.push("```");
    }
  }
  lines.push("");
  return lines.join("\n");
}

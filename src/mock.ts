/**
 * Builds a ckb-debugger "mock transaction" for any transaction, by
 * fetching every cell it touches from a node: input cells, cell deps (with
 * dep groups expanded into the cells they point to), and header deps.
 *
 * Everything stays in the node's JSON-RPC format, which is what ckb-debugger
 * reads, so nothing is converted and nothing can drift in conversion.
 */

import { ccc } from "@ckb-ccc/core";

type Hex = string;
export interface RpcOutPoint {
  tx_hash: Hex;
  index: Hex;
}
export interface RpcCellOutput {
  capacity: Hex;
  lock: RpcScript;
  type: RpcScript | null;
}
export interface RpcScript {
  code_hash: Hex;
  hash_type: string;
  args: Hex;
}
export interface RpcTransaction {
  version: Hex;
  cell_deps: { out_point: RpcOutPoint; dep_type: "code" | "dep_group" }[];
  header_deps: Hex[];
  inputs: { since: Hex; previous_output: RpcOutPoint }[];
  outputs: RpcCellOutput[];
  outputs_data: Hex[];
  witnesses: Hex[];
  hash?: Hex;
}

export interface MockTransaction {
  mock_info: {
    inputs: { input: { since: Hex; previous_output: RpcOutPoint }; output: RpcCellOutput; data: Hex; header: Hex | null }[];
    cell_deps: {
      cell_dep: { out_point: RpcOutPoint; dep_type: "code" | "dep_group" };
      output: RpcCellOutput;
      data: Hex;
      header: Hex | null;
    }[];
    header_deps: unknown[];
  };
  tx: RpcTransaction;
}

export type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;

export interface HttpRpcOptions {
  /** How long one request may take before it is abandoned. Default 30 s. */
  timeoutMs?: number;
  /** Requests in flight at once; the rest wait. Default 16, so a big transaction does not trip a rate limit. */
  concurrency?: number;
}

export const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const RETRY_STATUS = new Set([429, 502, 503, 504]);

export function httpRpc(url: string, options: HttpRpcOptions = {}): Rpc {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const limit = Math.max(1, options.concurrency ?? 16);
  let id = 0;
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    active < limit ? (active++, Promise.resolve()) : new Promise<void>((resolve) => queue.push(resolve));
  // A waiting request takes over the slot directly, so `active` never overshoots.
  const release = () => (queue.length ? queue.shift()!() : active--);

  const post = async (method: string, body: string) => {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as { name?: string; cause?: { code?: string; message?: string } };
      if (err.name === "TimeoutError") throw new Error(`${method}: no answer from ${url} within ${timeoutMs / 1000} s`);
      // fetch says only "fetch failed"; the reason (ECONNREFUSED, ENOTFOUND…) is in its cause.
      const why = err.cause?.code ?? err.cause?.message ?? (e instanceof Error ? e.message : String(e));
      throw new Error(`${method}: cannot reach ${url} (${why})`);
    }
  };

  return async <T>(method: string, params: unknown[]) => {
    await acquire();
    try {
      const body = JSON.stringify({ id: ++id, jsonrpc: "2.0", method, params });
      let res = await post(method, body);
      // One retry for a rate limit or a busy gateway: a single 429 should not end a replay.
      if (RETRY_STATUS.has(res.status)) {
        await new Promise((r) => setTimeout(r, 1000));
        res = await post(method, body);
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from ${url}`);
      let json: { result?: T; error?: { message: string } };
      try {
        json = await res.json();
      } catch {
        throw new Error(`${method}: ${url} did not answer with JSON-RPC`);
      }
      if (json.error) throw new Error(`${method}: ${json.error.message}`);
      return json.result as T;
    } finally {
      release();
    }
  };
}

interface TxWithStatus {
  transaction: RpcTransaction | null;
  cycles: Hex | null;
  tx_status: { status: string; block_hash?: Hex | null; reason?: string | null };
}

/** A cellbase (block reward) transaction: one input, the null out point. No scripts run. */
export function isCellbase(tx: RpcTransaction): boolean {
  const o = tx.inputs.length === 1 ? tx.inputs[0].previous_output : undefined;
  return o !== undefined && /^0x0{64}$/.test(o.tx_hash) && Number(o.index) === 0xffffffff;
}

/**
 * The epoch each CKB-VM version took effect (Mirana: v1, Meepo: v2), per public
 * network. A `hash_type: "type"` script runs on the version current at its
 * block; data, data1 and data2 name their version themselves. Only a fallback:
 * the epochs of the node actually asked come from its `get_consensus`.
 */
const VM_VERSION_EPOCHS = { mainnet: [5414, 12293], testnet: [3113, 9690] } as const;

/** The epochs CKB-VM v1 and v2 took effect on one chain. `Infinity`: not scheduled there. */
export type VmEpochs = readonly [v1: number, v2: number];

export function scriptVersionAt(chain: "mainnet" | "testnet" | VmEpochs, epoch: number): 0 | 1 | 2 {
  const [mirana, meepo] = typeof chain === "string" ? VM_VERSION_EPOCHS[chain] : chain;
  return epoch >= meepo ? 2 : epoch >= mirana ? 1 : 0;
}

/** A node's chain and VM epochs, from `get_consensus`. */
export interface NodeConsensus {
  /** The chain id: "ckb" (mainnet), "ckb_testnet", or a devnet's own. */
  chain: string;
  /** "mainnet", "testnet", or the chain id for any other chain. */
  network: string;
  vmEpochs: VmEpochs;
}

interface RpcConsensus {
  id: string;
  hardfork_features: { rfc: string; epoch_number: Hex | null }[];
}

/**
 * Asks the node which chain it serves and when its hardforks took effect, so a
 * replay never depends on a network flag matching the node: RFC 0032 brought
 * CKB-VM v1 (Mirana), RFC 0049 CKB-VM v2 (Meepo).
 */
export async function nodeConsensus(rpc: Rpc): Promise<NodeConsensus> {
  const c = await rpc<RpcConsensus>("get_consensus", []);
  const epochOf = (rfc: string) => {
    const f = c.hardfork_features?.find((h) => h.rfc === rfc);
    if (!f) throw new Error(`get_consensus: no hardfork feature ${rfc}`);
    return f.epoch_number === null ? Infinity : Number(f.epoch_number);
  };
  const network = c.id === "ckb" ? "mainnet" : c.id === "ckb_testnet" ? "testnet" : c.id;
  return { chain: c.id, network, vmEpochs: [epochOf("0032"), epochOf("0049")] };
}

/** Parses a molecule OutPointVec: u32 LE count, then 36-byte out points. */
export function parseOutPointVec(data: Hex): RpcOutPoint[] {
  // No Buffer: this module also runs in the browser.
  const bytes = ccc.bytesFrom(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4) throw new Error("dep group data too short");
  const count = view.getUint32(0, true);
  if (bytes.length !== 4 + count * 36) throw new Error("dep group data has the wrong length");
  const out: RpcOutPoint[] = [];
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 36;
    out.push({
      tx_hash: ccc.hexFrom(bytes.subarray(at, at + 32)),
      index: "0x" + view.getUint32(at + 32, true).toString(16),
    });
  }
  return out;
}

const key = (o: RpcOutPoint) => `${o.tx_hash}:${Number(o.index)}`;

/**
 * A committed (or pending) transaction, fetched by hash, with the epoch of the
 * block that committed it (absent while pending).
 */
export async function buildMockTransaction(
  rpc: Rpc,
  txHash: Hex,
): Promise<{ mock: MockTransaction; cycles?: bigint; status: string; epoch?: number }> {
  const root = await rpc<TxWithStatus | null>("get_transaction", [txHash]);
  // A rejected transaction is not in the chain either; the node still says why.
  if (root?.tx_status.status === "rejected") {
    throw new Error(`transaction rejected by the node: ${txHash}${root.tx_status.reason ? ` (${root.tx_status.reason})` : ""}`);
  }
  if (!root?.transaction) throw new Error(`transaction not found: ${txHash}`);
  const blockHash = root.tx_status.block_hash;
  const header = blockHash ? await rpc<{ epoch: Hex } | null>("get_header", [blockHash]) : null;
  return {
    mock: await mockFromTransaction(rpc, root.transaction),
    // Some public nodes report 0x0 for older blocks: unknown, not zero, since an
    // input lock always runs. Only a cellbase really costs 0.
    ...(root.cycles &&
      (BigInt(root.cycles) > 0n || isCellbase(root.transaction)) && { cycles: BigInt(root.cycles) }),
    status: root.tx_status.status,
    // The epoch number is the low 24 bits of the packed epoch.
    ...(header && { epoch: Number(BigInt(header.epoch) & 0xffffffn) }),
  };
}

/**
 * Any transaction in RPC shape — including one that was never sent, or that
 * the node would reject — as long as the cells it spends and depends on exist.
 */
export async function mockFromTransaction(rpc: Rpc, tx: RpcTransaction): Promise<MockTransaction> {
  const txs = new Map<string, Promise<TxWithStatus>>();
  const getTx = (hash: Hex) => {
    let p = txs.get(hash);
    if (!p) {
      p = rpc<TxWithStatus>("get_transaction", [hash]);
      txs.set(hash, p);
    }
    return p;
  };
  const getCell = async (o: RpcOutPoint) => {
    const res = await getTx(o.tx_hash);
    const i = Number(o.index);
    const output = res?.transaction?.outputs[i];
    if (!output) throw new Error(`cell not found: ${key(o)}`);
    // The block the cell was created in. A script reading this cell's header
    // (load_header with Source::Input, e.g. a Nervos DAO withdrawal) gets that
    // block, provided the transaction lists it in header_deps — as on the node.
    return { output, data: res.transaction!.outputs_data[i], header: res.tx_status.block_hash ?? null };
  };

  if (isCellbase(tx)) {
    const { hash: _hash, ...plainTx } = tx;
    return { mock_info: { inputs: [], cell_deps: [], header_deps: [] }, tx: plainTx };
  }

  const inputs = await Promise.all(
    tx.inputs.map(async (input) => ({ input, ...(await getCell(input.previous_output)) })),
  );

  // Declared deps first, then the cells each dep group points to, de-duplicated.
  // A cell may appear as code and as a dep group; each needs its own entry.
  const deps: MockTransaction["mock_info"]["cell_deps"] = [];
  const seen = new Set<string>();
  const addDep = async (cell_dep: { out_point: RpcOutPoint; dep_type: "code" | "dep_group" }) => {
    const id = `${key(cell_dep.out_point)}:${cell_dep.dep_type}`;
    if (seen.has(id)) return;
    seen.add(id);
    const cell = await getCell(cell_dep.out_point);
    deps.push({ cell_dep, ...cell });
    if (cell_dep.dep_type === "dep_group") {
      for (const out_point of parseOutPointVec(cell.data)) await addDep({ out_point, dep_type: "code" });
    }
  };
  for (const d of tx.cell_deps) await addDep(d);

  const header_deps = await Promise.all(tx.header_deps.map((h) => rpc<unknown>("get_header", [h])));

  // ckb-debugger reads the RPC transaction shape without the hash field.
  const { hash: _hash, ...plainTx } = tx;
  return { mock_info: { inputs, cell_deps: deps, header_deps }, tx: plainTx };
}

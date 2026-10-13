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

export function httpRpc(url: string): Rpc {
  let id = 0;
  return async <T>(method: string, params: unknown[]) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ++id, jsonrpc: "2.0", method, params }),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };
}

interface TxWithStatus {
  transaction: RpcTransaction | null;
  cycles: Hex | null;
  tx_status: { status: string; block_hash?: Hex | null };
}

/** A cellbase (block reward) transaction: one input, the null out point. No scripts run. */
export function isCellbase(tx: RpcTransaction): boolean {
  const o = tx.inputs.length === 1 ? tx.inputs[0].previous_output : undefined;
  return o !== undefined && /^0x0{64}$/.test(o.tx_hash) && Number(o.index) === 0xffffffff;
}

/**
 * The epoch each CKB-VM version took effect (Mirana: v1, Meepo: v2), per network.
 * A `hash_type: "type"` script runs on the version current at its block; data,
 * data1 and data2 name their version themselves.
 */
const VM_VERSION_EPOCHS = { mainnet: [5414, 12293], testnet: [3113, 9690] } as const;

export function scriptVersionAt(network: "mainnet" | "testnet", epoch: number): 0 | 1 | 2 {
  const [mirana, meepo] = VM_VERSION_EPOCHS[network];
  return epoch >= meepo ? 2 : epoch >= mirana ? 1 : 0;
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

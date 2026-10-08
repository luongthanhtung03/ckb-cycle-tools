/**
 * Builds a ckb-debugger "mock transaction" for any committed transaction, by
 * fetching every cell it touches from a node: input cells, cell deps (with
 * dep groups expanded into the cells they point to), and header deps.
 *
 * Everything stays in the node's JSON-RPC format, which is what ckb-debugger
 * reads, so nothing is converted and nothing can drift in conversion.
 */

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
  tx_status: { status: string };
}

/** Parses a molecule OutPointVec: u32 LE count, then 36-byte out points. */
export function parseOutPointVec(data: Hex): RpcOutPoint[] {
  const bytes = Buffer.from(data.replace(/^0x/, ""), "hex");
  if (bytes.length < 4) throw new Error("dep group data too short");
  const count = bytes.readUInt32LE(0);
  if (bytes.length !== 4 + count * 36) throw new Error("dep group data has the wrong length");
  const out: RpcOutPoint[] = [];
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 36;
    out.push({
      tx_hash: "0x" + bytes.subarray(at, at + 32).toString("hex"),
      index: "0x" + bytes.readUInt32LE(at + 32).toString(16),
    });
  }
  return out;
}

const key = (o: RpcOutPoint) => `${o.tx_hash}:${Number(o.index)}`;

export async function buildMockTransaction(
  rpc: Rpc,
  txHash: Hex,
): Promise<{ mock: MockTransaction; cycles?: bigint; status: string }> {
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
    return { output, data: res.transaction!.outputs_data[i] };
  };

  const root = await getTx(txHash);
  if (!root?.transaction) throw new Error(`transaction not found: ${txHash}`);
  const tx = root.transaction;

  const inputs = await Promise.all(
    tx.inputs.map(async (input) => ({ input, ...(await getCell(input.previous_output)), header: null })),
  );

  // Declared deps first, then the cells each dep group points to, de-duplicated.
  const deps: MockTransaction["mock_info"]["cell_deps"] = [];
  const seen = new Set<string>();
  const addDep = async (cell_dep: { out_point: RpcOutPoint; dep_type: "code" | "dep_group" }) => {
    if (seen.has(key(cell_dep.out_point))) return;
    seen.add(key(cell_dep.out_point));
    const cell = await getCell(cell_dep.out_point);
    deps.push({ cell_dep, ...cell, header: null });
    if (cell_dep.dep_type === "dep_group") {
      for (const out_point of parseOutPointVec(cell.data)) await addDep({ out_point, dep_type: "code" });
    }
  };
  for (const d of tx.cell_deps) await addDep(d);

  const header_deps = await Promise.all(tx.header_deps.map((h) => rpc<unknown>("get_header", [h])));

  // ckb-debugger reads the RPC transaction shape without the hash field.
  const { hash: _hash, ...plainTx } = tx;
  return {
    mock: { mock_info: { inputs, cell_deps: deps, header_deps }, tx: plainTx },
    ...(root.cycles && { cycles: BigInt(root.cycles) }),
    status: root.tx_status.status,
  };
}

import { ccc } from "@ckb-ccc/core";

/**
 * What ran when a transaction was verified, and what it cost.
 *
 * CKB executes each script once per *script group*, not once per cell:
 * - every input lock runs, grouped by lock script hash;
 * - every type script runs, grouped by type script hash across inputs AND outputs;
 * - output locks do not run at all.
 *
 * The total cycle count comes from the node. A per-group cycle breakdown needs
 * ckb-debugger, which is what the CLI is for.
 */
export interface ScriptGroup {
  role: "lock" | "type";
  scriptHash: ccc.Hex;
  codeHash: ccc.Hex;
  hashType: ccc.HashType;
  args: ccc.Hex;
  /** Human name for well-known scripts (e.g. "Secp256k1Blake160"), if recognised. */
  name?: string;
  /** Input indices in this group. */
  inputs: number[];
  /** Output indices in this group (type scripts only). */
  outputs: number[];
}

export interface TxAnalysis {
  hash: ccc.Hex;
  status: string;
  /** Total verification cycles as reported by the node; absent if unknown. */
  cycles?: bigint;
  blockNumber?: bigint;
  inputCount: number;
  outputCount: number;
  /** True for a cellbase (block reward) transaction, which runs no input scripts. */
  cellbase: boolean;
  groups: ScriptGroup[];
}

type CellScripts = { lock: ccc.ScriptLike; type?: ccc.ScriptLike | null };

/** Pure grouping step — no network. Group order follows first appearance. */
export function groupScripts(inputs: CellScripts[], outputs: CellScripts[]): ScriptGroup[] {
  const groups = new Map<string, ScriptGroup>();

  const add = (role: "lock" | "type", like: ccc.ScriptLike, side: "inputs" | "outputs", index: number) => {
    const script = ccc.Script.from(like);
    const scriptHash = script.hash();
    const key = `${role}:${scriptHash}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        role,
        scriptHash,
        codeHash: script.codeHash,
        hashType: script.hashType,
        args: script.args,
        inputs: [],
        outputs: [],
      };
      groups.set(key, g);
    }
    g[side].push(index);
  };

  inputs.forEach((cell, i) => {
    add("lock", cell.lock, "inputs", i);
    if (cell.type) add("type", cell.type, "inputs", i);
  });
  outputs.forEach((cell, i) => {
    if (cell.type) add("type", cell.type, "outputs", i);
  });

  return [...groups.values()];
}

const scriptKey = (codeHash: string, hashType: string) => `${codeHash}:${hashType}`;

/** codeHash:hashType → KnownScript name, for the client's network. */
export async function knownScriptNames(client: ccc.Client): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    Object.values(ccc.KnownScript).map(async (name) => {
      try {
        const info = await client.getKnownScript(name);
        names.set(scriptKey(info.codeHash, info.hashType), name);
      } catch {
        // Not deployed on this network.
      }
    }),
  );
  return names;
}

export class TransactionNotFoundError extends Error {
  constructor(hash: string) {
    super(`transaction not found: ${hash}`);
    this.name = "TransactionNotFoundError";
  }
}

export async function analyzeTransaction(client: ccc.Client, hash: ccc.HexLike): Promise<TxAnalysis> {
  const txHash = ccc.hexFrom(hash);
  const res = await client.getTransaction(txHash);
  if (!res?.transaction) throw new TransactionNotFoundError(txHash);
  const tx = res.transaction;

  const cellbase =
    tx.inputs.length === 1 &&
    tx.inputs[0].previousOutput.txHash === "0x" + "00".repeat(32) &&
    tx.inputs[0].previousOutput.index === ccc.numFrom("0xffffffff");

  const inputCells = cellbase
    ? []
    : await Promise.all(
        tx.inputs.map(async (input) => {
          const cell = await client.getCell(input.previousOutput);
          if (!cell) throw new Error(`input cell not found: ${input.previousOutput.txHash}`);
          return cell.cellOutput;
        }),
      );

  const [groups, names] = await Promise.all([
    Promise.resolve(groupScripts(inputCells, tx.outputs)),
    knownScriptNames(client),
  ]);
  for (const g of groups) {
    const name = names.get(scriptKey(g.codeHash, g.hashType));
    if (name) g.name = name;
  }

  return {
    hash: txHash,
    status: res.status,
    ...(res.cycles !== undefined && res.cycles !== null && { cycles: ccc.numFrom(res.cycles) }),
    ...(res.blockNumber !== undefined && res.blockNumber !== null && { blockNumber: ccc.numFrom(res.blockNumber) }),
    inputCount: tx.inputs.length,
    outputCount: tx.outputs.length,
    cellbase,
    groups,
  };
}

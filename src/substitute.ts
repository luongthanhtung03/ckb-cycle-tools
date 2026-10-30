/**
 * Swaps a script binary in a mock transaction for another one — typically the
 * binary just built from the commit under test — so a replay measures that
 * build instead of the one deployed on chain.
 *
 * Pure: no network, no file system. The caller reads the binary.
 *
 * A substitution targets `code` cell deps (including the cells a dep group
 * expands to), by out point or by code hash:
 * - by out point: that cell, whatever it holds;
 * - by code hash: every cell whose data hash, or whose type script hash, equals it.
 *
 * Its data is replaced. What else has to change depends on how scripts point at
 * the cell:
 * - `hash_type: "type"`: by the cell's type script, which does not change. The
 *   scripts that run are byte-for-byte the same; only the code differs. This is
 *   the case that measures exactly "the same transaction, new binary".
 * - `hash_type: "data" | "data1" | "data2"`: by the hash of the data, which the new
 *   binary changes. Every script whose code hash was the old data hash is
 *   rewritten to the new one — in input cells, cell deps and outputs — or it would
 *   not find its code at all. The transaction is then not the one you measured
 *   before: rewriting an output's script changes the transaction hash, so any
 *   signature over it (secp256k1 sighash-all, for one) stops verifying, and a
 *   script that carries the old hash in its args (a ckb-js-vm script naming its
 *   bytecode, a lock naming another lock's hash) is not rewritten. Both are
 *   reported as warnings, so a changed result can be traced to them.
 */
import { ccc } from "@ckb-ccc/core";
import type { MockTransaction, RpcOutPoint, RpcScript } from "./mock.js";

type Hex = string;

export interface BinarySubstitution {
  /** A label for messages, and for the script in reports. */
  name?: string;
  /** The new binary, as bytes or 0x-hex. */
  data: Uint8Array | Hex;
  /** The cell dep to replace. Give this or `codeHash`. */
  outPoint?: RpcOutPoint;
  /** Replace every code dep whose data hash or type script hash is this. */
  codeHash?: Hex;
}

export interface AppliedSubstitution {
  name?: string;
  /** The cell deps that now hold the new binary. */
  outPoints: RpcOutPoint[];
  oldDataHash: Hex;
  newDataHash: Hex;
  /**
   * The code hashes scripts can now reach the binary by, as `codeHash:hashType`
   * keys (the form profileTransaction's `scriptNames` takes).
   */
  scriptKeys: string[];
  /** How many scripts had their code hash rewritten (data hash types only). */
  rewritten: number;
  warnings: string[];
}

const DATA_HASH_TYPES = ["data", "data1", "data2"];
const sameOutPoint = (a: RpcOutPoint, b: RpcOutPoint) =>
  a.tx_hash.toLowerCase() === b.tx_hash.toLowerCase() && Number(a.index) === Number(b.index);
const typeHash = (s: RpcScript) =>
  ccc.Script.from({ codeHash: s.code_hash, hashType: s.hash_type as ccc.HashType, args: s.args }).hash();

/**
 * Applies the substitutions in order and returns a new mock; the input is not
 * modified. Throws if a substitution matches no code dep, since silently
 * measuring the old binary would be the worst possible result — unless
 * `skipUnmatched`, for a binary offered to every scenario, which only some use;
 * the ones that matched are in `applied`.
 */
export function substituteBinaries(
  mock: MockTransaction,
  substitutions: BinarySubstitution[],
  options: { skipUnmatched?: boolean } = {},
): { mock: MockTransaction; applied: AppliedSubstitution[] } {
  const next: MockTransaction = structuredClone(mock);
  const applied: AppliedSubstitution[] = [];
  for (const sub of substitutions) {
    const result = substituteOne(next, sub, options.skipUnmatched ?? false);
    if (result) applied.push(result);
  }
  return { mock: next, applied };
}

/** The code cell deps a substitution would replace: by out point, or by data hash or type script hash. */
function targetsOf(mock: MockTransaction, sub: Pick<BinarySubstitution, "outPoint" | "codeHash">) {
  const want = sub.codeHash?.toLowerCase();
  return mock.mock_info.cell_deps.filter((d) => {
    if (d.cell_dep.dep_type !== "code") return false;
    if (sub.outPoint) return sameOutPoint(d.cell_dep.out_point, sub.outPoint);
    return ccc.hashCkb(d.data) === want || (d.output.type != null && typeHash(d.output.type) === want);
  });
}

/**
 * The scripts (`codeHash:hashType` keys, lower case) that run the code a
 * substitution would replace, in the mock as it is: for a binary that could
 * not be read (absent from the base checkout), the groups whose numbers are
 * the mock's code instead of that build's. Empty when it matches no cell dep.
 */
export function targetScriptKeys(mock: MockTransaction, sub: Pick<BinarySubstitution, "outPoint" | "codeHash">): string[] {
  const keys = new Set<string>();
  for (const d of targetsOf(mock, sub)) {
    const dataHash = ccc.hashCkb(d.data).toLowerCase();
    for (const t of DATA_HASH_TYPES) keys.add(`${dataHash}:${t}`);
    if (d.output.type) keys.add(`${typeHash(d.output.type)}:type`.toLowerCase());
  }
  return [...keys];
}

function substituteOne(mock: MockTransaction, sub: BinarySubstitution, skipUnmatched: boolean): AppliedSubstitution | undefined {
  const label = sub.name ?? sub.codeHash ?? (sub.outPoint && `${sub.outPoint.tx_hash}:${Number(sub.outPoint.index)}`);
  if (!sub.outPoint === !sub.codeHash) throw new Error(`substitution ${label}: give an out point or a code hash, not both`);
  const data = ccc.hexFrom(sub.data);
  const newDataHash = ccc.hashCkb(data);

  const targets = targetsOf(mock, sub);
  if (!targets.length) {
    if (skipUnmatched) return undefined;
    throw new Error(`substitution ${label}: no code cell dep in this transaction matches it`);
  }
  const oldHashes = new Set(targets.map((d) => ccc.hashCkb(d.data)));
  if (oldHashes.size > 1) throw new Error(`substitution ${label}: matches cells holding different binaries`);
  const [oldDataHash] = oldHashes;

  const scriptKeys = new Set<string>();
  for (const d of targets) {
    d.data = data;
    if (d.output.type) scriptKeys.add(`${typeHash(d.output.type)}:type`);
  }

  const warnings: string[] = [];
  let rewritten = 0;
  if (oldDataHash !== newDataHash) {
    for (const t of DATA_HASH_TYPES) scriptKeys.add(`${newDataHash}:${t}`);
    let outputsRewritten = 0;
    let argsMentions = 0;
    const rewrite = (s: RpcScript | null | undefined, where: string) => {
      if (!s) return;
      if (s.code_hash.toLowerCase() === oldDataHash && DATA_HASH_TYPES.includes(s.hash_type)) {
        s.code_hash = newDataHash;
        rewritten++;
        if (where === "output") outputsRewritten++;
      }
      if (s.args.toLowerCase().includes(oldDataHash.slice(2))) argsMentions++;
    };
    for (const c of [...mock.mock_info.inputs, ...mock.mock_info.cell_deps]) {
      rewrite(c.output.lock, "cell");
      rewrite(c.output.type, "cell");
    }
    for (const o of mock.tx.outputs) {
      rewrite(o.lock, "output");
      rewrite(o.type, "output");
    }
    if (outputsRewritten) {
      warnings.push(
        `${outputsRewritten} output script(s) now name the new code hash, which changes the transaction hash: ` +
          `signatures over it no longer verify`,
      );
    }
    if (argsMentions) {
      warnings.push(`the old code hash still appears in the args of ${argsMentions} script(s); args are not rewritten`);
    }
  }

  return {
    ...(sub.name && { name: sub.name }),
    outPoints: targets.map((d) => d.cell_dep.out_point),
    oldDataHash,
    newDataHash,
    scriptKeys: [...scriptKeys],
    rewritten,
    warnings,
  };
}

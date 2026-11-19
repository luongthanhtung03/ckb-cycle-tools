/**
 * Which binary a spawned VM ran, from the locator ckb-debugger prints in its
 * spawn tree (`cell_dep[1][0..11552]`, see flame.ts `spawnTree`), read from
 * the mock transaction the group was replayed with. Plain TypeScript with no
 * Node built-ins, like flame.ts.
 */
import { ccc } from "@ckb-ccc/core";
import type { SpawnedVm } from "./flame.js";
import { parseOutPointVec, type MockTransaction, type RpcCellOutput, type RpcOutPoint } from "./mock.js";

export interface SpawnedBinary {
  /** The bytes the VM loaded. */
  data: Uint8Array;
  /** Their blake2b hash: the code hash a `data`/`data1`/`data2` script would name it by. */
  dataHash: string;
  /** The type script hash of the cell it came from, when that cell has one and the binary is its whole data. */
  typeHash?: string;
}

const sameOutPoint = (a: RpcOutPoint, b: RpcOutPoint) =>
  a.tx_hash.toLowerCase() === b.tx_hash.toLowerCase() && Number(a.index) === Number(b.index);

/**
 * The cell deps as the node resolves them, the order `cell_dep[i]` counts in:
 * each code dep is itself, each dep group is the cells it lists (the group
 * cell is not one of them).
 */
export function resolvedCellDeps(mock: MockTransaction): { output: RpcCellOutput; data: string }[] {
  const find = (o: RpcOutPoint) => {
    const c = mock.mock_info.cell_deps.find((d) => sameOutPoint(d.cell_dep.out_point, o));
    if (!c) throw new Error(`cell dep ${o.tx_hash}:${Number(o.index)} is not in the mock`);
    return c;
  };
  return mock.tx.cell_deps.flatMap((d) =>
    d.dep_type === "dep_group" ? parseOutPointVec(find(d.out_point).data).map(find) : [find(d.out_point)],
  );
}

/**
 * The binary a spawned VM ran. `group` gives the group's input and output
 * indices, for `group_input[i]` and `group_output[i]`. Undefined when the
 * locator does not name a cell of this transaction (a witness, or a line this
 * cannot parse).
 */
export function spawnedBinary(
  mock: MockTransaction,
  vm: SpawnedVm,
  group: { inputs: number[]; outputs: number[] },
): SpawnedBinary | undefined {
  if (vm.source === undefined || vm.index === undefined || vm.start === undefined || vm.end === undefined) return undefined;
  let cell: { output?: RpcCellOutput | null; data: string } | undefined;
  try {
    const i = vm.index;
    switch (vm.source) {
      case "cell_dep":
        cell = resolvedCellDeps(mock)[i];
        break;
      case "input":
        cell = mock.mock_info.inputs[i];
        break;
      case "group_input":
        cell = group.inputs[i] === undefined ? undefined : mock.mock_info.inputs[group.inputs[i]];
        break;
      case "output":
        cell = mock.tx.outputs_data[i] === undefined ? undefined : { output: mock.tx.outputs[i], data: mock.tx.outputs_data[i] };
        break;
      case "group_output": {
        const o = group.outputs[i];
        cell = o === undefined || mock.tx.outputs_data[o] === undefined ? undefined : { output: mock.tx.outputs[o], data: mock.tx.outputs_data[o] };
        break;
      }
      default:
        cell = undefined;
    }
  } catch {
    return undefined;
  }
  if (!cell) return undefined;
  const bytes = ccc.bytesFrom(cell.data);
  if (vm.end > bytes.length || vm.start > vm.end) return undefined;
  const data = bytes.subarray(vm.start, vm.end);
  const whole = vm.start === 0 && vm.end === bytes.length;
  const type = cell.output?.type;
  return {
    data,
    dataHash: ccc.hashCkb(data).toLowerCase(),
    ...(whole &&
      type && {
        typeHash: ccc.Script.from({ codeHash: type.code_hash, hashType: type.hash_type as ccc.HashType, args: type.args }).hash().toLowerCase(),
      }),
  };
}

/**
 * The binary a script group runs, from the mock transaction's cell deps (as
 * the node resolves them): the first whose data hash is the script's code
 * hash (`data`, `data1`, `data2`), or whose cell's type script hash is
 * (`type`). Undefined when no cell dep has it.
 */
export function groupBinary(mock: MockTransaction, group: { codeHash: string; hashType: string }): SpawnedBinary | undefined {
  const want = group.codeHash.toLowerCase();
  let deps: ReturnType<typeof resolvedCellDeps>;
  try {
    deps = resolvedCellDeps(mock);
  } catch {
    return undefined;
  }
  for (const cell of deps) {
    const data = ccc.bytesFrom(cell.data);
    const type = cell.output.type;
    const typeHash = type
      ? ccc.Script.from({ codeHash: type.code_hash, hashType: type.hash_type as ccc.HashType, args: type.args }).hash().toLowerCase()
      : undefined;
    if (group.hashType === "type" ? typeHash === want : ccc.hashCkb(data).toLowerCase() === want) {
      return { data, dataHash: ccc.hashCkb(data).toLowerCase(), ...(typeHash && { typeHash }) };
    }
  }
  return undefined;
}

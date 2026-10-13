/**
 * Replaying a transaction group by group, with any ckb-debugger: the native
 * binary (profile.ts, for the CLI) or its WebAssembly build (wasm.ts, for the
 * browser). Everything here is plain TypeScript with no Node built-ins, so
 * both get the same planning, the same Type ID check and the same parsing,
 * and therefore the same numbers.
 */
import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { groupScripts, knownScriptNames, type ScriptGroup } from "./analyze.js";
import {
  buildMockTransaction,
  httpRpc,
  isCellbase,
  mockFromTransaction,
  scriptVersionAt,
  type MockTransaction,
  type RpcScript,
  type RpcTransaction,
} from "./mock.js";

export interface GroupRun {
  /** The `--script` selector passed to ckb-debugger, e.g. `input.0.lock`. */
  selector: string;
  /** Exit code of the script: 0 means it accepted the transaction. */
  result: number;
  /** Set when the VM itself stopped the script (a fault, the cycle limit), or Type ID refused. */
  error?: string;
  cycles: bigint;
  /** Lines the script printed through ckb_debug. */
  logs: string[];
}

export type ProfiledGroup = ScriptGroup & GroupRun;

export interface Profile {
  /** The transaction hash, or "(not on chain)" for a transaction passed in directly. */
  hash: string;
  status: string;
  /** Total cycles as reported by the node. */
  nodeCycles?: bigint;
  /** Sum of the per-group cycles measured by ckb-debugger. */
  measuredCycles: bigint;
  groups: ProfiledGroup[];
  /** Where the numbers came from, so a result can be reproduced. */
  env: { debugger: string; network: string; rpcUrl: string; scriptVersion: number };
}

export interface ReplayOptions {
  network?: "testnet" | "mainnet";
  /** A node to fetch from instead of the public one for `network`. */
  rpcUrl?: string;
  /**
   * Names for scripts this tool cannot know, e.g. on a devnet: `codeHash:hashType`
   * (lowercase hex) → name. They take precedence over the known scripts.
   */
  scriptNames?: Record<string, string>;
  /**
   * The CKB-VM version for `hash_type: "type"` scripts. By default, that of the
   * transaction's block, or the current one (2) for a transaction not on chain.
   */
  scriptVersion?: 0 | 1 | 2;
}

/**
 * Type ID is verified natively by the node rather than by a script binary, so
 * ckb-debugger cannot run it. The node charges it a fixed cost (TYPE_ID_CYCLES
 * in ckb-script).
 */
export const TYPE_ID_CODE_HASH = "0x00000000000000000000000000000000000000000000000000545950455f4944";
export const TYPE_ID_CYCLES = 1_000_000n;

export const PUBLIC_RPC = { testnet: "https://testnet.ckb.dev/", mainnet: "https://mainnet.ckb.dev/" };

const toScript = (s: RpcScript): ccc.ScriptLike => ({ codeHash: s.code_hash, hashType: s.hash_type as ccc.HashType, args: s.args });

/** The first cell in a group is enough: ckb-debugger runs the whole group from it. */
export function selectorFor(g: ScriptGroup): string {
  if (g.inputs.length) return `input.${g.inputs[0]}.${g.role}`;
  return `output.${g.outputs[0]}.${g.role}`;
}

/** The ckb-debugger arguments for one group, the same for the native and the WebAssembly build. */
export function debuggerArgs(txFile: string, selector: string, scriptVersion: number): string[] {
  return ["--tx-file", txFile, "--script", selector, "--script-version", String(scriptVersion)];
}

/** Control characters a script could print to move the cursor or recolour the terminal. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * ckb-debugger's own result lines come last and start the line; a script's logs
 * come before them, each after "Script log: ". Reading the last line-anchored
 * match means a script cannot fake its result by logging "Run result: 0".
 */
export function parseDebuggerOutput(out: string): Omit<GroupRun, "selector"> {
  const last = (re: RegExp) => [...out.matchAll(re)].at(-1)?.[1];
  const result = last(/^Run result: (.*?)\s*$/gm);
  const cycles = last(/^All cycles: (\d+)/gm);
  if (result === undefined) throw new Error(`unexpected ckb-debugger output:\n${out}`);
  const logs = [...out.matchAll(/^Script log: (.*)$/gm)].map((m) => m[1].trim().replace(CONTROL, "�"));
  if (/^-?\d+$/.test(result) && cycles !== undefined) return { result: Number(result), cycles: BigInt(cycles), logs };
  // The VM stopped the script (invalid instruction, cycle limit, bad ELF…): a rejection, not a crash.
  return { result: -1, error: result.replace(CONTROL, "�"), cycles: cycles === undefined ? 0n : BigInt(cycles), logs };
}

/**
 * Type ID, checked as the node does (ckb-script's type_id): at most one cell on
 * each side, 32-byte args, and a new Type ID's args are the hash of the first
 * input and the new cell's output index.
 */
export function checkTypeId(g: ScriptGroup, tx: RpcTransaction): string | undefined {
  if (g.inputs.length > 1 || g.outputs.length > 1) return "type id: more than one cell in the group";
  if (g.args.length !== 2 + 64) return "type id: args must be 32 bytes";
  if (g.inputs.length) return undefined;
  const first = tx.inputs[0];
  if (!first) return "type id: no input to derive it from";
  // CellInput (since u64 LE ‖ tx hash ‖ index u32 LE), then the output index as u64 LE.
  const expected = ccc.hashCkb(
    ccc.bytesConcat(
      ccc.numLeToBytes(BigInt(first.since), 8),
      ccc.bytesFrom(first.previous_output.tx_hash),
      ccc.numLeToBytes(Number(first.previous_output.index), 4),
      ccc.numLeToBytes(g.outputs[0], 8),
    ),
  );
  return expected === g.args.toLowerCase() ? undefined : "type id: args do not match the first input";
}

/** Everything a replay needs, fetched from the node: the mock transaction, its groups, and how to run them. */
export interface ReplayPlan {
  hash: string;
  status: string;
  nodeCycles?: bigint;
  mock: MockTransaction;
  groups: ScriptGroup[];
  /** CKB-VM version for `hash_type: "type"` scripts: the one of the block's epoch. */
  scriptVersion: 0 | 1 | 2;
  network: "testnet" | "mainnet";
  rpcUrl: string;
}

/** The script groups that run for a mock transaction, in first-appearance order. A cellbase runs none. */
export function groupsOf(mock: MockTransaction): ScriptGroup[] {
  if (isCellbase(mock.tx as RpcTransaction)) return [];
  return groupScripts(
    mock.mock_info.inputs.map((c) => ({ lock: toScript(c.output.lock), type: c.output.type && toScript(c.output.type) })),
    mock.tx.outputs.map((o) => ({ lock: toScript(o.lock), type: o.type && toScript(o.type) })),
  );
}

/**
 * Fetches what a replay needs: a committed transaction by hash (with the node's
 * total), or any transaction in RPC shape, e.g. one about to be sent.
 */
export async function planReplay(
  target: string | RpcTransaction | MockTransaction,
  options: ReplayOptions = {},
): Promise<ReplayPlan> {
  const network = options.network ?? "testnet";
  const rpcUrl = options.rpcUrl ?? PUBLIC_RPC[network];
  const rpc = httpRpc(rpcUrl);

  const { mock, cycles, status, epoch } =
    typeof target === "string"
      ? await buildMockTransaction(rpc, target)
      : "mock_info" in target
        ? { mock: target, cycles: undefined, status: "not on chain", epoch: undefined }
        : { mock: await mockFromTransaction(rpc, target), cycles: undefined, status: "not on chain", epoch: undefined };
  const groups = groupsOf(mock);

  // Known-script names are CCC's table for `network`, through the same node;
  // a network CCC does not know (a devnet) names its scripts with `scriptNames`.
  const client =
    network === "mainnet" ? new ccc.ClientPublicMainnet({ url: rpcUrl }) : new ccc.ClientPublicTestnet({ url: rpcUrl });
  const names = await knownScriptNames(client);
  for (const [k, name] of Object.entries(options.scriptNames ?? {})) names.set(k.toLowerCase(), name);
  for (const g of groups) {
    const name = names.get(`${g.codeHash}:${g.hashType}`);
    if (name) g.name = name;
  }

  return {
    hash: typeof target === "string" ? target : "(not on chain)",
    status,
    ...(cycles !== undefined && { nodeCycles: cycles }),
    mock,
    groups,
    // `hash_type: "type"` scripts run on the VM of their block's epoch; a
    // transaction not yet in a block would run on the current one.
    scriptVersion: options.scriptVersion ?? (epoch === undefined ? 2 : scriptVersionAt(network, epoch)),
    network,
    rpcUrl,
  };
}

/**
 * Runs one group in a ckb-debugger with `args` (from `debuggerArgs`) and
 * returns what it printed, stdout and stderr together.
 */
export type RunDebugger = (args: string[]) => Promise<string>;

/**
 * Replays every group of a plan, one after another, through `run`. The mock
 * transaction must already be readable by that debugger at `txFile`.
 * `onGroup` hears about each group before it runs, for progress.
 */
export async function replayGroups(
  plan: ReplayPlan,
  run: RunDebugger,
  options: { txFile: string; debugger: string; onGroup?: (index: number, selector: string) => void },
): Promise<Profile> {
  const profiled: ProfiledGroup[] = [];
  // Sequential on purpose: output stays readable and the machine stays usable.
  for (const [i, g] of plan.groups.entries()) {
    const selector = selectorFor(g);
    options.onGroup?.(i, selector);
    if (g.role === "type" && g.codeHash === TYPE_ID_CODE_HASH && g.hashType === "type") {
      const error = checkTypeId(g, plan.mock.tx as RpcTransaction);
      const verdict = error ? { result: -1, error } : { result: 0 };
      profiled.push({ ...g, name: "TypeId (built in)", selector, ...verdict, cycles: TYPE_ID_CYCLES, logs: [] });
      continue;
    }
    const out = await run(debuggerArgs(options.txFile, selector, plan.scriptVersion));
    profiled.push({ ...g, selector, ...parseDebuggerOutput(out) });
  }
  return {
    hash: plan.hash,
    status: plan.status,
    ...(plan.nodeCycles !== undefined && { nodeCycles: plan.nodeCycles }),
    measuredCycles: profiled.reduce((sum, g) => sum + g.cycles, 0n),
    groups: profiled,
    env: { debugger: options.debugger, network: plan.network, rpcUrl: plan.rpcUrl, scriptVersion: plan.scriptVersion },
  };
}

/** How a profile's total compares with the node's: what the CLI and the web page both print. */
export function nodeVerdict(p: Profile): "match" | "mismatch" | "not recorded" | undefined {
  if (p.nodeCycles !== undefined) return p.nodeCycles === p.measuredCycles ? "match" : "mismatch";
  return p.status === "committed" ? "not recorded" : undefined;
}

/**
 * Reads a transaction from JSON in any of the shapes people have at hand: the
 * node's RPC shape, a `get_transaction` result (`{ transaction }`), or a CCC
 * transaction saved with `ccc.stringify`.
 */
export function readTransactionJson(json: string): RpcTransaction {
  let value = JSON.parse(json);
  if (value && typeof value === "object" && "transaction" in value) value = value.transaction;
  if (value && typeof value === "object" && "cellDeps" in value) {
    const tx = cccA.JsonRpcTransformers.transactionFrom(ccc.Transaction.from(value)) as unknown as RpcTransaction;
    // CCC leaves out an absent type; the node writes it as null.
    return { ...tx, outputs: tx.outputs.map((o) => ({ ...o, type: o.type ?? null })) };
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.cell_deps) || !Array.isArray(value.inputs)) {
    throw new Error("not a CKB transaction: expected RPC fields (cell_deps, inputs, …) or a CCC transaction");
  }
  return value as RpcTransaction;
}

const HASH_TYPES = ["type", "data", "data1", "data2"];

/** `--name 0xabc…=campaign-lock` (or `0xabc…:type=…`) → profileTransaction's scriptNames. */
export function parseNames(flags: string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const flag of flags) {
    const m = /^(0x[0-9a-fA-F]{64})(?::(\w+))?=(.+)$/.exec(flag);
    if (!m || (m[2] && !HASH_TYPES.includes(m[2]))) {
      throw new Error(`--name expects <code-hash>[:<hash-type>]=<label>, got "${flag}"`);
    }
    for (const t of m[2] ? [m[2]] : HASH_TYPES) names[`${m[1].toLowerCase()}:${t}`] = m[3];
  }
  return names;
}

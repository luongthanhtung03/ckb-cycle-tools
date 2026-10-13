import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { groupScripts, knownScriptNames, type ScriptGroup } from "./analyze.js";
import { resolveDebugger } from "./debugger.js";
import {
  buildMockTransaction,
  httpRpc,
  isCellbase,
  mockFromTransaction,
  scriptVersionAt,
  type RpcScript,
  type RpcTransaction,
} from "./mock.js";

const run = promisify(execFile);

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

export interface ProfileOptions {
  network?: "testnet" | "mainnet";
  /** A node to fetch from instead of the public one for `network`. */
  rpcUrl?: string;
  debuggerPath?: string;
  /**
   * Names for scripts this tool cannot know, e.g. on a devnet: `codeHash:hashType`
   * (lowercase hex) → name. They take precedence over the known scripts.
   */
  scriptNames?: Record<string, string>;
}

/**
 * Type ID is verified natively by the node rather than by a script binary, so
 * ckb-debugger cannot run it. The node charges it a fixed cost (TYPE_ID_CYCLES
 * in ckb-script).
 */
export const TYPE_ID_CODE_HASH = "0x00000000000000000000000000000000000000000000000000545950455f4944";
export const TYPE_ID_CYCLES = 1_000_000n;

const RPC = { testnet: "https://testnet.ckb.dev/", mainnet: "https://mainnet.ckb.dev/" };

const toScript = (s: RpcScript): ccc.ScriptLike => ({ codeHash: s.code_hash, hashType: s.hash_type as ccc.HashType, args: s.args });

/** The first cell in a group is enough: ckb-debugger runs the whole group from it. */
export function selectorFor(g: ScriptGroup): string {
  if (g.inputs.length) return `input.${g.inputs[0]}.${g.role}`;
  return `output.${g.outputs[0]}.${g.role}`;
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

const u64le = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

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
  const cellInput = Buffer.concat([
    u64le(BigInt(first.since)),
    Buffer.from(first.previous_output.tx_hash.slice(2), "hex"),
    Buffer.from(Uint32Array.of(Number(first.previous_output.index)).buffer),
  ]);
  const expected = ccc.hashCkb(Buffer.concat([cellInput, u64le(g.outputs[0])]));
  return expected === g.args.toLowerCase() ? undefined : "type id: args do not match the first input";
}

/**
 * Profiles a transaction per script group: a committed one by hash (and checks
 * the node's total), or any transaction in RPC shape — e.g. one about to be sent,
 * or one the node rejected — to see which script refuses it, with what exit code,
 * and what it cost to get there.
 */
export async function profileTransaction(
  target: string | RpcTransaction,
  options: ProfileOptions = {},
): Promise<Profile> {
  const network = options.network ?? "testnet";
  const rpcUrl = options.rpcUrl ?? RPC[network];
  const rpc = httpRpc(rpcUrl);
  const debuggerPath = options.debuggerPath ?? resolveDebugger();

  const { mock, cycles, status, epoch } =
    typeof target === "string"
      ? await buildMockTransaction(rpc, target)
      : { mock: await mockFromTransaction(rpc, target), cycles: undefined, status: "not on chain", epoch: undefined };
  const hash = typeof target === "string" ? target : "(not on chain)";
  // `hash_type: "type"` scripts run on the VM of their block's epoch; a
  // transaction not yet in a block would run on the current one.
  const scriptVersion = epoch === undefined ? 2 : scriptVersionAt(network, epoch);
  // A cellbase runs no scripts at all.
  const groups = isCellbase(mock.tx as RpcTransaction)
    ? []
    : groupScripts(
        mock.mock_info.inputs.map((c) => ({ lock: toScript(c.output.lock), type: c.output.type && toScript(c.output.type) })),
        mock.tx.outputs.map((o) => ({ lock: toScript(o.lock), type: o.type && toScript(o.type) })),
      );

  // Known-script names are CCC's table for `network`, through the same node;
  // a network CCC does not know (a devnet) names its scripts with `scriptNames`.
  const client =
    network === "mainnet" ? new ccc.ClientPublicMainnet({ url: rpcUrl }) : new ccc.ClientPublicTestnet({ url: rpcUrl });
  const names = await knownScriptNames(client);
  for (const [k, name] of Object.entries(options.scriptNames ?? {})) names.set(k.toLowerCase(), name);
  const debuggerVersion = await run(debuggerPath, ["--version"]).then(
    (r) => r.stdout.trim(),
    () => "unknown",
  );

  const dir = await mkdtemp(join(tmpdir(), "ckb-cycles-"));
  try {
    const file = join(dir, "tx.json");
    await writeFile(file, JSON.stringify(mock));
    const profiled: ProfiledGroup[] = [];
    // Sequential on purpose: output stays readable and the machine stays usable.
    for (const g of groups) {
      const selector = selectorFor(g);
      if (g.role === "type" && g.codeHash === TYPE_ID_CODE_HASH && g.hashType === "type") {
        const error = checkTypeId(g, mock.tx as RpcTransaction);
        const verdict = error ? { result: -1, error } : { result: 0 };
        profiled.push({ ...g, name: "TypeId (built in)", selector, ...verdict, cycles: TYPE_ID_CYCLES, logs: [] });
        continue;
      }
      // ckb-debugger exits non-zero when a script rejects; its output still says why.
      const args = ["--tx-file", file, "--script", selector, "--script-version", String(scriptVersion)];
      const out = await run(debuggerPath, args, { maxBuffer: 64 << 20 }).then(
        (r) => r.stdout + r.stderr,
        // No output at all means it did not start: say why.
        (e: { stdout?: string; stderr?: string; message?: string }) =>
          (e.stdout ?? "") + (e.stderr ?? "") || String(e.message),
      );
      const name = names.get(`${g.codeHash}:${g.hashType}`);
      profiled.push({ ...g, ...(name && { name }), selector, ...parseDebuggerOutput(out) });
    }
    return {
      hash,
      status,
      ...(cycles !== undefined && { nodeCycles: cycles }),
      measuredCycles: profiled.reduce((sum, g) => sum + g.cycles, 0n),
      groups: profiled,
      env: { debugger: debuggerVersion, network, rpcUrl, scriptVersion },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

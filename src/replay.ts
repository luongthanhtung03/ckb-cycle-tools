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
  nodeConsensus,
  scriptVersionAt,
  type MockTransaction,
  type NodeConsensus,
  type Rpc,
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
  /**
   * The public node to use when there is no `rpcUrl`. When set, the node's own
   * chain (from `get_consensus`) must agree with it, or the replay stops.
   */
  network?: "testnet" | "mainnet";
  /** A node to fetch from instead of the public one for `network`. */
  rpcUrl?: string;
  /** Per RPC request, in milliseconds. Default 30 s. */
  timeoutMs?: number;
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

/** The tail of some output, cleaned for a terminal: enough to see what went wrong, never megabytes. */
export function outputTail(out: string, max = 2048): string {
  const tail = out.length > max ? `…${out.slice(-max)}` : out;
  return tail.trim().replace(CONTROL, "�");
}

/**
 * ckb-debugger's own result lines are the last lines it prints: `Run result:`
 * then `All cycles:` (or `Run result:` alone when the VM stopped the script).
 * A script's logs come before them. Only those final lines are read, so a
 * script that logs "Run result: 0" (even after a newline of its own) cannot
 * fake its result, as long as the output is complete: a run whose output was
 * cut off must never get here (see parseDebuggerRun).
 */
export function parseDebuggerOutput(out: string): Omit<GroupRun, "selector"> {
  const lines = out.trimEnd().split(/\r?\n/);
  const cyclesLine = /^All cycles: (\d+)/.exec(lines.at(-1) ?? "");
  const resultLine = /^Run result: (.*?)\s*$/.exec(lines.at(cyclesLine ? -2 : -1) ?? "");
  if (!resultLine) throw new Error(`unexpected ckb-debugger output:\n${outputTail(out)}`);
  const result = resultLine[1];
  const cycles = cyclesLine?.[1];
  const logs = [...out.matchAll(/^Script log: (.*)$/gm)].map((m) => m[1].trim().replace(CONTROL, "�"));
  if (/^-?\d+$/.test(result) && cycles !== undefined) return { result: Number(result), cycles: BigInt(cycles), logs };
  // The VM stopped the script (invalid instruction, cycle limit, bad ELF…): a rejection, not a crash.
  // Never its cycles: a stopped run's count is not what the script costs (0, or wherever the VM gave up).
  return { result: -1, error: result.replace(CONTROL, "�"), cycles: 0n, logs };
}

/** One ckb-debugger run, as a RunDebugger returns it. */
export interface DebuggerOutput {
  stdout: string;
  stderr: string;
  /** The exit code; null when the process was killed, -1 when the WebAssembly build trapped. */
  exitCode: number | null;
  /** Set when the output cannot be trusted, e.g. it was cut off at the buffer limit. */
  failure?: string;
}

/**
 * Reads one run: its final result lines (parseDebuggerOutput), checked against
 * its exit code. ckb-debugger exits 0 only when the script returned 0, so lines
 * that say 0 with a non-zero exit code (or the reverse) were faked or cut
 * short, and make an error rather than a result. Output that was cut off is
 * never parsed at all.
 */
export function parseDebuggerRun(run: DebuggerOutput): Omit<GroupRun, "selector"> {
  const stopped = (error: string) => ({ result: -1, error, cycles: 0n, logs: [] });
  if (run.failure) return stopped(run.failure);
  if (run.exitCode === null) return stopped("ckb-debugger was killed before it finished");
  // The WebAssembly build trapped (e.g. out of memory): whatever stdout it left is incomplete.
  if (run.exitCode === -1) return stopped(`ckb-debugger crashed: ${outputTail(run.stderr, 500) || "no message"}`);
  let parsed: Omit<GroupRun, "selector">;
  try {
    parsed = parseDebuggerOutput(run.stdout);
  } catch {
    // Nothing usable on stdout: what it said on stderr is the reason.
    throw new Error(`unexpected ckb-debugger output (exit ${run.exitCode}):\n${outputTail(run.stdout + run.stderr)}`);
  }
  if ((parsed.result === 0 && !parsed.error) !== (run.exitCode === 0)) {
    const said = parsed.error ? "an error" : `result ${parsed.result}`;
    return { ...parsed, result: -1, error: `ckb-debugger printed ${said} but exited with ${run.exitCode}: output not trusted` };
  }
  return parsed;
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
  /** "testnet", "mainnet", or a devnet's chain id: what the node says it serves, when it was asked. */
  network: string;
  rpcUrl: string;
}

/** The string fields of a mock transaction that are names, not hex. */
const NAME_FIELDS: Record<string, RegExp> = { hash_type: /^(type|data[0-9]*)$/, dep_type: /^(code|dep_group)$/ };

/**
 * Refuses a mock transaction that ckb-debugger would read as more than data.
 * The debugger expands `{{ data <path> }}`, `{{ hash <path> }}`, `{{ def_type … }}`
 * and `{{ ref_type … }}` in a tx file before parsing it (mock_tx_embed.rs), so
 * such a string embeds any file on the machine that runs it, past `--root`.
 * Every string must be hex (`0x…`), except `hash_type` and `dep_type`, which
 * must be one of their names. Called on every mock before it is written for a
 * debugger (groupsOf, so planReplay, profile, flame and report; wasmRunner).
 */
export function checkMockTransaction(mock: unknown): void {
  const refuse = (path: string, why: string): never => {
    throw new Error(`mock transaction refused: ${path} ${why}`);
  };
  const walk = (v: unknown, path: string, key: string): void => {
    if (typeof v === "string") {
      if (v.includes("{{")) {
        refuse(path, `contains "{{", a ckb-debugger template directive that reads files from the machine running it`);
      }
      const name = NAME_FIELDS[key];
      if (name ? !name.test(v) : !/^0x[0-9a-fA-F]*$/.test(v)) refuse(path, name ? `is not a ${key}` : "is not 0x-prefixed hex");
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k.includes("{{")) refuse(path, `has a key containing "{{", a ckb-debugger template directive`);
        walk(x, /^[A-Za-z_]\w*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, k);
      }
    }
  };
  walk(mock, "mock", "");
}

/**
 * The script groups that run for a mock transaction, in first-appearance order.
 * A cellbase runs none. A mock checkMockTransaction refuses is an error.
 */
export function groupsOf(mock: MockTransaction): ScriptGroup[] {
  checkMockTransaction(mock);
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
  const rpcUrl = options.rpcUrl ?? PUBLIC_RPC[options.network ?? "testnet"];
  const rpc = httpRpc(rpcUrl, { ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }) });
  const isMock = typeof target === "object" && "mock_info" in target;

  // The node's chain and hardfork epochs are asked alongside the transaction:
  // a flag can name the wrong network, the node cannot.
  const [fetched, consensus] = await Promise.all([
    typeof target === "string"
      ? buildMockTransaction(rpc, target).catch((e: Error) => {
          throw new Error(/^transaction not found/.test(e.message) ? `${e.message} on ${rpcUrl}` : e.message);
        })
      : "mock_info" in target
        ? { mock: target, cycles: undefined, status: "not on chain", epoch: undefined }
        : mockFromTransaction(rpc, target).then((mock) => ({ mock, cycles: undefined, status: "not on chain", epoch: undefined })),
    // A ready mock transaction needs no node, and is not sent to one.
    isMock ? undefined : consensusOf(rpc, rpcUrl, options),
  ]);
  const { mock, cycles, status, epoch } = fetched;
  const network = consensus?.network ?? options.network ?? "testnet";
  const groups = groupsOf(mock);

  // Known-script names are CCC's table for the network, through the same node;
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
    // `hash_type: "type"` scripts run on the VM of their block's epoch, on the
    // node's own hardfork schedule; a transaction not yet in a block would run
    // on the current one.
    scriptVersion:
      options.scriptVersion ??
      (epoch === undefined ? 2 : scriptVersionAt(consensus?.vmEpochs ?? (network === "mainnet" ? "mainnet" : "testnet"), epoch)),
    network,
    rpcUrl,
  };
}

/**
 * The node's chain and CKB-VM epochs, from `get_consensus`. Stops when the node
 * serves another chain than `options.network` names. If the node cannot say,
 * the built-in table stands in only for the public node of `network`; for a
 * node given by URL the chain is unknown, so the replay stops.
 */
export async function consensusOf(rpc: Rpc, rpcUrl: string, options: ReplayOptions = {}): Promise<NodeConsensus | undefined> {
  let consensus: NodeConsensus;
  try {
    consensus = await nodeConsensus(rpc);
  } catch (e) {
    if (options.rpcUrl === undefined) return undefined;
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`cannot read the hardfork epochs from ${rpcUrl}, so the CKB-VM version is unknown: ${why}`);
  }
  if (options.network !== undefined && consensus.network !== options.network) {
    throw new Error(`${rpcUrl} serves ${consensus.network} (chain id "${consensus.chain}"), not ${options.network}`);
  }
  return consensus;
}

/**
 * Runs one group in a ckb-debugger with `args` (from `debuggerArgs`) and
 * returns the run: its output and exit code, read with parseDebuggerRun. A
 * plain string (stdout and stderr together) is read without the exit-code check.
 */
export type RunDebugger = (args: string[]) => Promise<DebuggerOutput | string>;

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
    profiled.push({ ...g, selector, ...(typeof out === "string" ? parseDebuggerOutput(out) : parseDebuggerRun(out)) });
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

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccc } from "@ckb-ccc/core";
import { groupScripts, knownScriptNames, type ScriptGroup } from "./analyze.js";
import { resolveDebugger } from "./debugger.js";
import { buildMockTransaction, httpRpc, type RpcScript } from "./mock.js";

const run = promisify(execFile);

export interface GroupRun {
  /** The `--script` selector passed to ckb-debugger, e.g. `input.0.lock`. */
  selector: string;
  /** Exit code of the script: 0 means it accepted the transaction. */
  result: number;
  cycles: bigint;
  /** Lines the script printed through ckb_debug. */
  logs: string[];
}

export type ProfiledGroup = ScriptGroup & GroupRun;

export interface Profile {
  hash: string;
  status: string;
  /** Total cycles as reported by the node. */
  nodeCycles?: bigint;
  /** Sum of the per-group cycles measured by ckb-debugger. */
  measuredCycles: bigint;
  groups: ProfiledGroup[];
}

export interface ProfileOptions {
  network?: "testnet" | "mainnet";
  rpcUrl?: string;
  debuggerPath?: string;
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

export function parseDebuggerOutput(out: string): Omit<GroupRun, "selector"> {
  const result = out.match(/Run result: (-?\d+)/);
  const cycles = out.match(/All cycles: (\d+)/);
  if (!result || !cycles) throw new Error(`unexpected ckb-debugger output:\n${out}`);
  const logs = [...out.matchAll(/^Script log: (.*)$/gm)].map((m) => m[1].trim());
  return { result: Number(result[1]), cycles: BigInt(cycles[1]), logs };
}

export async function profileTransaction(hash: string, options: ProfileOptions = {}): Promise<Profile> {
  const network = options.network ?? "testnet";
  const rpc = httpRpc(options.rpcUrl ?? RPC[network]);
  const debuggerPath = options.debuggerPath ?? resolveDebugger();

  const { mock, cycles, status } = await buildMockTransaction(rpc, hash);
  const groups = groupScripts(
    mock.mock_info.inputs.map((c) => ({ lock: toScript(c.output.lock), type: c.output.type && toScript(c.output.type) })),
    mock.tx.outputs.map((o) => ({ lock: toScript(o.lock), type: o.type && toScript(o.type) })),
  );

  const client = network === "mainnet" ? new ccc.ClientPublicMainnet() : new ccc.ClientPublicTestnet();
  const names = await knownScriptNames(client);

  const dir = await mkdtemp(join(tmpdir(), "ckb-cycles-"));
  try {
    const file = join(dir, "tx.json");
    await writeFile(file, JSON.stringify(mock));
    const profiled: ProfiledGroup[] = [];
    // Sequential on purpose: output stays readable and the machine stays usable.
    for (const g of groups) {
      const selector = selectorFor(g);
      if (g.role === "type" && g.codeHash === TYPE_ID_CODE_HASH && g.hashType === "type") {
        profiled.push({ ...g, name: "TypeId (built in)", selector, result: 0, cycles: TYPE_ID_CYCLES, logs: [] });
        continue;
      }
      // ckb-debugger exits non-zero when a script rejects; its output still says why.
      const out = await run(debuggerPath, ["--tx-file", file, "--script", selector], { maxBuffer: 64 << 20 }).then(
        (r) => r.stdout + r.stderr,
        (e: { stdout?: string; stderr?: string }) => (e.stdout ?? "") + (e.stderr ?? ""),
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
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

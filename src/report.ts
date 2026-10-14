/**
 * `ckb-cycles report`: runs every scenario in a `cycles.json` and records the
 * cycles and result of each script group, for `ckb-cycles diff` to compare.
 *
 * A scenario is a transaction in one of three forms:
 * - `"mock"`: a ckb-debugger mock transaction (every cell it touches, inline).
 *   Needs no node at all, so it is what CI should use.
 * - `"file"`: a transaction in the node's RPC shape (or CCC's), as `--file` reads
 *   it. The cells it spends and depends on are fetched from a node.
 * - `"tx"`: a transaction hash, fetched from a node.
 *
 * `"binaries"` swaps a deployed script for the one built from the commit under
 * test (see substitute.ts for the rules).
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CycleReport, GroupResult, ScenarioResult } from "./diff.js";
import { resultLabel } from "./diff.js";
import { buildMockTransaction, httpRpc, mockFromTransaction, scriptVersionAt, type MockTransaction, type RpcOutPoint } from "./mock.js";
import { parseNames, profileTransaction, readTransactionJson, type Profile } from "./profile.js";
import { consensusOf, nodeVerdict, PUBLIC_RPC } from "./replay.js";
import { substituteBinaries, type BinarySubstitution } from "./substitute.js";

export interface BinaryConfig {
  /** The built binary, relative to the config file. */
  path: string;
  outPoint?: RpcOutPoint;
  codeHash?: string;
}

export interface ScenarioConfig {
  name: string;
  tx?: string;
  file?: string;
  mock?: string;
  /**
   * Binaries to substitute, by name. Each must match a cell dep of this
   * scenario. Without it, every binary is offered, and used where it matches.
   */
  binaries?: string[];
  /** CKB-VM version for `hash_type: "type"` scripts; default: the block's, or 2. */
  scriptVersion?: 0 | 1 | 2;
}

export interface CyclesConfig {
  network?: "testnet" | "mainnet";
  /** A node for `tx` and `file` scenarios, instead of the public one. */
  rpc?: string;
  /** `<code-hash>[:<hash-type>]` → label, as `--name` takes them. */
  names?: Record<string, string>;
  binaries?: Record<string, BinaryConfig>;
  scenarios: ScenarioConfig[];
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Parses and checks a cycles.json, with a message that says what to fix. */
export function parseCyclesConfig(json: string): CyclesConfig {
  const fail = (msg: string): never => {
    throw new Error(`cycles.json: ${msg}`);
  };
  let c: CyclesConfig;
  try {
    c = JSON.parse(json);
  } catch (e) {
    return fail(`not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  if (!c || typeof c !== "object" || !Array.isArray(c.scenarios)) fail(`expected { "scenarios": [ ... ] }`);
  if (c.network !== undefined && c.network !== "testnet" && c.network !== "mainnet") {
    fail(`"network" must be "testnet" or "mainnet"`);
  }
  if (c.names !== undefined) parseNames(Object.entries(c.names).map(([k, v]) => `${k}=${v}`));
  for (const [name, b] of Object.entries(c.binaries ?? {})) {
    if (!b || typeof b.path !== "string") fail(`binary "${name}" needs a "path"`);
    if (!b.outPoint === !b.codeHash) fail(`binary "${name}" needs either "outPoint" or "codeHash"`);
    if (b.codeHash !== undefined && !HASH.test(b.codeHash)) fail(`binary "${name}": "codeHash" must be 0x + 64 hex`);
    if (b.outPoint && (!HASH.test(b.outPoint.tx_hash ?? "") || !/^0x[0-9a-fA-F]+$/.test(b.outPoint.index ?? ""))) {
      fail(`binary "${name}": "outPoint" must be { "tx_hash": "0x…", "index": "0x0" }`);
    }
  }
  const seen = new Set<string>();
  for (const s of c.scenarios) {
    if (!s || typeof s.name !== "string" || !s.name) fail(`every scenario needs a "name"`);
    if (seen.has(s.name)) fail(`two scenarios are named "${s.name}"`);
    seen.add(s.name);
    const sources = [s.tx, s.file, s.mock].filter((v) => v !== undefined);
    if (sources.length !== 1) fail(`scenario "${s.name}" needs exactly one of "tx", "file", "mock"`);
    if (s.tx !== undefined && !HASH.test(s.tx)) fail(`scenario "${s.name}": "tx" must be a transaction hash`);
    for (const b of s.binaries ?? []) if (!c.binaries?.[b]) fail(`scenario "${s.name}" uses unknown binary "${b}"`);
    if (s.scriptVersion !== undefined && ![0, 1, 2].includes(s.scriptVersion)) {
      fail(`scenario "${s.name}": "scriptVersion" must be 0, 1 or 2`);
    }
  }
  return c;
}

export interface ReportOptions {
  debuggerPath?: string;
  /** Overrides the config's node. */
  rpcUrl?: string;
  /** Per RPC request, in milliseconds. Default 30 s. */
  timeoutMs?: number;
  /**
   * Where binary paths resolve, instead of the config file's directory: a
   * checkout of the base commit, so the base report replays the same scenarios
   * with the binaries built from the base.
   */
  binariesRoot?: string;
  /** Called as each scenario finishes, for progress output. */
  onScenario?: (s: ScenarioResult) => void;
}

const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export function groupResults(p: Profile): GroupResult[] {
  return p.groups.map((g) => ({
    selector: g.selector,
    role: g.role,
    script: g.name ?? short(g.codeHash),
    codeHash: g.codeHash,
    hashType: g.hashType,
    result: g.result,
    ...(g.error && { error: g.error }),
    cycles: Number(g.cycles),
  }));
}

/**
 * Runs every scenario of a cycles.json. A scenario that cannot run is recorded
 * with its error rather than ending the report, so one broken scenario does not
 * hide the others' numbers.
 */
export async function runReport(configPath: string, options: ReportOptions = {}): Promise<CycleReport & { errors: string[] }> {
  const config = parseCyclesConfig(await readFile(configPath, "utf8"));
  const dir = dirname(resolve(configPath));
  const binDir = options.binariesRoot ? resolve(options.binariesRoot) : dir;
  // Only a network the config names is checked against the node; otherwise the
  // node says which chain it serves, and its own hardfork epochs are used.
  const network = config.network;
  const rpcUrl = options.rpcUrl ?? config.rpc;
  const baseNames = parseNames(Object.entries(config.names ?? {}).map(([k, v]) => `${k}=${v}`));

  const binaries = new Map<string, Promise<BinarySubstitution>>();
  const binary = (name: string) => {
    let p = binaries.get(name);
    if (!p) {
      const b = config.binaries![name];
      p = readFile(resolve(binDir, b.path)).then(
        (data) => ({
          name,
          data: new Uint8Array(data),
          ...(b.outPoint && { outPoint: b.outPoint }),
          ...(b.codeHash && { codeHash: b.codeHash }),
        }),
        (e: NodeJS.ErrnoException) => {
          const err = new Error(`binary "${name}": cannot read ${b.path} (${e.message}); build it first`);
          // Absent from another checkout (the base): the scenario's code is new there, not broken.
          if (options.binariesRoot && e.code === "ENOENT") missingBinary.add(err);
          throw err;
        },
      );
      binaries.set(name, p);
    }
    return p;
  };
  const used = new Set<string>();
  const missingBinary = new WeakSet<Error>();

  let debuggerVersion: string | undefined;
  const scenarios: ScenarioResult[] = [];
  for (const s of config.scenarios) {
    let result: ScenarioResult;
    try {
      const explicit = s.binaries !== undefined;
      const names = explicit ? s.binaries! : Object.keys(config.binaries ?? {});
      const subs = await Promise.all(names.map(binary));
      const profileOptions = {
        ...(network && { network }),
        ...(rpcUrl && { rpcUrl }),
        ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
        ...(options.debuggerPath && { debuggerPath: options.debuggerPath }),
        ...(s.scriptVersion !== undefined && { scriptVersion: s.scriptVersion }),
      };

      let profile: Profile;
      const warnings: string[] = [];
      if (s.tx && !subs.length) {
        // Nothing to swap: profile it as the CLI does, with the node's check.
        profile = await profileTransaction(s.tx, { ...profileOptions, scriptNames: baseNames });
      } else {
        const url = rpcUrl ?? PUBLIC_RPC[network ?? "testnet"];
        const rpc = () => httpRpc(url, { ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }) });
        let mock: MockTransaction;
        let scriptVersion = s.scriptVersion;
        if (s.mock) {
          mock = JSON.parse(await readFile(resolve(dir, s.mock), "utf8"));
          if (!mock?.mock_info || !mock.tx) throw new Error(`${s.mock} is not a ckb-debugger mock transaction`);
        } else if (s.file) {
          mock = await mockFromTransaction(rpc(), readTransactionJson(await readFile(resolve(dir, s.file), "utf8")));
        } else {
          const node = rpc();
          const [built, consensus] = await Promise.all([
            buildMockTransaction(node, s.tx!),
            consensusOf(node, url, { ...(network && { network }), ...(rpcUrl && { rpcUrl }) }),
          ]);
          mock = built.mock;
          if (scriptVersion === undefined && built.epoch !== undefined) {
            scriptVersion = scriptVersionAt(consensus?.vmEpochs ?? network ?? "testnet", built.epoch);
          }
        }
        const { mock: swapped, applied } = substituteBinaries(mock, subs, { skipUnmatched: !explicit });
        // A substituted binary is labelled by its name; "names" still wins.
        const scriptNames: Record<string, string> = {};
        for (const a of applied) {
          used.add(a.name!);
          for (const k of a.scriptKeys) scriptNames[k] = a.name!;
          warnings.push(...a.warnings.map((w) => `${a.name}: ${w}`));
        }
        Object.assign(scriptNames, baseNames);
        profile = await profileTransaction(swapped, {
          ...profileOptions,
          ...(scriptVersion !== undefined && { scriptVersion }),
          scriptNames,
        });
      }
      debuggerVersion ??= profile.env.debugger;
      // Kept with the scenario: numbers that do not add up to the node's are not to be trusted.
      if (nodeVerdict(profile) === "mismatch") {
        warnings.push(`the groups add up to ${profile.measuredCycles} cycles, the node reported ${profile.nodeCycles}`);
      }
      result = { name: s.name, groups: groupResults(profile), ...(warnings.length && { warnings }) };
    } catch (e) {
      result = {
        name: s.name,
        error: e instanceof Error ? e.message : String(e),
        groups: [],
        ...(e instanceof Error && missingBinary.has(e) && { binaryMissing: true }),
      };
    }
    scenarios.push(result);
    options.onScenario?.(result);
  }

  const errors = scenarios.filter((s) => s.error).map((s) => `scenario "${s.name}": ${s.error}`);
  // A binary offered to every scenario that none of them uses is almost always
  // a wrong out point or code hash: the report would measure the old code.
  // Only said when every scenario ran: one that failed may be the one that uses it.
  const offered =
    !errors.length && config.scenarios.some((s) => s.binaries === undefined) ? Object.keys(config.binaries ?? {}) : [];
  for (const name of offered) {
    if (!used.has(name) && !config.scenarios.some((s) => s.binaries?.includes(name))) {
      errors.push(`binary "${name}" matched no cell dep in any scenario: check its outPoint / codeHash`);
    }
  }
  return {
    tool: "ckb-cycles",
    version: 1,
    ...(debuggerVersion && { debugger: debuggerVersion }),
    scenarios,
    errors,
  };
}

/** The report for a terminal: one block per scenario. */
export function formatReport(report: CycleReport): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const rows = report.scenarios.flatMap((s) =>
    s.error
      ? [[s.name, "", "", "error", ""]]
      : s.groups.map((g) => [s.name, g.selector, g.script, resultLabel(g), fmt(g.cycles)]),
  );
  const head = ["SCENARIO", "GROUP", "SCRIPT", "RESULT", "CYCLES"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 4 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ").trimEnd();
  const out = [line(head), ...rows.map(line)];
  for (const s of report.scenarios) if (s.error) out.push("", `${s.name}: ${s.error}`);
  for (const s of report.scenarios) for (const w of s.warnings ?? []) out.push("", `${s.name}: warning: ${w}`);
  for (const s of report.scenarios) {
    for (const g of s.groups.filter((g) => g.error)) out.push("", `${s.name} ${g.selector} stopped: ${g.error}`);
  }
  if (report.debugger) out.push("", report.debugger);
  return out.join("\n");
}

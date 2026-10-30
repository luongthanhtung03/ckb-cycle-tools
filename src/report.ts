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
 * test (see substitute.ts for the rules). A binary with `"symbols"` (an
 * unstripped build of the same code) can also say which functions its cycles
 * went to, in scenarios with `"functions": true`.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CycleReport, GroupResult, ScenarioResult } from "./diff.js";
import { FUNCTION_LIMIT, resultLabel, termLine, termLines } from "./diff.js";
import { functionCosts } from "./flame.js";
import { buildMockTransaction, httpRpc, mockFromTransaction, scriptVersionAt, type MockTransaction, type RpcOutPoint } from "./mock.js";
import { flameTransaction, parseNames, profileTransaction, readTransactionJson, type Profile, type ProfileOptions } from "./profile.js";
import { consensusOf, nodeVerdict, PUBLIC_RPC } from "./replay.js";
import { substituteBinaries, type BinarySubstitution } from "./substitute.js";

export interface BinaryConfig {
  /** The built binary, relative to the config file. */
  path: string;
  outPoint?: RpcOutPoint;
  codeHash?: string;
  /**
   * An unstripped build of the same code, relative to the config file like
   * `path`: run in ckb-debugger's flamegraph mode (`--bin`) to name the
   * functions, in scenarios that ask for `functions`.
   */
  symbols?: string;
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
  /** Record the costliest functions of each group whose binary has `symbols`. Default: the config's `functions`. */
  functions?: boolean;
}

export interface CyclesConfig {
  network?: "testnet" | "mainnet";
  /** A node for `tx` and `file` scenarios, instead of the public one. */
  rpc?: string;
  /** `<code-hash>[:<hash-type>]` → label, as `--name` takes them. */
  names?: Record<string, string>;
  binaries?: Record<string, BinaryConfig>;
  /** The default of every scenario's `functions`. */
  functions?: boolean;
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
    if (b.symbols !== undefined && (typeof b.symbols !== "string" || !b.symbols)) fail(`binary "${name}": "symbols" must be a path`);
  }
  if (c.functions !== undefined && typeof c.functions !== "boolean") fail(`"functions" must be true or false`);
  const seen = new Set<string>();
  for (const s of c.scenarios) {
    if (!s || typeof s.name !== "string" || !s.name) fail(`every scenario needs a "name"`);
    if (seen.has(s.name)) fail(`two scenarios are named "${s.name}"`);
    seen.add(s.name);
    const sources = [s.tx, s.file, s.mock].filter((v) => v !== undefined);
    if (sources.length !== 1) fail(`scenario "${s.name}" needs exactly one of "tx", "file", "mock"`);
    for (const k of ["file", "mock"] as const) {
      if (s[k] !== undefined && (typeof s[k] !== "string" || !s[k])) fail(`scenario "${s.name}": "${k}" must be a path`);
    }
    if (s.tx !== undefined && !HASH.test(s.tx)) fail(`scenario "${s.name}": "tx" must be a transaction hash`);
    for (const b of s.binaries ?? []) if (!c.binaries?.[b]) fail(`scenario "${s.name}" uses unknown binary "${b}"`);
    if (s.scriptVersion !== undefined && ![0, 1, 2].includes(s.scriptVersion)) {
      fail(`scenario "${s.name}": "scriptVersion" must be 0, 1 or 2`);
    }
    if (s.functions !== undefined && typeof s.functions !== "boolean") fail(`scenario "${s.name}": "functions" must be true or false`);
  }
  // Functions come only from a symbols build: asking without one would record nothing, silently.
  if (c.scenarios.some((s) => s.functions ?? c.functions) && !Object.values(c.binaries ?? {}).some((b) => b.symbols)) {
    fail(`"functions" needs a binary with "symbols" (an unstripped build of the same code)`);
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
  /**
   * Directories every file the config names (mocks, transaction files,
   * binaries, symbols builds) must be inside, symlinks resolved: in CI, the
   * checkouts, so a pull request's cycles.json cannot read the rest of the
   * runner into the report. Default: anywhere.
   */
  roots?: string[];
  /** Called as each scenario finishes, for progress output. */
  onScenario?: (s: ScenarioResult) => void;
  /** Runs ckb-debugger instead of the native binary (see ProfileOptions): for tests. */
  runDebugger?: ProfileOptions["runDebugger"];
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
export async function runReport(
  configPath: string,
  options: ReportOptions = {},
): Promise<CycleReport & { errors: string[]; notices?: string[] }> {
  const config = parseCyclesConfig(await readFile(configPath, "utf8"));
  const dir = dirname(resolve(configPath));
  const binDir = options.binariesRoot ? resolve(options.binariesRoot) : dir;
  // Only a network the config names is checked against the node; otherwise the
  // node says which chain it serves, and its own hardfork epochs are used.
  const network = config.network;
  const roots = options.roots?.length ? await Promise.all(options.roots.map((r) => realpath(resolve(r)))) : undefined;
  // With roots the config is untrusted (a pull request's): it does not choose
  // the host the runner sends requests to. Only --rpc, or the public node.
  const notices: string[] = [];
  if (roots && config.rpc !== undefined && options.rpcUrl === undefined) {
    notices.push(`cycles.json "rpc" ignored under --root: the config does not choose the node; pass --rpc to use another`);
  }
  const rpcUrl = options.rpcUrl ?? (roots ? undefined : config.rpc);
  const baseNames = parseNames(Object.entries(config.names ?? {}).map(([k, v]) => `${k}=${v}`));

  const inside = (file: string) => confine(file, roots);

  const binaries = new Map<string, Promise<BinarySubstitution>>();
  const binary = (name: string) => {
    let p = binaries.get(name);
    if (!p) {
      const b = config.binaries![name];
      p = inside(resolve(binDir, b.path))
        .then((file) => readFile(file))
        .then(
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
        ...(options.runDebugger && { runDebugger: options.runDebugger }),
        ...(s.scriptVersion !== undefined && { scriptVersion: s.scriptVersion }),
      };

      let profile: Profile;
      let groups: GroupResult[] | undefined;
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
          mock = JSON.parse(await readFile(await inside(resolve(dir, s.mock)), "utf8"));
          if (!mock?.mock_info || !mock.tx) throw new Error(`${s.mock} is not a ckb-debugger mock transaction`);
        } else if (s.file) {
          mock = await mockFromTransaction(rpc(), readTransactionJson(await readFile(await inside(resolve(dir, s.file)), "utf8")));
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
        // The scripts whose code is a binary with symbols, when the scenario asks for functions.
        const symbols = new Map<string, string>();
        if (s.functions ?? config.functions) {
          for (const a of applied) {
            const sym = config.binaries![a.name!].symbols;
            if (sym) for (const k of a.scriptKeys) symbols.set(k.toLowerCase(), sym);
          }
        }
        if (symbols.size) {
          groups = groupResults(profile);
          await recordFunctions(groups, swapped, symbols, binDir, inside, {
            ...profileOptions,
            ...(scriptVersion !== undefined && { scriptVersion }),
          });
        }
      }
      debuggerVersion ??= profile.env.debugger;
      // Kept with the scenario: numbers that do not add up to the node's are not to be trusted.
      if (nodeVerdict(profile) === "mismatch") {
        warnings.push(`the groups add up to ${profile.measuredCycles} cycles, the node reported ${profile.nodeCycles}`);
      }
      result = { name: s.name, groups: groups ?? groupResults(profile), ...(warnings.length && { warnings }) };
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
    ...(notices.length && { notices }),
  };
}

/**
 * Adds `functions` to each group whose script (`codeHash:hashType`) is in
 * `symbols` (to the symbols build's path in the config), from a flamegraph run
 * of that group with that build. A build that does not cost the same cycles as
 * the binary it stands for is not the same code: the group gets a warning instead.
 */
async function recordFunctions(
  groups: GroupResult[],
  mock: MockTransaction,
  symbols: Map<string, string>,
  binDir: string,
  inside: (file: string) => Promise<string>,
  options: ProfileOptions,
): Promise<void> {
  const fmt = (n: bigint | number) => n.toLocaleString("en-US");
  const symbolsOf = (g: GroupResult) => symbols.get(`${g.codeHash}:${g.hashType}`.toLowerCase());
  const wanted = groups.filter((g) => symbolsOf(g));
  const bins: Record<string, string> = {};
  for (const g of wanted) {
    let file: string;
    try {
      file = await inside(resolve(binDir, symbolsOf(g)!));
    } catch (e) {
      g.functionsWarning = e instanceof Error ? e.message : String(e);
      continue;
    }
    // A missing build is said on its group; the cycles are measured all the same.
    const found = await stat(file).then(
      (st) => st.isFile(),
      () => false,
    );
    if (found) bins[g.codeHash] = file;
    else g.functionsWarning = `cannot read the symbols build ${symbolsOf(g)}: build it first`;
  }
  const run = wanted.filter((g) => bins[g.codeHash]);
  if (!run.length) return;
  let flame: Awaited<ReturnType<typeof flameTransaction>>;
  try {
    flame = await flameTransaction(mock, {
      ...options,
      bins,
      scripts: run.map((g) => g.selector),
      readFile: (path) => readFile(path, "utf8"),
    });
  } catch (e) {
    for (const g of run) g.functionsWarning = `the flamegraph run failed: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  for (const g of run) {
    const f = flame.groups.find((f) => f.selector === g.selector);
    if (!f) g.functionsWarning = "the flamegraph run did not profile this group";
    else if (f.cycles !== BigInt(g.cycles) || resultLabel(f) !== resultLabel(g)) {
      g.functionsWarning =
        `the symbols build ${symbolsOf(g)} runs ${fmt(f.cycles)} cycles (${resultLabel(f)}), the binary ${fmt(g.cycles)} (${resultLabel(g)}): ` +
        "not the same code, so its functions would not describe this binary";
    } else if (!f.folded.size) g.functionsWarning = "the profiler recorded no stacks";
    else {
      g.functions = functionCosts(f.folded)
        .slice(0, FUNCTION_LIMIT)
        .map((c) => ({ name: c.name, self: Number(c.self), total: Number(c.total) }));
    }
  }
}

/**
 * `file` with its symlinks resolved, when it is inside one of `roots` (already
 * resolved); an error otherwise. A file that does not exist is checked by its
 * path and returned as given, so reading it fails with the usual ENOENT (a
 * binary absent from the base is a new binary, not an error).
 */
export async function confine(file: string, roots: string[] | undefined): Promise<string> {
  if (!roots) return file;
  const real = await realpath(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return undefined;
    throw e;
  });
  const within = (p: string) =>
    roots.some((root) => {
      const rel = relative(root, p);
      return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    });
  if (!within(real ?? (await realParent(resolve(file))))) {
    throw new Error(`${file} is outside the checkout (${roots.join(", ")}): not read`);
  }
  return real ?? file;
}

/**
 * A missing file's path with its nearest existing ancestor resolved, so it compares
 * like the roots do (Windows runners' temp dir is an 8.3 short name, RUNNER~1).
 */
async function realParent(p: string): Promise<string> {
  const parent = dirname(p);
  if (parent === p) return p;
  try {
    return join(await realpath(parent), basename(p));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return join(await realParent(parent), basename(p));
  }
}

/**
 * The report for a terminal: one block per scenario. Every name, warning and
 * error from the config, the build or the debugger goes through termLine (or
 * termLines), so none can start a log line of its own.
 */
export function formatReport(report: CycleReport): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const t = termLine;
  const rows = report.scenarios.flatMap((s) =>
    s.error
      ? [[t(s.name), "", "", "error", ""]]
      : s.groups.map((g) => [t(s.name), t(g.selector), t(g.script), t(resultLabel(g)), fmt(g.cycles)]),
  );
  const head = ["SCENARIO", "GROUP", "SCRIPT", "RESULT", "CYCLES"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 4 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ").trimEnd();
  const out = [line(head), ...rows.map(line)];
  for (const s of report.scenarios) if (s.error) out.push("", `${t(s.name)}: ${termLines(s.error)}`);
  for (const s of report.scenarios) for (const w of s.warnings ?? []) out.push("", `${t(s.name)}: warning: ${t(w)}`);
  for (const s of report.scenarios) {
    for (const g of s.groups.filter((g) => g.error)) out.push("", `${t(s.name)} ${t(g.selector)} stopped: ${t(g.error!)}`);
  }
  for (const s of report.scenarios) {
    for (const g of s.groups) {
      if (g.functionsWarning) out.push("", `${t(s.name)} ${t(g.selector)}: functions not recorded: ${t(g.functionsWarning)}`);
      else if (g.functions?.length) {
        const top = g.functions.slice(0, 3).map((f) => `${t(f.name)} ${fmt(f.self)}`);
        out.push("", `${t(s.name)} ${t(g.selector)}: costliest functions (self cycles): ${top.join(", ")}`);
      }
    }
  }
  if (report.debugger) out.push("", t(report.debugger));
  return out.join("\n");
}

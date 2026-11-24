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
 * unstripped build of the same code), or with `"map"` (the linker map its own
 * stripped build wrote), can also say which functions its cycles went to, in
 * scenarios with `"functions": true`.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SERVER_EXIT_NOTE } from "./children.js";
import { checkDebuggerPath, resolveDebugger } from "./debugger.js";
import type { ChildResult, CycleReport, GroupResult, ReportManifest, ScenarioManifest, ScenarioResult } from "./diff.js";
import { FUNCTION_LIMIT, overTxLimitOf, resultLabel, spawnNote, termLine, termLines, unmatchedError } from "./diff.js";
import { foldedTotal, functionCosts } from "./flame.js";
import { buildMockTransaction, httpRpc, mockFromTransaction, scriptVersionAt, type MockTransaction, type RpcOutPoint } from "./mock.js";
import { fileDigest, gitCommit, inputsHash, scenarioInputs, sha256, toolchainOf, toolIdentity } from "./manifest.js";
import { flameTransaction, parseNames, profileTransaction, readTransactionJson, type FlameChild, type Profile, type ProfileOptions } from "./profile.js";
import { consensusOf, nodeVerdict, overTxLimitLines, PUBLIC_RPC } from "./replay.js";
import { substituteBinaries, targetScriptKeys, type BinarySubstitution } from "./substitute.js";

export { SERVER_EXIT_NOTE };

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
  /**
   * The linker map (`-Map`, GNU ld or lld) written by the build of `path`
   * itself, relative to the config file like `path`: names the functions of
   * that stripped binary, as `flame --map` does. The binary runs as it is; the
   * map's functions are written into a copy of it as a symbol table, which
   * ckb-debugger only reads for where functions start (`--vm-symbols`,
   * 1.1.2 and later). A map whose `.text` or `_start` is not the binary's is
   * refused. `symbols`, when given too, wins.
   */
  map?: string;
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
    if (b.map !== undefined && (typeof b.map !== "string" || !b.map)) fail(`binary "${name}": "map" must be a path`);
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
  // Functions come only from a symbols build or a linker map: asking without either would record nothing, silently.
  if (c.scenarios.some((s) => s.functions ?? c.functions) && !Object.values(c.binaries ?? {}).some((b) => b.symbols || b.map)) {
    fail(`"functions" needs a binary with "symbols" (an unstripped build of the same code) or "map" (the linker map of its build)`);
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
  /**
   * With `runDebugger`: what it runs, for the manifest (a WebAssembly build's
   * id, or a native binary's sha256). Without `runDebugger`, the binary that
   * runs is hashed instead.
   */
  debuggerBuild?: { wasm?: string; sha256?: string };
  /** Free text for the manifest: the compiler and build profile the binaries were built with (e.g. `rustc -V`). */
  toolchain?: string;
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
    ...(g.nodeReaches !== undefined && { nodeReaches: g.nodeReaches }),
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
): Promise<CycleReport & { errors: string[]; notices?: string[]; manifest: ReportManifest }> {
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

  // The manifest: what the numbers were measured with. The debugger is resolved
  // once, so the binary hashed is the one every scenario runs; when it cannot be
  // found, each scenario says so as before.
  let debuggerPath: string | undefined;
  if (!options.runDebugger) {
    try {
      debuggerPath = options.debuggerPath ? checkDebuggerPath(options.debuggerPath) : resolveDebugger();
    } catch {
      debuggerPath = undefined;
    }
  }
  const environment = Promise.all([
    toolIdentity(),
    debuggerPath ? fileDigest(debuggerPath).catch(() => undefined) : Promise.resolve(undefined),
    gitCommit(dir),
    options.binariesRoot ? gitCommit(binDir) : Promise.resolve(undefined),
  ]);
  const scenarioManifests: ScenarioManifest[] = [];
  /** Binary name → what was read: for the manifest of the scenarios it is swapped into. */
  const digests = new Map<string, { path: string; sha256: string; size: number }>();

  // A binary resolves to null when it is absent from another checkout (the
  // base, --binaries-from): that binary is new there, not broken. Only it, and
  // the groups whose code it is, count as new; every other binary still swaps in.
  const binaries = new Map<string, Promise<BinarySubstitution | null>>();
  const binary = (name: string) => {
    let p = binaries.get(name);
    if (!p) {
      const b = config.binaries![name];
      p = inside(resolve(binDir, b.path))
        .then((file) => readFile(file))
        .then(
        (data): BinarySubstitution => {
          digests.set(name, { path: b.path, sha256: sha256(data), size: data.length });
          return {
            name,
            data: new Uint8Array(data),
            ...(b.outPoint && { outPoint: b.outPoint }),
            ...(b.codeHash && { codeHash: b.codeHash }),
          };
        },
        (e: NodeJS.ErrnoException) => {
          if (options.binariesRoot && e.code === "ENOENT") {
            missingNames.add(name);
            return null;
          }
          throw new Error(`binary "${name}": cannot read ${b.path} (${e.message}); build it first`);
        },
      );
      binaries.set(name, p);
    }
    return p;
  };
  const used = new Set<string>();
  const missingNames = new Set<string>();

  let debuggerVersion: string | undefined;
  const scenarios: ScenarioResult[] = [];
  for (const s of config.scenarios) {
    let result: ScenarioResult;
    const sm: ScenarioManifest = { name: s.name };
    const entry = scenarioInputs(s, network);
    // A tx scenario has no file: its entry (the hash) is its input.
    if (s.tx !== undefined) sm.inputs = inputsHash(entry);
    try {
      const explicit = s.binaries !== undefined;
      const names = explicit ? s.binaries! : Object.keys(config.binaries ?? {});
      const loaded = await Promise.all(names.map(binary));
      const subs = loaded.filter((b): b is BinarySubstitution => b !== null);
      const missing = names.filter((_, i) => loaded[i] === null);
      /** `codeHash:hashType` (lower case) → the missing binary that code stands for. */
      const missingKeys = new Map<string, string>();
      const substituted: string[] = [];
      const unmatched: string[] = [];
      const profileOptions = {
        ...(network && { network }),
        ...(rpcUrl && { rpcUrl }),
        ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
        // The binary the manifest hashed; an explicit path that does not check out fails each scenario, as before.
        ...((debuggerPath ?? options.debuggerPath) && { debuggerPath: debuggerPath ?? options.debuggerPath }),
        ...(options.runDebugger && { runDebugger: options.runDebugger }),
        ...(s.scriptVersion !== undefined && { scriptVersion: s.scriptVersion }),
      };

      let profile: Profile;
      let groups: GroupResult[] | undefined;
      const warnings: string[] = [];
      if (s.tx && !subs.length && !missing.length) {
        // Nothing to swap: profile it as the CLI does, with the node's check.
        profile = await profileTransaction(s.tx, { ...profileOptions, scriptNames: baseNames });
      } else {
        const url = rpcUrl ?? PUBLIC_RPC[network ?? "testnet"];
        const rpc = () => httpRpc(url, { ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }) });
        let mock: MockTransaction;
        let scriptVersion = s.scriptVersion;
        // The node's own limit for one transaction, when its consensus is fetched here.
        let txCycleLimit: bigint | undefined;
        if (s.mock) {
          const bytes = await readFile(await inside(resolve(dir, s.mock)));
          sm.inputs = inputsHash(entry, bytes);
          mock = JSON.parse(bytes.toString("utf8"));
          if (!mock?.mock_info || !mock.tx) throw new Error(`${s.mock} is not a ckb-debugger mock transaction`);
        } else if (s.file) {
          const bytes = await readFile(await inside(resolve(dir, s.file)));
          sm.inputs = inputsHash(entry, bytes);
          mock = await mockFromTransaction(rpc(), readTransactionJson(bytes.toString("utf8")));
        } else {
          const node = rpc();
          const [built, consensus] = await Promise.all([
            buildMockTransaction(node, s.tx!),
            consensusOf(node, url, { ...(network && { network }), ...(rpcUrl && { rpcUrl }) }),
          ]);
          mock = built.mock;
          txCycleLimit = consensus?.maxBlockCycles;
          if (scriptVersion === undefined && built.epoch !== undefined) {
            scriptVersion = scriptVersionAt(consensus?.vmEpochs ?? network ?? "testnet", built.epoch);
          }
        }
        const { mock: swapped, applied } = substituteBinaries(mock, subs, { skipUnmatched: !explicit });
        // A substituted binary is labelled by its name; "names" still wins.
        const scriptNames: Record<string, string> = {};
        for (const a of applied) {
          used.add(a.name!);
          substituted.push(a.name!);
          for (const k of a.scriptKeys) scriptNames[k] = a.name!;
          warnings.push(...a.warnings.map((w) => `${a.name}: ${w}`));
        }
        // Offered, and no cell dep here is its code: this scenario's scripts run
        // the mock's own code, not this build (a mock dumped from an older build?).
        for (const sub of subs) {
          if (!substituted.includes(sub.name!)) {
            unmatched.push(sub.name!);
            warnings.push(
              `binary "${sub.name}" matches no cell dep in this scenario: any script of it here runs the mock's code, not this build (check its outPoint / codeHash, or re-dump the mock)`,
            );
          }
        }
        // Left as the mock has it: those groups measure the mock's code, not the build.
        for (const name of missing) {
          for (const k of targetScriptKeys(swapped, config.binaries![name])) missingKeys.set(k, name);
        }
        Object.assign(scriptNames, baseNames);
        profile = await profileTransaction(swapped, {
          ...profileOptions,
          ...(scriptVersion !== undefined && { scriptVersion }),
          ...(txCycleLimit !== undefined && { txCycleLimit }),
          scriptNames,
        });
        // The scripts whose code is a binary with symbols or a map, when the scenario asks for functions.
        const builds = new Map<string, FunctionSource>();
        // The same builds and maps by data hash: a spawned script is found by the binary it ran, not by a group.
        const vmSources: ChildSources = { symbols: new Map(), maps: new Map() };
        if (s.functions ?? config.functions) {
          for (const a of applied) {
            const { symbols: sym, map } = config.binaries![a.name!];
            // A symbols build wins over a map, as --bin does over --map in flame.
            const source: FunctionSource | undefined = sym
              ? { symbols: sym, ...(map && { mapNote: `map ${map} ignored: the symbols build ${sym} is given for the same binary` }) }
              : map
                ? { map }
                : undefined;
            if (!source) continue;
            for (const k of a.scriptKeys) builds.set(k.toLowerCase(), source);
            if (sym) vmSources.symbols.set(a.newDataHash.toLowerCase(), sym);
            else vmSources.maps.set(a.newDataHash.toLowerCase(), map!);
          }
        }
        if (builds.size) {
          groups = groupResults(profile);
          await recordFunctions(groups, swapped, builds, binDir, inside, {
            ...profileOptions,
            ...(scriptVersion !== undefined && { scriptVersion }),
            scriptNames,
          }, vmSources);
        }
      }
      debuggerVersion ??= profile.env.debugger;
      sm.scriptVersion = profile.env.scriptVersion;
      const swappedIn = substituted.flatMap((name) => {
        const d = digests.get(name);
        return d ? [{ name, ...d }] : [];
      });
      if (swappedIn.length) sm.binaries = swappedIn;
      // Kept with the scenario: numbers that do not add up to the node's are not to be trusted.
      if (nodeVerdict(profile) === "mismatch") {
        warnings.push(`the groups add up to ${profile.measuredCycles} cycles, the node reported ${profile.nodeCycles}`);
      }
      groups ??= groupResults(profile);
      for (const g of groups) {
        const name = missingKeys.get(`${g.codeHash}:${g.hashType}`.toLowerCase());
        if (name) g.missingBinary = name;
      }
      result = {
        name: s.name,
        groups,
        ...(warnings.length && { warnings }),
        ...(substituted.length && { substituted }),
        ...(unmatched.length && { unmatched }),
        ...(missing.length && { binaryMissing: true, missingBinaries: missing }),
        ...(profile.nodeStopsAt !== undefined && { nodeStopsAt: profile.nodeStopsAt }),
        ...(profile.overTxLimit && {
          overTxLimit: { limit: Number(profile.overTxLimit.limit), sum: Number(profile.overTxLimit.sum) },
        }),
      };
    } catch (e) {
      result = { name: s.name, error: e instanceof Error ? e.message : String(e), groups: [] };
    }
    scenarios.push(result);
    scenarioManifests.push(sm);
    options.onScenario?.(result);
  }

  const errors = scenarios.filter((s) => s.error).map((s) => `scenario "${s.name}": ${s.error}`);
  // A binary offered to every scenario that none of them uses is almost always
  // a wrong out point or code hash: the report would measure the old code.
  // Only said when every scenario ran: one that failed may be the one that uses it.
  const offered =
    !errors.length && config.scenarios.some((s) => s.binaries === undefined) ? Object.keys(config.binaries ?? {}) : [];
  for (const name of offered) {
    if (!used.has(name) && !missingNames.has(name) && !config.scenarios.some((s) => s.binaries?.includes(name))) {
      errors.push(unmatchedError(name));
    }
  }
  const [tool, debuggerDigest, commit, binariesCommit] = await environment;
  const toolchain = toolchainOf(options.toolchain);
  const manifest: ReportManifest = {
    schema: 1,
    tool,
    debugger: {
      version: debuggerVersion ?? "unknown",
      ...(debuggerPath && { path: debuggerPath }),
      ...(debuggerDigest && { sha256: debuggerDigest.sha256 }),
      ...(options.runDebugger && options.debuggerBuild?.sha256 && { sha256: options.debuggerBuild.sha256 }),
      ...(options.runDebugger && options.debuggerBuild?.wasm && { wasm: options.debuggerBuild.wasm }),
    },
    ...((commit || binariesCommit) && { git: { ...(commit && { commit }), ...(binariesCommit && { binaries: binariesCommit }) } }),
    ...(toolchain && { toolchain }),
    scenarios: scenarioManifests,
  };
  return {
    tool: "ckb-cycles",
    version: 1,
    ...(debuggerVersion && { debugger: debuggerVersion }),
    scenarios,
    errors,
    ...(notices.length && { notices }),
    manifest,
  };
}

/** Where a group's function names come from: its symbols build, or else its linker map. */
interface FunctionSource {
  symbols?: string;
  map?: string;
  /** Why a map given with it was not used (a symbols build wins). */
  mapNote?: string;
}

/** Builds and linker maps of spawned binaries, by data hash, as the config names them. */
interface ChildSources {
  symbols: Map<string, string>;
  maps: Map<string, string>;
}

/**
 * Adds `functions` to each group whose script (`codeHash:hashType`) is in
 * `builds`, from a flamegraph run of that group: with its symbols build as
 * `--bin`, or, with only a linker map, the binary itself with the map's
 * functions as `--vm-symbols` (flame's `--map`, same checks). A symbols build
 * that does not cost the same cycles as the binary it stands for is not the
 * same code: the group gets a warning instead. A map that cannot be used (not
 * this binary's, an older debugger) is a warning, or a `mapNote` when the
 * frames were named anyway (from the binary's own `.symtab`).
 */
async function recordFunctions(
  groups: GroupResult[],
  mock: MockTransaction,
  builds: Map<string, FunctionSource>,
  binDir: string,
  inside: (file: string) => Promise<string>,
  options: ProfileOptions,
  childSources: ChildSources = { symbols: new Map(), maps: new Map() },
): Promise<void> {
  const fmt = (n: bigint | number) => n.toLocaleString("en-US");
  const sourceOf = (g: GroupResult) => builds.get(`${g.codeHash}:${g.hashType}`.toLowerCase());
  const wanted = groups.filter((g) => sourceOf(g));
  const isFile = (file: string) => stat(file).then((st) => st.isFile(), () => false);
  const bins: Record<string, string> = {};
  const maps: Record<string, string> = {};
  /** A map's resolved path → its path as the config gives it: what the report says. */
  const mapPaths = new Map<string, string>();
  for (const g of wanted) {
    const src = sourceOf(g)!;
    if (src.mapNote) g.mapNote = src.mapNote;
    const given = (src.symbols ?? src.map)!;
    const what = src.symbols ? "the symbols build" : "the linker map";
    let file: string;
    try {
      file = await inside(resolve(binDir, given));
    } catch (e) {
      g.functionsWarning = e instanceof Error ? e.message : String(e);
      continue;
    }
    // A missing build or map is said on its group; the cycles are measured all the same.
    if (!(await isFile(file))) g.functionsWarning = `cannot read ${what} ${given}: build it first`;
    else if (src.symbols) bins[g.codeHash] = file;
    else {
      maps[g.codeHash] = file;
      mapPaths.set(file, given);
    }
  }
  const run = wanted.filter((g) => bins[g.codeHash] || maps[g.codeHash]);
  if (!run.length) return;
  // Builds and maps for spawned scripts: one that cannot be read leaves that child's frames unnamed (said on the child).
  const vmSymbols: Record<string, string> = {};
  for (const [hash, sym] of childSources.symbols) {
    const file = await inside(resolve(binDir, sym)).catch(() => undefined);
    if (file && (await isFile(file))) vmSymbols[hash] = file;
  }
  for (const [hash, map] of childSources.maps) {
    const file = await inside(resolve(binDir, map)).catch(() => undefined);
    if (file && (await isFile(file))) {
      maps[hash] ??= file;
      mapPaths.set(file, map);
    }
  }
  let flame: Awaited<ReturnType<typeof flameTransaction>>;
  try {
    flame = await flameTransaction(mock, {
      ...options,
      bins,
      vmSymbols,
      ...(Object.keys(maps).length && { maps }),
      scripts: run.map((g) => g.selector),
      readFile: (path) => readFile(path, "utf8"),
    });
  } catch (e) {
    for (const g of run) g.functionsWarning = `the flamegraph run failed: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  for (const g of run) {
    const f = flame.groups.find((f) => f.selector === g.selector);
    const src = sourceOf(g)!;
    if (f?.spawned) {
      g.spawned = f.spawned;
      g.profiled = Number(foldedTotal(f.folded));
    }
    const mapNote = f?.mapNote && reportMapNote(f.mapNote, mapPaths);
    if (mapNote) g.mapNote = mapNote;
    // Named: by the symbols build (--bin), the map, or (a map refused) the binary's own .symtab.
    const named = !!bins[g.codeHash] || !!f?.map || !!f?.ownSymbols;
    if (!f) g.functionsWarning = "the flamegraph run did not profile this group";
    else if (f.cycles !== BigInt(g.cycles) || resultLabel(f) !== resultLabel(g)) {
      g.functionsWarning = src.symbols
        ? `the symbols build ${src.symbols} runs ${fmt(f.cycles)} cycles (${resultLabel(f)}), the binary ${fmt(g.cycles)} (${resultLabel(g)}): ` +
          "not the same code, so its functions would not describe this binary"
        : `the flamegraph run of the binary took ${fmt(f.cycles)} cycles (${resultLabel(f)}), its plain run ${fmt(g.cycles)} (${resultLabel(g)}): ` +
          "not the same run, so its functions would not describe it";
    } else {
      if (!named) g.functionsWarning = mapNote ?? "the linker map named no frame";
      else if (!f.folded.size) g.functionsWarning = "the profiler recorded no stacks";
      else {
        g.functions = functionCosts(f.folded)
          .slice(0, FUNCTION_LIMIT)
          .map((c) => ({ name: c.name, self: Number(c.self), total: Number(c.total) }));
        if (f.map) g.map = mapPaths.get(f.map) ?? f.map;
        if (f.ownSymbols) g.ownSymbols = true;
      }
      // Only beside a profile that checked out (its cycles are the group's): the children were
      // replayed with the same build. A root left unnamed (its map refused) still keeps them.
      if (!named || f.folded.size) {
        if (f.children?.length) g.children = f.children.map((c) => childResult(c, mapPaths));
        if (f.childrenNote) g.childrenNote = f.childrenNote;
      }
    }
  }
}

/**
 * flame's note about a `--map` (`--map <resolved path> not used: …`) as a
 * report says it: `map <path in the config> not used: …`, so a report does not
 * carry the runner's paths.
 */
function reportMapNote(note: string, mapPaths: Map<string, string>): string {
  for (const [file, given] of mapPaths) note = note.split(`--map ${file}`).join(`map ${given}`);
  return note;
}

/**
 * A spawned script's profile as a report records it: profiled frames, never a
 * share of the group's total. `mapPaths` (a map's resolved path → its path in
 * the config) rewrites the map's path where the child names it.
 */
export function childResult(c: FlameChild, mapPaths: Map<string, string> = new Map()): ChildResult {
  const script = c.name ?? (c.codeHash ? short(c.codeHash) : c.locator);
  const base = { vm: c.vm, parent: c.parent, script, ...(c.codeHash && { codeHash: c.codeHash }) };
  if (c.failed) return { ...base, failed: c.failed };
  const out: ChildResult = { ...base, result: c.result, ...(c.error && { error: c.error }), profiled: Number(foldedTotal(c.folded)) };
  // Named from the binary's own .symtab when no build was given for it (flame does the same).
  if (c.ownSymbols) out.ownSymbols = true;
  // Named from its binary's linker map: the binary itself ran (flame --map).
  if (c.map) out.map = mapPaths.get(c.map) ?? c.map;
  if (c.mapNote) out.mapNote = reportMapNote(c.mapNote, mapPaths);
  if (c.symbolsWarning) out.functionsWarning = c.symbolsWarning;
  else if (!c.symbols && !c.ownSymbols && !c.map) out.functionsWarning = out.mapNote ?? "no symbols build for the binary it ran: its frames have no names";
  else if (!c.folded.size) out.functionsWarning = "the profiler recorded no stacks";
  else {
    out.functions = functionCosts(c.folded)
      .slice(0, FUNCTION_LIMIT)
      .map((f) => ({ name: f.name, self: Number(f.self), total: Number(f.total) }));
  }
  return out;
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

/** Said wherever a linker map named a report's frames: nothing ties a map to the code it claims to describe. */
export const reportMapNamesNote = (map: string): string =>
  `names from the linker map ${termLine(map)} (the binary itself ran): the map is not checked against the code; frames sit where the map says`;

/** Said where a group's frames were named from its binary's own `.symtab` (a map for it was not used). */
const REPORT_OWN_SYMBOLS_NOTE = "names from the binary's own symbol table (it ran; only DWARF is stripped)";

/** One spawned script under its group in the terminal report. */
function childReportLine(c: ChildResult, groupOk = false): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const t = termLine;
  const head = `spawned vm ${c.vm} (${t(c.script)})`;
  if (c.failed || c.result === undefined) return `${head}: not profiled: ${t(c.failed ?? "no result")}`;
  const result = resultLabel({ result: c.result, ...(c.error && { error: c.error }) });
  const top = (c.functions ?? []).slice(0, 3).map((f) => `${t(f.name)} ${fmt(f.self)}`);
  return (
    `${head}: ${t(result)}, ${fmt(c.profiled ?? 0)} cycles in its profiled frames` +
    (top.length ? `; costliest (self): ${top.join(", ")}` : c.functionsWarning ? `; functions not recorded: ${t(c.functionsWarning)}` : "") +
    (top.length && c.map ? `; ${reportMapNamesNote(c.map)}` : "") +
    (c.mapNote && c.mapNote !== c.functionsWarning ? `; ${t(c.mapNote)}` : "") +
    (groupOk && (c.error || c.result !== 0) ? ` (${SERVER_EXIT_NOTE})` : "")
  );
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
    for (const b of s.missingBinaries ?? []) {
      const n = s.groups.filter((g) => g.missingBinary === b).length;
      out.push("", `${t(s.name)}: binary ${t(b)} is not in this checkout: ${n} group${n === 1 ? "" : "s"} ran the mock's code instead, and count as not compared`);
    }
  }
  for (const s of report.scenarios) {
    for (const g of s.groups.filter((g) => g.error)) out.push("", `${t(s.name)} ${t(g.selector)} stopped: ${t(g.error!)}`);
  }
  // A rejected scenario's cycles are each group on its own: not what the node spends.
  for (const s of report.scenarios) {
    if (s.nodeStopsAt === undefined) continue;
    const stop = s.groups.find((g) => g.selector === s.nodeStopsAt);
    const skipped = s.groups.filter((g) => g.nodeReaches === false).map((g) => t(g.selector));
    const at = `${t(s.nodeStopsAt)}${stop ? ` (${t(stop.script)})` : ""}`;
    const limit = overTxLimitOf(s);
    if (limit && stop && resultLabel(stop) === "ok") {
      out.push(
        "",
        `${t(s.name)}: ${overTxLimitLines(limit).join(" ")}. Each group above ran on its own with the whole limit; ` +
          `the node gives each group what the ones before it left, and stops at ${at}, where the running sum passes it`,
      );
    } else {
      out.push(
        "",
        `${t(s.name)}: rejected. Each group above ran on its own; the node stops at the first failing group, ` +
          `${at}, and reports no cycles for a rejected tx`,
      );
      if (limit) out.push(`  the sum of its groups is also over the node's per-transaction limit of ${limit.limit.toLocaleString("en-US")} cycles`);
    }
    if (skipped.length) {
      out.push(`  the node never runs: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? `, and ${skipped.length - 8} more` : ""}`);
    }
  }
  for (const s of report.scenarios) {
    for (const g of s.groups) {
      if (g.functionsWarning) out.push("", `${t(s.name)} ${t(g.selector)}: functions not recorded: ${t(g.functionsWarning)}`);
      else if (g.functions?.length) {
        const top = g.functions.slice(0, 3).map((f) => `${t(f.name)} ${fmt(f.self)}`);
        out.push("", `${t(s.name)} ${t(g.selector)}: costliest functions (self cycles): ${top.join(", ")}`);
        if (g.map) out.push(`  ${reportMapNamesNote(g.map)}`);
        if (g.ownSymbols) out.push(`  ${REPORT_OWN_SYMBOLS_NOTE}`);
        if (g.spawned) out.push(`  ${spawnNote({ ...g, head: g })}`);
      }
      if (g.mapNote && g.mapNote !== g.functionsWarning) {
        if (!g.functionsWarning && !g.functions?.length) out.push("");
        out.push(`  ${t(g.mapNote)}`);
      }
      for (const c of g.children ?? []) out.push(`  ${childReportLine(c, g.result === 0 && !g.error)}`);
      if (g.childrenNote) out.push(`  spawned scripts: ${t(g.childrenNote)}`);
    }
  }
  if (report.debugger) out.push("", t(report.debugger));
  const m = report.manifest;
  if (m) {
    const parts = [
      ...(m.debugger?.sha256 ? [`debugger sha256 ${m.debugger.sha256}`] : []),
      ...(m.debugger?.wasm ? [`debugger wasm ${m.debugger.wasm}`] : []),
      ...(m.git?.commit ? [`commit ${m.git.commit}`] : []),
      ...(m.git?.binaries && m.git.binaries !== m.git.commit ? [`binaries from ${m.git.binaries}`] : []),
      ...(m.toolchain ? [`toolchain: ${m.toolchain}`] : []),
      ...(m.tool?.version ? [`${m.tool.name} ${m.tool.version}`] : []),
    ];
    if (parts.length) out.push(t(`manifest: ${parts.join(" · ")}`));
  }
  return out.join("\n");
}

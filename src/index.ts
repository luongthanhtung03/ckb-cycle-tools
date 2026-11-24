export { checkDebuggerPath, DebuggerNotFoundError, resolveDebugger } from "./debugger.js";
export type { ResolveOptions } from "./debugger.js";
export { analyzeTransaction, groupScripts, knownScriptNames, TransactionNotFoundError } from "./analyze.js";
export type { ScriptGroup, TxAnalysis } from "./analyze.js";
export {
  buildMockTransaction,
  httpRpc,
  isCellbase,
  mockFromTransaction,
  nodeConsensus,
  parseOutPointVec,
  scriptVersionAt,
} from "./mock.js";
export type { HttpRpcOptions, MockTransaction, NodeConsensus, Rpc, RpcOutPoint, RpcTransaction, VmEpochs } from "./mock.js";
export {
  checkMockTransaction,
  checkTypeId,
  debuggerArgs,
  DEFAULT_TX_CYCLE_LIMIT,
  groupsOf,
  nodeOrder,
  nodeStop,
  nodeVerdict,
  overTxLimitLines,
  parseDebuggerOutput,
  parseDebuggerRun,
  planReplay,
  readTransactionJson,
  replayGroups,
  selectorFor,
  sumLines,
} from "./replay.js";
export type { DebuggerOutput, GroupRun, Profile, ProfiledGroup, ReplayOptions, ReplayPlan, RunDebugger } from "./replay.js";
export { flameTransaction, profileTransaction, runNativeDebugger } from "./profile.js";
export type { FlameGroup, ProfileOptions } from "./profile.js";
export { MAX_CHILD_PROFILES, olderDebuggerNote, profileChildren, profileSpawns, SERVER_EXIT_NOTE, serverExit } from "./children.js";
export type { ChildContext, FlameChild, SpawnSplit } from "./children.js";
export { groupBinary, resolvedCellDeps, spawnedBinary } from "./spawn.js";
export { linkerMapFunctionNames, readLinkerMap } from "./linkmap.js";
export type { LinkerMap } from "./linkmap.js";
export { addSymbolTable, MAX_SYMBOLIZED_ELF } from "./elfsym.js";
export type { MapClaims } from "./elfsym.js";
export type { SpawnedBinary } from "./spawn.js";
export {
  flameTree,
  foldedTotal,
  formatFolded,
  frameName,
  functionCosts,
  parseFolded,
  profiledCycles,
  profilesChildren,
  spawnedScripts,
  spawnTree,
  CHILD_PROFILE_DEBUGGER,
  renderFlameSvg,
  splitStack,
} from "./flame.js";
export type { FlameNode, Folded, FunctionCost, SpawnedVm } from "./flame.js";
export { runWasmDebugger, wasmDebuggerVersion, wasmFiles, wasmOutput, wasmRunner, WASM_TX_FILE } from "./wasm.js";
export type { WasmRun } from "./wasm.js";
export { substituteBinaries } from "./substitute.js";
export type { AppliedSubstitution, BinarySubstitution } from "./substitute.js";
export {
  childDeltas,
  CHILDREN_FOOTNOTE,
  COMMENT_MARKER,
  diffFailed,
  diffReports,
  formatMarkdown,
  formatText,
  FUNCTION_LIMIT,
  functionDeltas,
  FUNCTIONS_SHOWN,
  INPUTS_CHANGED,
  manifestLines,
  resultLabel,
  summarize,
} from "./diff.js";
export type {
  ChildDelta,
  ChildResult,
  CycleDiff,
  CycleReport,
  DiffOptions,
  DiffRow,
  FunctionDelta,
  FunctionResult,
  GroupResult,
  ManifestSummary,
  MarkdownOptions,
  ReportManifest,
  ScenarioManifest,
  ScenarioResult,
} from "./diff.js";
export { canonicalJson, fileDigest, gitCommit, inputsHash, scenarioInputs, toolchainOf } from "./manifest.js";
export { childResult, formatReport, groupResults, parseCyclesConfig, runReport } from "./report.js";
export type { BinaryConfig, CyclesConfig, ReportOptions, ScenarioConfig } from "./report.js";
export { configFromMocks, formatScan, scanTestMocks } from "./scan.js";
export type { ScanOptions, ScanResult, ScannedBinary, ScannedMock } from "./scan.js";
export { BENCH_DEFAULTS, checkBaselineName, runBench } from "./bench.js";
export type { BenchOptions, BenchResult, RunCommand } from "./bench.js";

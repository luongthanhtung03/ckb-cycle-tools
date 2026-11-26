# Changelog

This project follows [semantic versioning](https://semver.org/).

## 1.6.1 (2026-11-26)

### Fixed
- `ckb-cycles <command> --help` (and `-h`) prints the usage and exits 0; it
  failed with "Unknown option '--help'" (exit 2) for every command but the
  transaction form.
- The usage line of `flame` lists `--timeout` and `--name`, which it already
  accepted.
- Docs: README, the Action's README and the ckb-testtool design note checked
  against 1.6.0's behaviour; examples re-run with ckb-debugger 1.1.2.

### Changed
- The note on a spawned script whose own replay ends non-zero while its group
  verified now says it is that script's own exit code, not a failure, and
  covers a ckb-script-ipc 1.1.1 server that returns on the closed pipe and
  exits with an error code of its own (Crowns: exit 4), not only one left
  waiting (-1).

## 1.6.0 (2026-11-24)

### Added
- `ckb-cycles bench`: in a ckb-script-templates project whose tests use
  integrations/ckb-testtool, builds (`make build`), runs the tests with
  `CKB_CYCLES_MOCKS` set (`cargo test -p tests`), scans, reports, and compares
  with a saved baseline, cargo-bench style: `--save-baseline <name>` (compare
  if present, then save; the default, as `base`) or `--baseline <name>`
  (compare only). A baseline keeps the run's binaries and `.debug` builds in
  `target/ckb-cycles-bench/baselines/<name>`; the comparison replays this
  run's mocks with them (as `report --binaries-from` does for a pull
  request's base), since a report from another build has other inputs and
  would not be compared. diff's gates apply; a run that fails one is not
  saved. Writes `head.json`, `base.json` and `diff.md`. Exported as
  `runBench`. `scripts/templates-e2e.sh` runs it on the generated workspace.
- `report` names functions from a linker map: `"map"` on a binary in
  cycles.json (relative to the config like `path` and `symbols`) is the linker
  map its own stripped build wrote. With `functions`, each group whose script
  is that binary, and each spawned script that ran it, is named from the map
  as `flame --map` does: the binary itself runs, and a copy with the map's
  functions as its symbol table is only read for where functions start
  (`--vm-symbols`, ckb-debugger 1.1.2 or later). The same checks as `flame`:
  a map whose `.text` or `_start` is not the binary's is refused, a binary
  that already has a symbol table is named from it (`ownSymbols`) and told no
  map is needed, an older debugger leaves the frames unnamed; each says why.
  A `symbols` build on the same binary wins, with a note.
  - Report JSON (still version 1, fields added): `GroupResult.map`, `mapNote`
    and `ownSymbols`; `ChildResult.map` and `mapNote`. Maps are named as the
    config gives them, never by the runner's paths. The terminal report says
    where names came from a map, which is not checked against the code.
  - `"functions"` now needs a binary with `"symbols"` or `"map"`.
  - `diff` compares such reports as any other (and keeps a child's `map`).
    lld writes some names demangled that a symbols build keeps mangled, so
    compare functions between reports named the same way.
  - Checked with ckb-debugger 1.1.2 on the spawn fixture: the stripped
    binaries with their rust-lld maps record the same cycles, profiled
    totals and costliest functions as their unstripped builds.

## 1.5.0 (2026-11-24)

Named frames for deployed binaries that have no unstripped build at hand: from
a linker map (`flame --map`) or from the binary's own `.symtab`.

### Added
- `flame --map <hash>=<linker map>` (repeatable): named frames for a stripped
  deployed binary from the linker map (`-Map`, GNU ld or lld / rust-lld) of a
  byte-identical build, with no unstripped ELF. ckb-debugger's profiler only
  opens a frame at a function its ELF symbol table lists, so a stripped binary
  is one frame and cannot be named afterwards. Instead, the map's `.text`
  functions are written into a copy of the deployed binary (taken from the
  transaction) as a `.symtab`, appended after the end of the file with only
  the ELF header's e_shoff and e_shnum changed. The deployed binary still
  runs, for a group's code hash and a spawned binary's data or type hash
  alike; the copy is only read for where functions start (`--vm-symbols`), so
  the cycles are the deployed binary's own. Needs ckb-debugger 1.1.2 or later
  (an older one leaves the frames unnamed, with a note).
  - A map whose `.text` address and size, or `_start`, are not the binary's is
    refused as the map of another build. A binary that already has a symbol
    table needs no map and is refused. A `--bin` for the same hash wins (with
    a note); a `--map` whose hash is no profiled script's is reported.
  - The output says the names come from the map, which is not checked against
    the code.
  - Checked: on the spawn fixture the stripped binaries plus their rust-lld
    maps give the same `.folded` files, byte for byte, as the unstripped
    builds; a real deployed GNU ld binary (the secp256k1-blake160 lock, whose
    ELF header is inside its code segment) is tested with a GNU-format map.
  - `flame` only; `report` followed in 1.6.0.
- Names from a deployed binary's own `.symtab` (a release build with only
  DWARF stripped), with no `--bin` or `--map`. ckb-debugger's profiler opens a
  frame at each function its `.symtab` lists but names frames from DWARF only,
  so they came out as `func_0x<address>`.
  - `flame` now names those frames from the binary's own symbol table, for the
    group's script and each spawned one, and says so. `--bin` or a used
    `--map` still wins. Checked with ckb-debugger 1.1.2 on the spawn fixture's
    binaries given a `.symtab`: every frame the debugger wrote was an address,
    every frame flame shows is a name.
  - `report` with `functions` does the same for a spawned script with no
    symbols build: its functions are recorded from its own table instead of a
    "no symbols build" warning. A group's own functions in `report` still come
    only from its `symbols` build, which is run with `--bin` and so wins over
    the table.
- Library: `linkerMapFunctionNames` and `readLinkerMap` (linkmap.ts; the
  latter gives the names plus `.text` and `_start`), `addSymbolTable`
  (elfsym.ts), `groupBinary` (spawn.ts), all without Node built-ins;
  `flameTransaction`'s `maps` and `readMap` options and its `notes` result;
  `FlameGroup.map` / `mapNote` / `ownSymbols`, `FlameChild.map` / `mapNote` /
  `ownSymbols`, and `ChildResult.ownSymbols` in report JSON.

### Fixed
- A spawned script's replay that did not finish (killed, with or without a
  signal; output cut off; the WebAssembly ckb-debugger trapping, exit -1) is
  now a child that failed, shown as not profiled. It used to be a result of -1
  with an error, so a group that verified printed the ckb-script-ipc server
  note, which calls the child's profile complete. A replay that finished with
  exit -1 (ckb-debugger exits 254 for it) still gets the note.
- `diff` no longer compares two different scripts that ran at the same VM id
  on the two sides as one: the child shows both names (`child-a → child-b`,
  and `baseScript` in the diff JSON), counts as changed, and has no delta. A
  rebuild of the same script (same name, new data hash) compares as before.

### Docs
- README: a spawned VM's locator does not say whether its binary came from a
  cell or a witness, so for a binary spawned from a witness the data hash and
  name shown can be those of the cell at the same index.

## 1.4.0 (2026-11-18)

### Added
- Per-child profiles of a script that spawns others (ckb-debugger 1.1.2 or
  later). For a group whose script spawned, `flame` and `report` (with
  `functions`) read the spawn tree from the flamegraph run, find each spawned
  VM's binary in the transaction by its data hash, and replay that VM alone
  (`--vm-id N`, `--vm-symbols` with the matching unstripped build, used only
  when its code is the code the VM ran). `flame` prints each spawned script's
  profiled cycles and costliest functions under its group and writes
  `<selector>.vm<N>.svg` and `.folded`. The group total from the plain run
  stays the source of truth; a child's numbers are its profiled frames (on the
  spawn fixture, heavy: group 761,957, parent frames 14,974, child frames
  635,605, `spawn_child::child_work` 606,720 self). With an older debugger, or
  a replay that fails, the output is as before plus a note. At most 16 spawned
  VMs per group; a VM that runs `exec` is replayed with its first program.
- Report JSON: a spawning group may carry `children` (per spawned VM: `vm`,
  `parent`, `script`, `codeHash`, `result`, `error`, `profiled`, `functions`,
  `functionsWarning`, `failed`) and `childrenNote`. Additive: the report stays
  `version: 1`, and older readers ignore the fields. `diff` matches children by
  VM id and says which spawned script changed, in the terminal and in a
  "Spawned scripts" block of the PR comment (dropped with the function blocks
  when the comment would be too long). A base report without children shows
  the head's children without a change.
- Library: `FlameChild`, `MAX_CHILD_PROFILES`, `flameTransaction`'s
  `vmSymbols` and `children` options; `spawnTree`, `profilesChildren`,
  `CHILD_PROFILE_DEBUGGER` (also in `ckb-cycle-tools/flame`); `spawnedBinary`,
  `resolvedCellDeps`; `childDeltas`, `childResult`, `CHILDREN_FOOTNOTE`;
  types `ChildResult`, `ChildDelta`, `SpawnedVm`, `SpawnedBinary`.
- Web page: a group whose script spawns others is split by script, as `flame`
  does. After the per-group replay, each group gets one profiled run; under a
  spawning group's row the page lists the spawning script's own frames (vm 0)
  and each spawned VM (its locator and code hash, exit code, and its own
  frames from a `--vm-id` replay), says these sit inside the group's total
  (loading and the spawn are in no frame), and gives the CLI's note on a
  spawned server that ends non-zero after its group verified. At most 16
  spawned VMs per group; a failed replay leaves the group row as it is. On the
  Crowns race `0x2502c0b4…`: group 123,718,667, vm 0 7,993,759, vm 1
  115,556,444 (exit -1), the same as the CLI.
- Library: `ckb-cycle-tools/children` (no Node built-ins): `profileSpawns`,
  `profileChildren`, `serverExit`, `olderDebuggerNote`, and `SERVER_EXIT_NOTE`
  and `MAX_CHILD_PROFILES` (both still exported where they were); `wasmFiles`
  in `ckb-cycle-tools/wasm`. `runWasmDebugger` now returns the files a run
  wrote (`files`).
- ckb-debugger 1.1.2 (released 16 Nov 2026) in the check across releases
  (`compat/debuggers.json`, native and WebAssembly, sha256 as the release
  publishes it). Every script group gives 1.1.1's cycles and exit code, and the
  node's total where it has one: 525 scenario runs, 1,350 groups, no mismatch.

### Changed
- The web page runs ckb-debugger 1.1.2's WebAssembly build (was 0.200.1, from
  `ckb-testtool`): `demo/scripts/copy-wasm.mjs` downloads the release asset
  `ckb-debugger_v1.1.2_wasm32-wasip1.tar.gz`, checks it against the sha256 in
  `compat/debuggers.json` and the wasm in it against a pinned sha256, and
  stops the build on any mismatch. Per-group cycles are unchanged: the page's
  three examples, a 2023 VM v1 transaction and the Crowns race give the same
  cycles per group, and the node's total, on both builds.
- The Action installs ckb-debugger v1.1.2 by default (was v1.1.1), and CI and
  the cross-version check's reference use 1.1.2. Group cycles are the same as
  with 1.1.1 (see Added), but a report's manifest names the new version, so a
  gated `diff` against a report saved with 1.1.1 fails as run under another
  debugger (since 1.3.0); within one Action run both sides use the same. The
  Action still knows v1.1.1's checksum, so `ckb-debugger-version: v1.1.1` works
  without `ckb-debugger-sha256`.

### Fixed
- A function keeps its name whichever ckb-debugger profiled it. Newer
  ckb-debugger and ckb-vm-pprof write a `;` inside a frame name (`[u8; 32]`) as
  U+037E, which looks the same (ckb-standalone-debugger#211, #212); frames,
  function costs, report JSON and SVGs now read it back as `;`, and `diff`
  does the same for function names in a saved report, so a base and a head
  profiled with different debuggers show a change, not a rename.

### Documentation
- `compat/notes.md`: what 1.1.2 changes in `--mode full`. Its `All cycles` line
  now counts loading the program (ckb-standalone-debugger#209), which no frame
  holds; the folded stacks are byte for byte the same as 1.1.1's, so `flame`
  and `report`'s `profiled` do not change. The exported `profiledCycles()`
  reads that line, so it returns more with 1.1.2 (18,801 against 14,974 on the
  spawn fixture); its doc comment says so. Also: full mode now analyses the
  `--vm-id` VM's own ELF (#210), and the `--vm-id` replay of a spawned script
  that calls `inherited_fds` now runs (it exited 3 with 1.1.1).
- README: the milestone table ends at 1.3.0 with dates, and the cross-version
  section gives the 17 Nov run.

## 1.3.0 (2026-11-07)

From the review on #46 (5 Nov): failed gates on a script that starts rejecting,
a reproducibility manifest, and what a rejected transaction's numbers mean.

### Changed
- `diff --fail-above` (and the Action's `fail-above`) now also fails when a
  group that accepted on the base rejects on the head (`ok` → `exit N` or a VM
  error), whatever its cycles: a script that starts rejecting what it accepted
  could pass before, by getting cheaper. This affects workflows that set only
  `fail-above`: a pull request that turns an accepting scenario into a
  rejection now fails the check (a warning with `informational: true`).
  `--fail-on-result-change` is unchanged and still broader (reject → accept,
  one exit code to another, a new group that does not accept); a diff with
  neither set stays informational. The comment marks such a row "accepted on
  the base, rejects now".
- A gated diff (`--fail-above` or `--fail-on-result-change`) now also fails
  when a scenario's inputs changed between base and head (unless
  `--allow-changed-inputs`), or when the two sides ran another ckb-debugger or
  CKB-VM version. Before, an edited mock under the same scenario name was
  compared silently. Ungated diffs only gain notes. See Added.
- A gated diff also fails when a head scenario's groups add up to more than
  the node's per-transaction cycle limit and the base's did not: the node would
  reject it, as if a group started rejecting (see Added). A new scenario over
  the limit fails `--fail-on-result-change` only. The CLI exits 1 for such a
  transaction.

### Added
- `report` writes a `manifest` into its JSON: the ckb-cycle-tools version,
  ckb-debugger's `--version` and the sha256 (and path) of the binary every
  scenario ran (resolved once), or a WebAssembly build's id for a library
  caller that runs one (`debuggerBuild`), the git commit of the config's
  checkout and of `--binaries-from` (none, and no failure, outside git), an
  optional `--toolchain <text>`, and per scenario the CKB-VM version, an
  `inputs` sha256 (the mock or transaction file's bytes as read, and the
  cycles.json entry canonicalised without its name, file path or `functions`)
  and each swapped-in binary's path, sha256 and size. The terminal report
  ends with a manifest line.
- `diff` reads both manifests. A scenario whose `inputs` differ is NOT
  COMPARED (its groups count as neither new nor removed); a gated diff fails
  on it unless `--allow-changed-inputs`. Another ckb-debugger (version, binary,
  native against WebAssembly) or another CKB-VM version for a scenario fails a
  gated diff, listed under the summary; ungated it is a bold note. Another
  toolchain is a note. A report without a manifest on one side is a note,
  never a failure; two such reports diff as before. The comment and the
  terminal output show each side's manifest in one line. Manifest strings go
  through the same cleaning as other report text.
- Action inputs `toolchain` (a command run after the build in each checkout;
  its output goes to `--toolchain`) and `allow-changed-inputs`.
- A rejected transaction (some group exits non-zero, the VM stops it, or Type
  ID refuses it) no longer shows "measured (sum of groups)". The CLI prints
  "sum of groups, each run on its own", names the group the node would stop
  at, says the node reports no cycles for a rejected transaction, and lists the
  groups the node would never run. The order is ckb-script's, read from its
  source (`TransactionScriptsVerifier::verify` and `TxData`/`TxInfo::groups`
  at ckb a4aa128): lock groups, then type groups, each by script hash,
  stopping at the first failure.
- JSON, added fields only: a profile (`--json`, `profileTransaction`) and a
  report scenario get `nodeStopsAt` (that group's selector), and each group
  `nodeReaches: true | false`. Both are only set when some group rejects, so
  reports of accepted transactions are byte-for-byte as before. `report`'s text
  output says the same under a rejected scenario. `diff` and its gates are
  unchanged.
- The node's cycle limit is per transaction (`max_block_cycles`, 3,500,000,000
  on mainnet and testnet: each group gets what the ones before it left), while
  ckb-debugger gives each group 3,500,000,000 on its own. A transaction whose
  groups each fit but together pass the limit was shown as accepted; it is now
  flagged: "over the node's per-transaction limit of 3,500,000,000 cycles: the
  node would reject this transaction (exceeded max cycles)", in the CLI table,
  the `report` text and the `diff` summary and comment. The limit is the
  node's `get_consensus` `max_block_cycles` when the replay asked the node,
  else 3,500,000,000 (`txCycleLimit` in the options to override;
  `DEFAULT_TX_CYCLE_LIMIT` exported). `nodeStopsAt` and `nodeReaches` then mark
  the group at which the running sum, in the node's order, passes the limit,
  unless a failing group comes first. JSON, added fields only, and only in
  that case: `overTxLimit: { limit, sum }` on a profile (bigints as strings,
  as `measuredCycles`) and on a report scenario (numbers), and in a diff, the
  head scenarios newly over it. Transactions under the limit are unchanged.
- `nodeOrder`, `nodeStop` and `sumLines` exported from the package and from
  `ckb-cycle-tools/replay` (no Node built-ins).

### Docs
- compat/HARDFORK.md, from the review on #46 (point 1): 24 real mainnet and
  testnet transactions next to Mirana (VM v1) and Meepo (VM v2), the nearest
  of each kind (secp only; another `type` script; a data/data1/data2 script)
  on each side of each fork, replayed as `ckb-cycles <hash>` replays them and
  again with `--script-version` forced to the two other values. The 18 after
  Mirana match the cycles a node recorded for their block exactly, at the
  chosen version only, and data/data1/data2 groups keep their own version.
  Before Mirana no public node has cycles (mainnet.ckb.dev reports `0x0`
  everywhere here; mainnet/testnet.ckbapp.dev record from the Mirana block on),
  and the explorer's number for those 6 equals the v1 sum, not the v0 sum the
  consensus rules give: reported as unverified, with how to settle it. Also why
  `estimate_cycles` is no oracle for a historical transaction (spent inputs do
  not resolve; it would run today's VM).
- `npm run hardfork` (scripts/hardfork-check.ts, `--discover` to pick the
  transactions again) writes compat/hardfork.json, the table and
  test/fixtures/hardfork-mocks.json.br. test/hardfork.test.ts replays the
  recorded mocks offline with the WebAssembly debugger at every version, and
  with `CKB_HARDFORK_NETWORK=1` plans them again through the public nodes.
  No change to the replay itself.
- README: "What a rejected transaction's numbers mean", and "What comes from
  where when replaying": a table of every input to a replay (cells, cell deps
  and dep groups, input headers, header deps, consensus epochs, CKB-VM version,
  max cycles, group order, Type ID, since/capacity checks) and whether it comes
  from the chain via RPC, the node's current state or ckb-debugger's defaults;
  ckb-debugger's limit is per group, the node's per transaction.
- README: "Flamegraph fidelity": totals are exact, the split between functions
  is attributed (frames open only at symbol-table function starts, so inlined
  code is charged to its caller; cycles charged outside instructions are in no
  frame). The flame example now says the 1,812-cycle gap is everything charged
  outside instructions, not only loading the binary.
- benchmarks/session-lock/RESULTS.md (and compare.mjs, which writes it): the
  comparison is of these two implementations only, and the Rust lock's build
  profile at 49227cd (`opt-level = "s"`, LTO, one codegen unit, `panic = "abort"`,
  overflow checks, stripped; `+zba,+zbb,+zbc,+zbs,-a`; ckb-std 1.1.0; no pinned
  toolchain).

## 1.2.0 (2026-11-05)

Scripts that spawn other scripts (CKB2023 `spawn`).

### Added
- `flame`, and `report` with `functions`, say when a script spawned others:
  ckb-debugger profiles only the spawning script, so the spawned scripts'
  cycles are in the group's total but in none of its functions. The report
  records `spawned` and `profiled` per group; `diff` notes it under the
  group, and for a group whose cycles changed while none of its own
  functions did, says that the change is in what it spawned.
- A warning when a swapped-in binary's old code hash is still in a cell's
  data (a match cell naming the game it spawns by data hash): data is not
  rewritten, so that script would not find the new build.
- `test/fixtures/spawn-project`: a parent lock that spawns a child found by
  data2 hash, with mocks, and tests against ckb-debugger 1.1.1.
- Action: pull requests from forks, whose token cannot comment. `action/comment`
  runs in a `workflow_run` workflow: it finds the pull request from the run's
  head commit through the API (never from the artifact), posts only while the
  PR is still at that commit, and checks the downloaded report first (at most
  `max-bytes` (256 KiB), the marker on its first line, no NUL bytes; @mentions and #refs
  broken). The two workflows are in `action/README.md`.
- Action input `informational`: a crossed threshold or a scenario that could
  not run is a warning, not a failed job.
- Action input `base-config: head`: the base is measured with the PR's
  cycles.json and the base checkout's binaries (`--binaries-from`), for a
  cycles.json generated before the Action (`ckb-cycles scan`). With the
  default, the base checkout has no such file and every group was new.

### Fixed
- `profiledCycles` reads the last `All cycles:` line: for a spawning script,
  flamegraph mode prints the whole group's total first.

## 1.1.0 (2026-10-30)

Cycle reports from ckb-testtool tests, and a check across ckb-debugger releases.

### Security
- Every mock transaction is checked before it is written for ckb-debugger
  (native and WebAssembly; plain replay, `--file`, `report`, `flame`, `scan`
  scenarios, mocks built from a node): a string containing `{{` anywhere in it,
  or a field that should be hex and is not, is refused with an error that names
  the field. ckb-debugger expands `{{ data <path> }}`, `{{ hash <path> }}`,
  `{{ def_type … }}` and `{{ ref_type … }}` in a tx file, so a pull request's
  mock could embed any file on the runner, past `--root`.
  `checkMockTransaction` is exported from `.` and `./replay`.
- `report --root` ignores the config's `"rpc"` and says so in a warning: a pull
  request's cycles.json no longer chooses the host the runner sends requests to.
  `--rpc` still applies; otherwise the public node is asked.
- Names from a cycles.json, a build or a node (scenario, script, binary and
  function names, warnings) are printed to the terminal and the CI log on one
  line, without control or bidi characters, and never with `::` at the start
  of a line (errors keep their lines, each cleaned the same way), so a name
  cannot forge a GitHub Actions workflow command or drive the terminal:
  `report`, `diff`, `flame`, `scan` and plain replay.
- GitHub Action: the PR's `build` runs in the same job as the sticky-comment
  step, which gets `github-token`, and could take that token by writing its own
  `gh` to `$GITHUB_PATH`, or BASH_ENV, PATH and the like to `$GITHUB_ENV`. `gh`
  is now located before the build runs; the comment step runs `/bin/bash -p`
  (not the `bash` on PATH; no BASH_ENV, ENV or exported functions), sets PATH
  itself, blanks LD_PRELOAD and the like, and runs `gh` with only the variables
  it needs (the proxies and CA settings as they were before the build) and an
  empty config directory. The comment file is read from the runner's temp
  directory, never from a step output, and must be a regular file. This does
  not stop a build that leaves a process running or replaces files on the
  runner; the Action's README says so and shows a two-job setup for PRs you do
  not trust with the token.
- GitHub Action: `action/comment`, the sticky-comment step on its own, for that
  second job: it posts a markdown file downloaded from the first job, with a
  token the PR's build never shares a runner with. The first job runs the
  Action with `comment: false` and a read-only token.
- GitHub Action: the comment's markdown is written only when the diff ran, so a
  second job never posts a failed diff's output; the base commit is fetched only
  when the checkout does not have it (a private repository checked out with
  `persist-credentials: false` and `fetch-depth: 0` then needs no credentials).
- The README examples and this repository's cycle-report workflow check out
  with `persist-credentials: false`, so no token is left in `.git/config` for
  the PR's build, and the Action's README no longer says the build cannot get a
  write token. GitHub-owned actions in this repository's workflows and the
  README examples are pinned to commit SHAs, with the release as a comment.
- Web inspector: every page is served with `Content-Security-Policy:
  frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`, and without
  `X-Powered-By`, so no other site can frame it.

### Fixed (audit, 31 Oct)
Each of these could give a gated check the wrong verdict.
- A binary missing from `--binaries-from` (a contract the PR adds) made every
  scenario offered it a base error with no groups, so nothing in those
  scenarios was compared, the other binaries' groups included. The scenario now
  runs with the binaries that exist, the missing one left as the mock has it;
  only the groups whose code it is are not compared (`missingBinary` on the
  group, `missingBinaries` on the scenario), and a gated diff fails on them
  unless `--allow-removed`.
- A binary offered to a scenario that matches none of its cell deps (a mock
  dumped from an older build) was measured as the mock's old code on both
  sides and shown unchanged, with nothing said. It is now a warning on that
  scenario, listed in the comment. A binary that matches no cell dep in any
  scenario was a report error that only reached the log: `report` now writes
  its errors into the JSON (`"errors"`), and a gated diff fails when either
  report has any, so the Action's `|| true` no longer hides them.
- A group the VM stopped (past the cycle limit) was recorded with 0 cycles and
  read as a -100% saving, passing `--fail-above`. The cycles of a stopped run
  are never used now; with `--fail-above` such a group is over the threshold,
  and a result change for `--fail-on-result-change`. A result names the VM
  error's kind (`error: invalid instruction`, `error: cycles error: max cycles
  exceeded`), so one VM error turning into another is a result change.
- GitHub Action: the base report ran the PR's cycles.json, so a scenario the PR
  deleted was never measured or listed. The base is now measured with the base
  commit's own cycles.json, mocks and binaries (an empty report when the base
  has none); the head still runs the PR's.
- A base group with nothing in the head to compare against (a scenario or group
  removed, renamed, or moved to another selector) passed both gates. A gated
  diff now fails on it unless `--allow-removed` (Action input `allow-removed`,
  default false). The summary counts such groups and new groups.
- Two reports from different ckb-debugger versions were compared without a
  word: the summary now names both versions.

### CLI: `ckb-cycles`
- `scan <mocks-dir>`: writes a cycles.json from the mock transactions a test
  suite wrote, one scenario per file, with each freshly built binary in
  `--binaries` (default `build/release`) mapped by its data hash and
  `<name>.debug` as its symbols build; `--functions` records each group's
  costliest functions.
- Functions the profiler could not name from line info (`func_0x<address>`:
  ckb-std's `_start`, rustc's allocator shims) are named from the symbols
  build's ELF symbol table, so they no longer show in a diff as one address
  removed and another added when code moves.
- ELF names skip absolute symbols, labels outside executable sections and
  linker section markers (`__text_start`, `_etext`), so a marker at `_start`'s
  address no longer renames the root frame.
- Legacy Rust symbol names are demangled in full (`$RF$`, `$LP$`, `$u7b$` and
  the other escapes), so they read as `rustc-demangle` prints them.

### ckb-testtool integration
- `integrations/ckb-testtool`: a Rust crate whose `verify_tx` writes each
  ckb-testtool transaction as a mock when `CKB_CYCLES_MOCKS` is set, for
  ckb-script-templates projects; with `scan`, `make cycles` reports every
  test's script groups. Checked in CI on a project generated from
  ckb-script-templates, two contracts, a change, a diff.
- README: the Makefile target uses `npx -p ckb-cycle-tools ckb-cycles` (a bare
  `npx ckb-cycles` names a package that does not exist) and `cargo test -p tests`.
  Every other `npx` line in the READMEs and the demo page now names the package
  the same way.

### Library
- `scanTestMocks`, `configFromMocks` and `formatScan` (and their types) from `.`.
- `flameTransaction` reads and parses each symbols build once, not once per
  script group that runs it.
- `flameTransaction` takes `readBinary` beside `readFile`, so a caller whose
  debugger sees another file system gets frame names from the builds there
  too; it defaults to node:fs, as before.

### GitHub Action
- When the sticky comment exists but updating it fails, the step retries the
  update (three tries) and then warns; it no longer posts a second report
  comment beside the first.
- When the pull request's comments cannot be listed, the step warns and posts
  nothing (the report is in the job summary), since it cannot tell whether its
  comment already exists.

### Compatibility across ckb-debugger releases
- `npm run compat` (repository only): replays 35 frozen scenarios under every
  ckb-debugger release from 0.121.0 to 1.1.1, native and WebAssembly, compares
  each script group with 1.1.1, and writes compat/RESULTS.md; a weekly Linux CI
  job runs it. A scenario the reference debugger could not run counts as a
  mismatch, and two scenario ids that slug alike no longer replay the same
  transaction.

## 1.0.0 (2026-10-27)

First stable release.

### CLI: `ckb-cycles`
- Replays a transaction per script group in ckb-debugger; the sum matches the node's
  total. Resolves the real ckb-debugger past the Windows `.cmd` shim.
- Failure-path profiling: `--file` profiles a transaction that is not on chain.
- Right VM version per script, from the node's hardfork epochs; input headers are
  replayed, so header-reading scripts (Nervos DAO) match.
- Only complete ckb-debugger result lines are trusted, cross-checked with its exit code.
- `report`, `diff` and `mock` subcommands; swap a cell dep's binary for a fresh build
  before replaying; name your own scripts with `--name`.
- `flame`: per-group flamegraphs from ckb-debugger's profiler (SVG + folded
  stacks, costliest functions printed); `--bin` swaps in an unstripped build and
  checks its cycles against the deployed binary's.
- Exit codes: 0 every script accepts and the sum matches the node; 1 a script
  rejects or the sum differs; 2 a usage or environment error.

### Library
- `.` (analysis), `./analyze`, `./replay` and `./flame` (pure, work in the browser), `./wasm`
  (ckb-debugger's WebAssembly build, in memory, same numbers as native).

### GitHub Action
- `action/`: posts one sticky cycle report on a pull request, group by group against
  the base branch; checksums the ckb-debugger it installs; fails on a broken base.
- Function-level costs in the report: a binary's `symbols` build and `"functions": true`
  in cycles.json record each group's costliest functions (checked against the binary's
  cycles), and the comment folds in which functions changed.
- Hardened for untrusted pull requests: `report --root` keeps the files a PR's
  cycles.json names inside the checkout; names in the comment cannot mention,
  link or break the table; the comment always fits GitHub's size limit.

### Web inspector
- ckb-cycle-tools.vercel.app: paste a transaction hash, see its scripts and the
  per-group cycles computed in the page.

### Benchmark
- The session lock in Rust vs ckb-js-vm, rebuilt and rerun in CI: the current lock
  (ckb-session-kit 49227cd, plain CKB and token sessions, codes 10-20), 58 scenarios.

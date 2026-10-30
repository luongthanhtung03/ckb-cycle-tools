# Changelog

This project follows [semantic versioning](https://semver.org/).

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

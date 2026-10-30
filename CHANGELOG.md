# Changelog

This project follows [semantic versioning](https://semver.org/).

## 1.1.0 (2026-10-30)

Cycle reports from ckb-testtool tests, and a check across ckb-debugger releases.

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

### Security
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

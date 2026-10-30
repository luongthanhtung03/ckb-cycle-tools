# Changelog

This project follows [semantic versioning](https://semver.org/).

## Unreleased

- `npm run compat` (repository only): replays 35 frozen scenarios under every
  ckb-debugger release from 0.121.0 to 1.1.1, native and WebAssembly, compares
  each script group with 1.1.1, and writes compat/RESULTS.md; a weekly Linux CI
  job runs it.

- `ckb-cycles scan <mocks-dir>`: writes a cycles.json from the mock transactions
  a test suite wrote, with each freshly built binary in `build/release` mapped by
  its data hash and `<name>.debug` as its symbols build.
- `integrations/ckb-testtool`: a Rust crate whose `verify_tx` writes each
  ckb-testtool transaction as a mock when `CKB_CYCLES_MOCKS` is set, for
  ckb-script-templates projects.
- Functions the profiler could not name from line info (`func_0x<address>`:
  ckb-std's `_start`, rustc's allocator shims) are named from the symbols
  build's ELF symbol table, so they no longer show in a diff as one address
  removed and another added when code moves.
- `scripts/templates-e2e.sh` and a CI job: the testtool integration on a
  project generated from ckb-script-templates, two contracts, a change, a diff.
- README: the Makefile target uses `npx -p ckb-cycle-tools ckb-cycles` (a bare
  `npx ckb-cycles` names a package that does not exist) and `cargo test -p tests`.
- `npm run compat`: a scenario the reference debugger could not run is a
  mismatch for every other build, not a match.
- `npm run compat`: each scenario's transaction file carries a hash of its id,
  so two ids that slug alike no longer replay the same transaction.
- ELF names skip absolute symbols, labels outside executable sections and
  linker section markers (`__text_start`, `_etext`), so a marker at `_start`'s
  address no longer renames the root frame.
- Action: when the sticky comment exists but updating it fails, the step
  retries the update (three tries) and then warns; it no longer posts a second
  report comment beside the first.

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

# Changelog

This project follows [semantic versioning](https://semver.org/).

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

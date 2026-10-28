# Cycle reports from ckb-testtool tests

Status: design, 28 Oct 2026. Asked for on
[CKBuilder-projects#46](https://github.com/Nervos-Community-Catalyst/CKBuilder-projects/issues/46):
reuse the Rust ckb-testtool scenarios a
[ckb-script-templates](https://github.com/nervosnetwork/ckb-script-templates)
project already has, generate the mocks and the binary mapping behind
`cycles.json` automatically, and profile freshly built contracts.

## What is there already

- **ckb-testtool 1.1.1** (the crate, `ckb_testtool::context::Context`) has
  `Context::dump_tx(&self, tx: &TransactionView) -> Result<ReprMockTransaction, CKBError>`.
  `ReprMockTransaction` (crate `ckb-mock-tx-types` 1.1.1, not re-exported by
  ckb-testtool) serialises with serde to ckb-debugger's mock transaction JSON,
  the format a `"mock"` scenario reads. Checked in the 1.1.1 source, `src/context.rs`.
- **`deploy_cell` gives every contract cell a Type ID type script**, and
  `build_script` defaults to `hash_type: "type"`. So a test's scripts reach their
  code through the type script, and swapping the binary in the mock (what
  `binaries` does) changes nothing but the code: the case the report measures
  exactly.
- **The type script's args are random** (or, with
  `new_with_deterministic_rng`, derived from the binary's data hash). Either
  way, nothing in a test's mock is stable across builds except the shape of
  the transaction. The binary's data hash changes with every code change.
- **The workspace template's `tests/src/lib.rs`** already has
  `verify_and_dump_failed_tx`, which calls `dump_tx` on a failed verification
  and writes it to `failed_txs/`. Its `tests` crate already depends on
  `serde_json`. Contracts are built by `make build` into `build/release/<name>`
  (stripped) and `build/release/<name>.debug` (the same build before
  stripping).

## Tried on a generated project (28 Oct)

`scripts/templates-e2e.sh` runs the workflow below on a workspace generated
from ckb-script-templates `f90b1e2` with cargo-generate 0.25.1 (rustc 1.99,
clang 19, ckb-debugger 1.1.1, in a Docker container: rust:1.99.0-slim, Debian 13). What it showed:

- The crate needed no change. `make generate` writes tests that call
  `context.verify_tx(&tx, 10_000_000)` over two lines, deploy with
  `deploy_cell_by_name` and print `consume cycles: N`; with the call swapped for
  `ckb_cycles_testtool::verify_tx`, each test wrote its mock, and `report` gave
  the same cycles the tests printed (7,156 per contract; 19,174 for `alpha`
  after the change). The template's `ckb-testtool = "1.1"` and the crate's
  `"1"` resolve to one ckb-testtool (1.1.1). The git dependency in the README
  resolves from GitHub.
- The template's contract Makefile already writes `build/release/<name>.debug`
  (unstripped, about 20 MB with `debug = 2`), so `scan` finds the symbols
  builds with no extra step.
- The profiler names frames from DWARF line info only. ckb-std's `_start`
  (assembly) and rustc's allocator shims have none and came out as
  `func_0x130c4`; the shim moved between the two builds, so the diff showed
  `func_0x13366 -3, func_0x1338e +3`. Fixed: such frames are named from the
  build's ELF symbol table (src/elf.ts), and the diff now shows only
  `__ckb_std_main +12,008`.
- The README's Makefile used `npx ckb-cycles`. No npm package has that name
  (the package is `ckb-cycle-tools`), and a template project has no
  package.json to find the command in, so it now uses
  `npx -y -p ckb-cycle-tools ckb-cycles` through a `CKB_CYCLES` variable. `scan`
  is not in the 1.0.0 release yet.
- `cargo test -p tests` instead of `cargo test`: the contract crates' own unit
  tests have nothing to dump and only add build time.

## The workflow

```
make build                                  # build/release/<contract>, <contract>.debug
CKB_CYCLES_MOCKS=$PWD/target/ckb-cycles cargo test
ckb-cycles scan target/ckb-cycles --binaries build/release -o cycles.json
ckb-cycles report cycles.json
```

wrapped in one `make cycles` target.

### 1. Tests write their transactions (Rust)

A small crate, `integrations/ckb-testtool` (`ckb-cycles-testtool`), with one
function used in place of `context.verify_tx`:

```rust
let cycles = ckb_cycles_testtool::verify_tx(&context, &tx, MAX_CYCLES).expect("pass");
```

It verifies as before and returns the same result. When `CKB_CYCLES_MOCKS` is
set to a directory, it also writes `context.dump_tx(&tx)` there, as
`<test path>.json`: the test's name, which libtest puts in the thread name
(`tests::test_transfer` becomes `tests.test_transfer.json`). A second
transaction verified in the same test gets `-2`, then `-3`. Without the
variable it writes nothing, so `cargo test` behaves exactly as before.

A rejected transaction is written too: a rejection is a result in a report,
and the failure paths are the ones people tend not to measure.

`ckb_cycles_testtool::dump_tx(&context, &tx, "name")` writes one under a name
of your own, for a test that needs it.

The crate depends on `ckb-testtool = "1"` and `serde_json`. The function is
about 40 lines: a project that would rather not add a dependency can copy it
into `tests/src/lib.rs` next to `verify_and_dump_failed_tx`.

### 2. `ckb-cycles scan` writes the cycles.json (TypeScript)

`ckb-cycles scan <mocks-dir> [--binaries <dir>] [-o cycles.json] [--functions]`

- one `"mock"` scenario per `*.json` in the directory, named by the file
  (without `.json`), sorted;
- one binary per file in `--binaries` (default `build/release`) whose data
  hash is the data of a code cell dep in at least one mock, matched by that
  `codeHash`. Its name is the file name. A `<name>.debug` next to it becomes
  its `symbols`;
- `--functions` sets `"functions": true`, so the report records each group's
  costliest functions from the `.debug` build;
- paths in the file are relative to the cycles.json, with `/`.

It says on stderr what it found: how many scenarios, which binaries matched,
which files in the binaries directory no test deployed (a stale build, or a
contract without a test), and code cells in the mocks that are none of the
binaries (ckb-testtool's built-in always-success, usually).

The cycles.json is generated, not written by hand: the code hashes in it are
those of the build the tests ran against, so it is regenerated after each
build. A scenario's name comes from the test, so the same test has the same
name on every run and a report from one commit compares with another's.

### 3. Reports and pull requests

`ckb-cycles report cycles.json` replays each mock with the freshly built
binary (the same bytes the test deployed). For a pull request, the Action's
model already fits: it reads the head's cycles.json, replays it once with the
head's `build/release`, once with the base's. The base side swaps the base's
binary into the head's mocks by data hash; with Type ID that is the same
transaction with the old code.

The head's mocks need the head's tests, which the base checkout may not have
(the helper is new in that PR). So the mocks and the cycles.json are made in a
workflow step before the Action, and the Action's `build` is only `make build`:

```yaml
- run: make cycles-config        # make build, cargo test with CKB_CYCLES_MOCKS, ckb-cycles scan
- uses: luongthanhtung03/ckb-cycle-tools/action@<sha>
  with:
    build: make build
```

## What it does not do

- It does not change ckb-testtool or the templates. Both would make this
  zero-config (see open questions).
- No `cargo bench` target. A bench target cannot call `#[cfg(test)]` code,
  which is where the template's tests are, and the tests are what holds the
  scenarios. `make cycles` runs the tests instead; a `cargo bench` wrapper
  around the same steps is possible if wanted.
- Native-simulator tests (`native-simulator` feature) run x86 code, not
  CKB-VM. Their dumps are still mock transactions the debugger can run with the
  RISC-V binary; `scan` treats them the same.

## Open questions for the maintainers

1. Dumping in `Context::verify_tx` itself when an environment variable is set
   would need no change to any test. That is a ckb-testtool change.
2. Or in the workspace template: `verify_and_dump_failed_tx` could also dump
   every transaction when `CKB_CYCLES_MOCKS` is set, and the generated
   `tests.rs` could call it, plus a `cycles` target in the Makefile.
3. Is `cargo bench` wanted as the entry point, given (above) that it cannot
   reuse `#[cfg(test)]` scenarios?

# CKB cycle report (GitHub Action)

Posts one comment on a pull request with what the PR did to your scripts'
cycles: every scenario in your `cycles.json` replayed in ckb-debugger with the
binaries built from the PR, and again with the binaries built from its base,
compared script group by script group. A group whose result changed (it accepted
and now rejects, or the reverse) is listed first in bold. Each push updates the
same comment instead of adding another.

## Use it

```yaml
# .github/workflows/cycles.yml
name: Cycles
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  cycles:
    runs-on: ubuntu-latest
    timeout-minutes: 30             # a PR whose script loops still ends
    steps:
      - uses: actions/checkout@v7
      - uses: luongthanhtung03/ckb-cycle-tools/action@<commit-sha>  # pin a commit, not @main
        with:
          build: make build         # whatever builds the binaries cycles.json names
          fail-above: 5             # fail when a group grows by more than 5%
          fail-on-result-change: true
```

On `ubuntu-latest` it installs ckb-debugger (v1.1.1, the release CI here uses) if
it is not already on PATH. It needs Node 20 or later, which the runner has.

| Input | Default | |
|---|---|---|
| `config` | `cycles.json` | the scenario file, relative to the repo root |
| `build` | (none) | shell command run in the PR checkout and in a checkout of the base |
| `base-ref` | the PR's base commit | empty: report the head alone (every group "new") |
| `fail-above` | (never) | percent growth of any group that fails the job |
| `fail-on-result-change` | `false` | fail when any group's result changed |
| `comment` | `true` | post or update the sticky comment |
| `title` | `Cycle report` | the comment's heading |
| `github-token` | `github.token` | needs `pull-requests: write` |
| `ckb-debugger-version` | `v1.1.1` | release installed when none is on PATH |
| `ckb-debugger-sha256` | v1.1.1's | SHA-256 of that release's `x86_64-unknown-linux-gnu` tarball; required with another version |

Outputs: `report` (head report JSON), `markdown` (the comment), `failed`.

The table also goes to the job summary, so a pull request from a fork (whose
token cannot comment) still shows it. Only a comment posted by the token's own
account (`github-actions[bot]` for the default token) is updated: a comment by
anyone else that starts with the marker is left alone.

## Security

- Use it under `pull_request`, as above, never `pull_request_target` or
  `workflow_run` with a checkout of the PR's head: `build` runs the PR's code,
  which must not get a write token or your secrets.
- Leave `github-token` at the workflow token. A personal access token or an app
  token would be on a runner where the PR's build has already run. (An app
  token also cannot read `/user`, so the comment it posted is not recognised
  and each push adds another.)
- Pin the Action to a commit SHA: it runs with a token that can comment.
- The PR's `cycles.json` decides which files the report reads. The Action
  passes `--root` with the checkouts, so a path outside them (absolute, `..`,
  or a symlink) is an error row, not read. Names and errors from it are
  escaped in the comment: no mentions, links, HTML or table breaks.
- `timeout-minutes` on the job bounds a script that runs forever (ckb-debugger
  stops it only at its cycle limit).
- The comment is a review aid, not a gate against a hostile PR: a pull request
  can change the workflow, the build and so the numbers. Treat the check as
  reliable for PRs from people with write access.

## cycles.json

```json
{
  "network": "testnet",
  "names": { "0x…code hash…:type": "my-lock" },
  "binaries": {
    "my-lock": { "path": "build/release/my-lock", "codeHash": "0x…" }
  },
  "scenarios": [
    { "name": "spend within the limit", "mock": "tests/mocks/spend.json" },
    { "name": "a real testnet spend", "tx": "0x…" },
    { "name": "about to send", "file": "tests/fixtures/tx.json", "binaries": ["my-lock"] }
  ]
}
```

A scenario is one of:

- `mock`: a ckb-debugger mock transaction, every cell inline. Needs no node, so
  CI never depends on one. `ckb-cycles mock <tx-hash> -o file.json` (or
  `--file tx.json`) writes one from any transaction; ckb-testtool's
  `Verifier.txFile()` writes one from a test. For Rust ckb-testtool tests,
  `ckb-cycles scan` writes the whole cycles.json (see the main README).
- `file`: a transaction in RPC (or CCC) shape; its cells come from a node.
- `tx`: a committed transaction hash.

`binaries` swaps a deployed script for the one just built. Each entry matches
code cell deps by `codeHash` (the cell's data hash, or its type script hash) or
by `outPoint`. Paths are relative to the config file; the base report reads them
from the base checkout. A scenario without `"binaries"` is offered every binary
and uses the ones that match; with a list, each listed one must match.

To see which functions changed, not only by how much a group did:

- `"symbols"` on a binary: an unstripped build of the same code, relative to the
  config like `path` (so `build` must produce it on both checkouts).
- `"functions": true` at the top level (every scenario) or on a scenario (which
  overrides the top level).

Each group whose script is a binary with `symbols` is then profiled once more
with that build, and the report keeps its 15 costliest functions. The comment
gets a folded block per changed group with the functions whose self cycles
changed (the ten largest changes). If the symbols build does not cost exactly
what the binary costs, it is not the same code: the group gets a warning in the
comment instead of functions. A base without functions (an older report, a
base without the symbols build) still compares; its side shows `—`.

What the swap changes depends on how your script points at its code:

- **`hash_type: "type"`** (deployed with Type ID, as most are): nothing but the
  code. The transaction is byte-for-byte the same, so the diff is exactly the
  effect of the new binary. Prefer this.
- **`hash_type: "data"`, `"data1"`, `"data2"`**: the script names the hash of the
  binary itself, so every script with the old hash (in inputs, cell deps and
  outputs) is rewritten to the new one. Rewriting an output changes the
  transaction hash, so a signature over it stops verifying (a secp256k1 lock in
  the same transaction will then reject), and a hash carried inside args (a
  ckb-js-vm script naming its bytecode) is not rewritten. The report lists both
  as warnings.

## Locally

```bash
npx -p ckb-cycle-tools ckb-cycles report cycles.json --json head.json
npx -p ckb-cycle-tools ckb-cycles report cycles.json --binaries-from ../base-checkout --json base.json
# --root <dir> (repeatable): read no file the config names outside these
npx -p ckb-cycle-tools ckb-cycles diff base.json head.json --markdown --fail-above 5
```

Exit codes: `report` 2 when a scenario could not run (a rejection is a result,
not an error); `diff` 1 when a threshold is crossed, a head scenario could not
run, or (with `--fail-above` or `--fail-on-result-change`) a base scenario could
not run; 2 for bad arguments or reports.

## Limits

- One sticky comment per pull request: two runs of this Action on the same PR
  overwrite each other's comment.
- Cycles are ckb-debugger's for the VM version you set (`scriptVersion`, default
  the block's, or 2). Both sides use the same debugger, so the diff is exact.
- A scenario whose binary does not exist on the base yet (new in the PR) shows
  its groups as new. A scenario the base cannot run for any other reason (its
  build failed, a node error) is a row of its own, "NOT COMPARED", and fails the
  check when a threshold is set: nothing in it was compared.
- A new group has no base, so no percentage: `fail-above` cannot apply to it, and
  the summary line says how many new groups it skipped. A new group that does not
  accept counts as a result change (against "did not run") for
  `fail-on-result-change`.

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
    steps:
      - uses: actions/checkout@v4
      - uses: luongthanhtung03/ckb-cycle-tools/action@main
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

Outputs: `report` (head report JSON), `markdown` (the comment), `failed`.

The table also goes to the job summary, so a pull request from a fork (whose
token cannot comment) still shows it.

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
  `Verifier.txFile()` writes one from a test.
- `file`: a transaction in RPC (or CCC) shape; its cells come from a node.
- `tx`: a committed transaction hash.

`binaries` swaps a deployed script for the one just built. Each entry matches
code cell deps by `codeHash` (the cell's data hash, or its type script hash) or
by `outPoint`. Paths are relative to the config file; the base report reads them
from the base checkout. A scenario without `"binaries"` is offered every binary
and uses the ones that match; with a list, each listed one must match.

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
npx ckb-cycles report cycles.json --json head.json
npx ckb-cycles report cycles.json --binaries-from ../base-checkout --json base.json
npx ckb-cycles diff base.json head.json --markdown --fail-above 5
```

Exit codes: `report` 1 when a scenario could not run (a rejection is a result,
not an error); `diff` 1 when a threshold is crossed or a head scenario could not
run.

## Limits

- One sticky comment per pull request: two runs of this Action on the same PR
  overwrite each other's comment.
- Cycles are ckb-debugger's for the VM version you set (`scriptVersion`, default
  the block's, or 2). Both sides use the same debugger, so the diff is exact.
- A scenario the base cannot run (new files, a binary that does not exist yet)
  shows its groups as new rather than failing.

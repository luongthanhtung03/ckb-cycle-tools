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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false  # no token in .git/config for the PR's build
      - uses: luongthanhtung03/ckb-cycle-tools/action@<commit-sha>  # pin a commit, not @main
        with:
          build: make build         # whatever builds the binaries cycles.json names
          fail-above: 5             # fail when a group grows by more than 5%
          fail-on-result-change: true
```

This is the one-job setup: the PR's build and the comment share a job, so the
build runs where a token that can comment is in reach. For pull requests you
would not trust with that token, use the
[two-job setup](#two-jobs-the-build-never-shares-a-runner-with-the-comment-token)
below.

On `ubuntu-latest` it installs ckb-debugger (v1.1.1, the release CI here uses) if
it is not already on PATH. It needs Node 20 or later, which the runner has, and
`/bin/bash` and `gh` for the comment (Linux and macOS runners have both). In a
private repository, check out with `fetch-depth: 0` as well: with
`persist-credentials: false` the Action's fetch of the base commit has no
credentials, so the base must already be in the checkout.

| Input | Default | |
|---|---|---|
| `config` | `cycles.json` | the scenario file, relative to the repo root |
| `build` | (none) | shell command run in the PR checkout and in a checkout of the base |
| `base-ref` | the PR's base commit | empty: report the head alone (every group "new") |
| `fail-above` | (never) | percent growth of any group that fails the job |
| `fail-on-result-change` | `false` | fail when any group's result changed |
| `allow-removed` | `false` | with a threshold set, do not fail on base groups with nothing in the head to compare against (removed, renamed, moved, or not built on the base) |
| `comment` | `true` | post or update the sticky comment |
| `title` | `Cycle report` | the comment's heading |
| `github-token` | `github.token` | needs `pull-requests: write` |
| `ckb-debugger-version` | `v1.1.1` | release installed when none is on PATH |
| `ckb-debugger-sha256` | v1.1.1's | SHA-256 of that release's `x86_64-unknown-linux-gnu` tarball; required with another version |

Outputs: `report` (head report JSON), `markdown` (the comment), `failed`. The
comment's markdown is at `$RUNNER_TEMP/ckb-cycles/comment.md` whenever the
diff ran, also when a threshold then fails the step (the step's outputs may not
be set then, so a later step reads that path).

The table also goes to the job summary, so a pull request from a fork (whose
token cannot comment) still shows it. Only a comment posted by the token's own
account (`github-actions[bot]` for the default token) is updated: a comment by
anyone else that starts with the marker is left alone.

## Security

- Use it under `pull_request`, as above, never `pull_request_target` or
  `workflow_run` with a checkout of the PR's head: `build` runs the PR's code,
  which must not get your secrets or a token that writes to the repository's
  contents.
- In the one-job setup, the PR's build does run in the job that holds a token
  with `pull-requests: write` (the comment's). Under `pull_request` GitHub gives
  a PR from a fork a read-only token, so this matters for PRs from branches of
  the repository itself (people with write access), for private repositories
  that send write tokens to fork PRs, and for any token you pass as
  `github-token`. The Action keeps that token away from what the build leaves
  in the job's environment: `gh` is located before the build runs, and the
  comment step runs `/bin/bash -p` (not the `bash` on PATH, no `BASH_ENV` or
  `ENV`, no exported functions), sets PATH itself and gives `gh` only the
  variables it needs, with an empty config directory. So a build that writes to
  `$GITHUB_PATH` or `$GITHUB_ENV` (PATH, BASH_ENV, LD_PRELOAD, proxies, a CA
  file, GH_HOST) does not get the token. It cannot stop a build that leaves a
  process running for the rest of the job, or that replaces files on the
  runner (hosted runners give it passwordless sudo): such a build can still
  take the comment token. Where that matters, use the two-job setup below.
- Check out with `persist-credentials: false`. By default `actions/checkout`
  leaves the job's token in `.git/config`, where the PR's build can read it.
- Leave `github-token` at the workflow token. A personal access token or an app
  token would be on a runner where the PR's build has already run. (An app
  token also cannot read `/user`, so the comment it posted is not recognised
  and each push adds another.)
- Pin the Action, and the actions around it, to a commit SHA: it runs with a
  token that can comment.
- The PR's `cycles.json` decides which files the head's report reads. The
  Action passes `--root` with the checkout, so a path outside it (absolute, `..`,
  or a symlink) is an error row, not read. The base's report reads the base
  commit's own `cycles.json`, under `--root` with the base checkout: the PR's
  config changes only what the head runs. Names and errors from it are
  escaped in the comment: no mentions, links, HTML or table breaks. In the
  job log they are kept to one line without control characters, so none can
  start a workflow command (`::`).
- A mock or transaction with a ckb-debugger template directive
  (`{{ data <path> }}`, `{{ hash <path> }}`, …) or a non-hex field is refused
  before it reaches the debugger, which would otherwise embed any file on the
  runner, past `--root`. Under `--root` the config's `"rpc"` is ignored (with a
  warning): only the CLI's `--rpc`, or the public node, is asked.
- `timeout-minutes` on the job bounds a script that runs forever (ckb-debugger
  stops it only at its cycle limit).
- The comment is a review aid, not a gate against a hostile PR: a pull request
  can change the workflow, the build and so the numbers. Treat the check as
  reliable for PRs from people with write access.

### Two jobs: the build never shares a runner with the comment token

The first job builds and reports with a read-only token and no comment; it
uploads the markdown. The second job has `pull-requests: write`, checks out
nothing and runs no code from the pull request: it downloads the markdown and
posts it with `action/comment`, the same sticky-comment step as the main
Action.

```yaml
# .github/workflows/cycles.yml
name: Cycles
on: pull_request
permissions: {}
jobs:
  report:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read                # all the PR's build can get
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: luongthanhtung03/ckb-cycle-tools/action@<commit-sha>
        with:
          build: make build
          comment: false
          fail-above: 5
          fail-on-result-change: true
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: ${{ !cancelled() }}     # a failed threshold still gets its comment
        with:
          name: cycle-report
          path: ${{ runner.temp }}/ckb-cycles/comment.md
          if-no-files-found: ignore
          retention-days: 1
  comment:
    needs: report
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: cycle-report
          path: ${{ runner.temp }}/cycle-report
      - uses: luongthanhtung03/ckb-cycle-tools/action/comment@<commit-sha>
        with:
          markdown: ${{ runner.temp }}/cycle-report/comment.md
```

`action/comment` takes `markdown` (the file, required), `pr` (default: the
event's pull request) and `github-token` (default: the workflow token). The
markdown comes from a job the PR's code ran in, so a hostile PR can make it
say anything (as in one job); it is posted as text and nothing in it runs. On self-hosted
runners, the split helps only if the second job cannot land on a machine the
first job's build could change: use ephemeral runners, or run the comment job
on a GitHub-hosted one.

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
by `outPoint`. Paths are relative to the config file. The base report uses the
base commit's own `cycles.json` (its scenarios, mocks and binaries), so a
scenario the PR deletes or renames is still listed, as removed. A scenario
without `"binaries"` is offered every binary and uses the ones that match (one
that matches none of its cell deps is a warning on that scenario, and one that
matches no scenario at all is a report error); with a list, each listed one
must match.

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

With `--binaries-from`, a binary missing from that checkout is left as the mock
has it: the groups whose code it is are not compared (a gated diff fails on
them unless `--allow-removed`), and every other binary is still swapped in.

Exit codes: `report` 2 when a scenario could not run or a binary matched no
cell dep in any scenario (a rejection is a result, not an error; both are in
the JSON's `"errors"` too); `diff` 1 when a threshold is crossed or a head
scenario could not run, and, with `--fail-above` or `--fail-on-result-change`,
when a base scenario could not run, either report has errors, or a base group
has nothing in the head to compare against (unless `--allow-removed`); 2 for
bad arguments or reports.

## Limits

- One sticky comment per pull request: two runs of this Action on the same PR
  overwrite each other's comment.
- Cycles are ckb-debugger's for the VM version you set (`scriptVersion`, default
  the block's, or 2). Both sides use the same debugger, so the diff is exact;
  two reports from different ckb-debugger versions are compared all the same,
  and the summary says so.
- A scenario that is new in the PR (not in the base's `cycles.json`) shows its
  groups as new; so does a base without a `cycles.json`. A scenario the base
  cannot run (its build failed, a binary it names was not built, a node error)
  is a row of its own, "NOT COMPARED", and fails the check when a threshold is
  set: nothing in it was compared.
- A scenario or group the PR removes, renames, or moves to another selector
  is listed as removed, and fails the check when a threshold is set, unless
  `allow-removed` is true. New groups never fail it on their own.
- A group the VM stopped (past the cycle limit, a bad instruction) is a result
  change, and over any `fail-above` threshold: its 0 cycles are not a saving.
- A new group has no base, so no percentage: `fail-above` cannot apply to it, and
  the summary line says how many new groups it skipped. A new group that does not
  accept counts as a result change (against "did not run") for
  `fail-on-result-change`.

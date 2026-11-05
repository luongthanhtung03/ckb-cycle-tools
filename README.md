# ckb-cycle-tools

Cycle measurement for CKB on-chain scripts.

**Live demo:** [ckb-cycle-tools.vercel.app](https://ckb-cycle-tools.vercel.app/) — paste a testnet tx hash, see cycles and script groups (CKB testnet).

**Status: v1.0.** Built in the open during my CKBuilder programme.

| When | Milestone |
|---|---|
| w/c 5 Oct 2026 | ✅ Scaffold, CI, the Windows `ckb-debugger` shim fix |
| w/c 12 Oct | ✅ CLI: per-script cycle table for a transaction |
| w/c 19 Oct | ✅ Failure-path profiling; ✅ CI on Linux and Windows |
| w/c 26 Oct | ✅ ckb-js-vm vs Rust comparison harness |
| w/c 2 Nov | v1.0 on npm |

## The problem

Every CKB script consumes cycles, and cycles are a hard limit rather than a
suggestion. But finding out how many a script uses — and *which part* of it is
expensive — currently means driving `ckb-debugger` by hand and reading raw output.

There is no convenient way to answer the two questions people actually have:

1. How many cycles does this script use, on the transactions it will really see?
2. Which implementation is cheaper, and by how much?

## What this is meant to be

- A **cycle profiler** that reports usage per script for a given transaction,
  including the failure paths rather than only the happy one.
- A **comparison harness** that runs the *same* assertion set against two
  implementations — ckb-js-vm and native Rust — and reports both, so the comparison
  is like-for-like instead of anecdotal.
- The **Windows toolchain fixes** from my Week 1 findings: `ckb-testtool` cannot find
  the `ckb-debugger` that offckb installs, because a `.cmd` shim is invisible to a
  bare-name `child_process` spawn. That blocks every contract test on Windows, and
  the workaround should not have to be rediscovered by everyone who hits it.

## Install

```bash
npm install -g ckb-cycle-tools   # the ckb-cycles command
ckb-cycles <tx hash>             # or without installing: npx -p ckb-cycle-tools ckb-cycles <tx hash>
```

[ckb-cycle-tools on npm](https://www.npmjs.com/package/ckb-cycle-tools) (v1.2.0, ESM, Node 20 or
later). It drives `ckb-debugger`, which must be on PATH or passed with `--debugger`.

## Try it

```bash
npm install
npm test                  # unit tests, no network needed
npm run demo              # the Next.js web demo at http://localhost:3000
npm run analyze:testnet -- <tx hash> [<tx hash> …]
npm run cycles -- <tx hash>  # per-group cycles via ckb-debugger
```

The demo takes a CKB testnet transaction hash and shows the total cycles the node
spent verifying it, and every **script group** that ran. CKB runs each script once
per group: input locks grouped by lock script, type scripts grouped across inputs and
outputs. Output locks never run. Links are shareable: `?tx=<hash>`.

### What it already shows

Real testnet transactions from my CKBuilder work:

| Transaction | Cycles | Script groups |
|---|---|---|
| [Plain CKB transfer](https://testnet.explorer.nervos.org/transaction/0x52a1b3ba45a28614c30ddc52f0795c164141abbebd1558e6c69fb0ac45fada50) | 1,657,727 | 1 lock |
| [Counter Type Script update (ckb-js-vm)](https://testnet.explorer.nervos.org/transaction/0x64f695a23416d9a7b2d34bb7025140c90991b82e9f1dea98e103bc13a72b77ac) | 15,675,038 | 1 lock + 1 type |
| [Script deployment with Type ID](https://testnet.explorer.nervos.org/transaction/0xa21da18ff3f142127cf63d6e705d64c14577fb99a9a0cbf74f47fb70b6ad66cf) | 2,607,561 | 1 lock + Type ID |

The counter's type script, running on ckb-js-vm, costs roughly ten times a standard
lock. Which part of that is the JavaScript VM and which is the script itself is what
the per-group breakdown (the CLI, below) and the ckb-js-vm vs Rust harness are for.

## Per-script cycles: the `ckb-cycles` CLI

The web demo shows the total the node reports. The CLI goes further: it rebuilds
the transaction as a ckb-debugger mock transaction (every input cell, every cell
dep, dep groups expanded), runs `ckb-debugger` once per script group, and checks
that the groups add up to exactly what the node reported.

```
$ npm run cycles -- 0x64f695a23416d9a7b2d34bb7025140c90991b82e9f1dea98e103bc13a72b77ac

GROUP  SCRIPT             RUN AT        RESULT      CYCLES  SHARE
lock   Secp256k1Blake160  input.0.lock  ok       1,652,198  10.5%
type   0x3e9b6b…18bed7    input.0.type  ok      14,022,840  89.5%

measured (sum of groups)  15,675,038
reported by node          15,675,038  ✓ match
ckb-debugger 1.1.1 · testnet · https://testnet.ckb.dev/

input.0.type logged:
  [DEBUG] counter: 1 input(s) -> 1 output(s)
  [DEBUG] counter incremented 2 -> 3
```

So in that transaction, **89.5% of the cost is the counter Type Script running on
ckb-js-vm**. Type ID is verified natively by the node and cannot run in
ckb-debugger; the CLI charges it the node's fixed `TYPE_ID_CYCLES` (1,000,000), and
the totals still match exactly.

**Header-reading scripts replay too.** Each input cell carries the block it was
created in, so a script that reads its input's header (as a Nervos DAO withdrawal
does) sees what it saw on the node, as long as the transaction lists that block in
`header_deps`, which the node requires as well. Before this, a
[DAO withdrawal](https://testnet.explorer.nervos.org/transaction/0xe8776bb8eb039365be9679cd61870cdc7ea3c24e4f2164fdd5d5f103bdfa2cc5)
replayed with NervosDao exiting 2 (header missing) and a total 8,058 cycles short;
it now matches the node's 1,776,369 exactly, and CI checks it.

The replay is exact for what a script can observe through syscalls: cells, data,
witnesses, headers. **Older transactions replay on the VM they ran on:** a
`hash_type: "type"` script runs on the CKB-VM version of its block's epoch (v0
before Mirana, v1 before Meepo, v2 since), so a 2023 testnet transaction matches
the node only on v1, and the CLI picks it from the block. The hardfork epochs come
from the node it asks (`get_consensus`), never from a flag: `--rpc` with a mainnet
node gives mainnet's schedule with or without `--mainnet`, and `--mainnet` with a
node that serves another chain stops with an error. The output ends with the
ckb-debugger version, that VM version, the network and the node used, so a result
can be reproduced.

Some public nodes report `0x0` cycles for older blocks; the CLI then says the node
did not record them instead of claiming a mismatch (`--rpc` another node to
compare). A script that faults in the VM (invalid instruction, cycle limit) shows
as a rejection with the VM's message, Type ID is checked as the node checks it,
and a script's logs can neither fake its result nor send control characters to
your terminal: only ckb-debugger's final lines are read, they must agree with its
exit code, and a run that prints more than 64 MB is an error, never parsed.

Exit codes: **0** every script accepts (and the sum matches the node's); **1** a
script rejects, or the sum differs from the node's; **2** a usage or environment
error: bad arguments, a node that cannot be reached or does not answer within
`--timeout` (default 30 s), a transaction the node does not have (or rejected),
ckb-debugger missing or printing something it cannot read. So `test $? = 1`
asserts a rejection without passing when the node is down. CI runs the CLI against
live testnet transactions on a clean machine. `--json` for machine output,
`--mainnet` or `--rpc <url>` for another node (at most 16 requests in flight).
Your own scripts show as a short code
hash; name them with `--name <code-hash>=<label>` (repeatable, optionally
`<code-hash>:<hash-type>=…`), or `profileTransaction(tx, { scriptNames })` from code.
The web page does the same: click a script for its full code hash and a name box
(saved in that browser), and it prints the CLI command for the per-group breakdown
with those names filled in. ckb-debugger is found the same way
as everywhere else in this repo (see the Windows fix above).

### In the browser: per-group cycles on the web page

The page's **per-group cycles** button runs the same replay without installing
anything: ckb-debugger's WebAssembly build (0.200.1, shipped in `ckb-testtool`)
runs in a Web Worker through a WASI shim, with the mock transaction as an
in-memory file. It downloads ~4 MB (about 1.1 MB compressed) only when pressed,
then shows each group's result, cycles, share and logs, and whether the total
matches the node. It gives the same numbers as the native ckb-debugger 1.1.1:
15,675,038 (counter), 2,607,561 (Type ID deploy) and 1,787,335 (a 2023, VM v1
transaction), and `test/wasm.test.ts` checks that offline on recorded transactions.
From code: `wasmRunner(module, tx)` from `ckb-cycle-tools/wasm` plugs into
`replayGroups` from `ckb-cycle-tools/replay`, neither of which uses Node built-ins.

### Before you send: the failure path

`--file` profiles a transaction that is not on chain — one you are about to send,
or one the node rejected — and shows which script refuses it, with its exit code
and what it cost to get there. It reads the node's RPC JSON, a `get_transaction`
result, or a CCC transaction saved with `ccc.stringify(tx)`.

Here a real [session-lock spend](https://testnet.explorer.nervos.org/transaction/0x48b3bde2a50bb8ba3aff0800e850b2aa521793b35628d165eab7f22f984be828)
of exactly its 100 CKB limit, edited to pay one shannon more
([`test/fixtures/session-lock-overspend.json`](test/fixtures/session-lock-overspend.json)):

```
$ npx -p ckb-cycle-tools ckb-cycles --file session-lock-overspend.json
tx not on chain

GROUP  SCRIPT             RUN AT        RESULT       CYCLES  SHARE
lock   0x1ae8b8…26bc20    input.0.lock  exit 12      12,893   0.8%
lock   Secp256k1Blake160  input.1.lock  exit -31  1,642,194  99.2%

sum of groups, each run on its own  1,655,087
  not what the node spends: it stops at the first failing group, input.1.lock (Secp256k1Blake160),
  and reports no cycles for a rejected tx (it runs lock groups, then type groups,
  each in script-hash order)
  the node never runs: input.0.lock
```

The session lock refuses with its code 12 (outflow over `max_per_tx`) after
12,893 cycles; the secp256k1 lock fails too, because the edit invalidated the
signature. CI replays this file and requires exactly that refusal.

**What a rejected transaction's numbers mean.** The CLI runs every group on its
own, so you see every script that refuses, not only the first. The node does not
work that way. ckb-script's `TransactionScriptsVerifier::verify` runs the groups
one after another and returns at the first error, with no cycle count; a
rejected transaction has no cycles on the node at all. Its order is every lock
group, then every type group, each sorted by script hash (two `BTreeMap`s keyed by
script hash, locks chained before types), which is not the order the CLI lists
them in (first appearance). So for a rejected transaction the sum is labelled as
what it is, and the CLI names the group the node would stop at and the groups it
would never run. Above, the secp256k1 lock's script hash sorts first, so the node
rejects on the signature and never runs the session lock. In `--json` and in a
report's JSON, the scenario or profile gets `nodeStopsAt` (that group's selector)
and every group gets `nodeReaches: true | false`; both are absent when every
group accepts, so reports of accepted transactions are unchanged. The same
applies to a transaction whose groups each accept but together pass the node's
per-transaction cycle limit (see Max cycles below): it gets `overTxLimit:
{ limit, sum }` too, and `nodeStopsAt` names the group at which the running
sum, in the node's order, passes the limit. Sources, from
ckb `develop` at
[a4aa128](https://github.com/nervosnetwork/ckb/tree/a4aa1286a45bc1d42c30f6698dc51521c3749b40):
[`script/src/verify.rs`](https://github.com/nervosnetwork/ckb/blob/a4aa1286a45bc1d42c30f6698dc51521c3749b40/script/src/verify.rs#L180-L197)
(`verify`, stops at the first failing group) and
[`script/src/types.rs`](https://github.com/nervosnetwork/ckb/blob/a4aa1286a45bc1d42c30f6698dc51521c3749b40/script/src/types.rs#L642-L666)
with [L865-L868](https://github.com/nervosnetwork/ckb/blob/a4aa1286a45bc1d42c30f6698dc51521c3749b40/script/src/types.rs#L865-L868)
(group order). Which group fails first is computed, not observed: no node has
been asked to confirm it for a rejected transaction yet.

In code: `profileTransaction(readTransactionJson(json))`, or pass an RPC-shaped
transaction object directly; `nodeOrder(groups)` and `nodeStop(groups)` give the
node's order and where it stops.

### What comes from where when replaying

A replay rebuilds everything a script can observe from the chain, and takes the
rest from the node it asks or from ckb-debugger's defaults:

| Input to the replay | Where it comes from |
|---|---|
| Input cells (output, data) | The original chain via RPC: `get_transaction` of the transaction that created each cell, so a spent cell replays as it was, not from the live cell set |
| Cell deps, dep groups | Same, from the creating transactions; a dep group's cell is read and every cell it lists added as a code dep |
| Input cell headers | The block that created each input cell (its `block_hash`), as on the node; a script sees it only if the transaction lists it in `header_deps`, as on the node |
| Header deps | `get_header` for each hash in the transaction's `header_deps` |
| Witnesses, outputs, outputs data | The transaction itself (from `get_transaction`, or the `--file` you pass) |
| Hardfork epochs (consensus) | The node's current `get_consensus` (RFC 0032 for CKB-VM v1, RFC 0049 for v2); a built-in table only when the public node of `--mainnet`/testnet cannot say |
| CKB-VM version | For `hash_type: "type"` scripts: the version at the epoch of the transaction's block, from `get_header`, on those consensus epochs. `data`, `data1`, `data2` name their own. A transaction not on chain (`--file`) gets v2, today's version, not one read from the node |
| Max cycles | ckb-debugger's default, 3,500,000,000 **per group** (each group is its own run). The node's limit is **per transaction**: in a block, each transaction is verified with the consensus `max_block_cycles` (3,500,000,000 on mainnet and testnet), the remaining budget shrinking group by group, and the block's sum must stay under it too. So a transaction whose groups each fit but together exceed the limit passes ckb-debugger and fails on the node; the CLI, `report` and `diff` flag it ("over the node's per-transaction limit ...: the node would reject this transaction (exceeded max cycles)", `overTxLimit` in the JSON, exit 1), with the node's `max_block_cycles` from `get_consensus` when the replay asked the node, else 3,500,000,000. A gated `diff` fails on a scenario newly over it |
| Group order | Here: first appearance, every group run, failures included. Node: lock groups then type groups, each by script hash, stopping at the first failure (see above) |
| Type ID | Not a binary: checked here as the node checks it, and charged the node's fixed `TYPE_ID_CYCLES` (1,000,000) |
| Since, capacity, maturity checks | Not replayed: the node checks them outside any script, so a script-level replay cannot see them |
| Script names | CCC's known-script table for the network, and your `--name`s; labels only |

The node's own verification lives in
[`verification/contextual/src/contextual_block_verifier.rs`](https://github.com/nervosnetwork/ckb/blob/a4aa1286a45bc1d42c30f6698dc51521c3749b40/verification/contextual/src/contextual_block_verifier.rs#L413-L466)
(per-transaction limit and block sum) and ckb-debugger's default in
[`ckb-debugger/src/main.rs`](https://github.com/nervosnetwork/ckb-standalone-debugger/blob/740d6de0c1d7c2394a492f9bfef57e77abb98dfd/ckb-debugger/src/main.rs#L44)
of v1.1.1. A node's transaction pool also has a `max_tx_verify_cycles` setting
in its `ckb.toml`: a local setting, not consensus.

### Inside a script: flamegraphs

`ckb-cycles flame` shows where inside each script the cycles go. It runs every
script group in ckb-debugger's flamegraph mode, merges the stacks, names the
frames by function, prints the costliest ones and writes an SVG flamegraph and
a folded-stack file per group (open the `.folded` in
[speedscope](https://www.speedscope.app/) for an interactive view).

Deployed scripts are stripped, so a profile of one is a single frame. Give an
unstripped build of the same code with `--bin <code-hash>=<elf>`; the tool runs
the group with both binaries and says whether the cycles agree, so you know the
graph describes the deployed code. Here, a real
[subscription charge](https://testnet.explorer.nervos.org/transaction/0x50ae6df49d411a5766da1c9717da9e6ff34670194b389779f717fcee71a03092)
of the ckb-session-kit lock, with that lock built with symbols
(`CARGO_PROFILE_RELEASE_STRIP=false cargo build --release`):

```
$ npx -p ckb-cycle-tools ckb-cycles flame 0x50ae6df4…a03092 --script input.0.lock \
    --bin 0xab419466…4c08ce=target/riscv64imac-unknown-none-elf/release/session-lock
input.0.lock  0xab4194…4c08ce  ok  20,999 cycles
  --bin …/session-lock: same cycles as the deployed binary
  profiled 19,187 cycles (loading the binary is not profiled)
  SELF        TOTAL       FUNCTION
       4,490       5,972  session_lock::lock_hash
       3,145       3,145  compiler_builtins::mem::memcpy
       2,545      18,678  __ckb_std_main
       2,156       2,156  session_lock::has_type
       2,076       2,076  memcmp
  → flame/input.0.lock.svg, flame/input.0.lock.folded
```

Reading the lock hashes of the transaction's cells is the lock's largest cost.
The profile covers the instructions the script ran; the difference (1,812 cycles
here) is what the VM charges outside instructions, such as loading the binary and
the bytes each syscall copies, counted by the node but in no frame.

**A script that spawns another** (CKB2023 `spawn`): its group's cycles include
every script it spawned, as on the node, and the CLI and report say how many it
spawned. The functions are the spawning script's own: ckb-debugger profiles only
that one, and `--bin` replaces only its binary, so the spawned scripts' work is
in the total but in no frame. [`test/fixtures/spawn-project`](test/fixtures/spawn-project)
is such a pair.

**Flamegraph fidelity: what is exact and what is attributed.** The group's cycle
total is exact: it is ckb-debugger's run of the deployed binary, the same number
the node counts (and `--bin` checks that the symbols build costs the same). How
that total is split between functions is reconstructed. ckb-debugger's profiler
(`machine_analyzer.rs` in
[v1.1.1](https://github.com/nervosnetwork/ckb-standalone-debugger/blob/740d6de0c1d7c2394a492f9bfef57e77abb98dfd/ckb-debugger/src/machine_analyzer.rs))
charges each instruction's cost (ckb-vm's cost model) to the current frame, and
opens a frame only when a `jal`/`jalr` jumps to an address the ELF symbol table
lists as a function start. So:

- inlined code has no symbol of its own and is charged to the function it was
  inlined into, so an optimised build shows fewer, heavier frames than the source
  has functions, and moving code between inlined and not changes the split
  without changing the total;
- frames are named with the binary's DWARF info where it has some, and otherwise
  from the symbol table (this tool fills in the `func_0x…` frames the profiler
  could not name);
- cycles the VM charges outside instructions (loading the binary, bytes copied by
  syscalls) are in no frame, so the profile is a little under the group total and
  the CLI prints both;
- spawned scripts are in the total but in no frame (above).

Per-function numbers are therefore exact sums of the instructions attributed to
each frame, but which frame gets them depends on the build's inlining and symbols.
Compare functions only between builds with the same profile.

**In the browser:** drop the `.folded` file on the
[web inspector](https://ckb-cycle-tools.vercel.app/) ("inside a script"), or open
its example, and it draws the same flamegraph and table. Nothing is uploaded.
(The page's WebAssembly ckb-debugger can profile but not name functions, so the
profile itself comes from the CLI.)

In code: `flameTransaction(target, { bins, readFile })`, then `functionCosts`,
`flameTree` and `renderFlameSvg` from `ckb-cycle-tools/flame` (no Node
built-ins, so the browser can draw the same graph).

## Cycle reports on pull requests

A change to a script should say what it did to that script's cycles, and above
all whether any accept turned into a reject. `ckb-cycles report` replays every
scenario in a [`cycles.json`](cycles.json) and records each script group's result
and cycles; `ckb-cycles diff` compares two such reports; the
[GitHub Action](action/README.md) runs both on a PR (the PR's build against its
base's) and keeps one comment up to date.

Scenarios are best kept as ckb-debugger mock transactions, so CI needs no node:
this repo's five are written by `benchmarks/session-lock/mocks.mjs`, and
`ckb-cycles mock <tx-hash> -o file.json` saves any transaction that way.
`binaries` swaps the deployed code for the one just built (the rules for
`type` vs `data*` hash types are in the [Action's README](action/README.md#cyclesjson)).
For a cycles.json from a pull request, `--root <dir>` (repeatable) refuses any
file it names outside those directories, and ignores its `"rpc"` (with a
warning; `--rpc` still applies). Mocks with ckb-debugger template directives
(`{{ data <path> }}`, `{{ hash <path> }}`, …), or a field that should be hex and is not, are
refused, with or without `--root`.

With `--fail-above` or `--fail-on-result-change` set, `diff` fails on anything
it could not check, not only on what it measured: a scenario either side could
not run, an error in either report (a binary that matched no cell dep in any
scenario is in the report JSON's `"errors"`), and a base group with nothing in
the head to compare against (a scenario or group removed, renamed or moved, or
measured without its binary); `--allow-removed` accepts the last. A group the VM
stopped (past the cycle limit, a bad instruction) is a result change, and over
any `--fail-above` threshold, never a -100% saving; two different VM errors are
two different results. A group that accepted on the base and rejects on the
head (`ok` → `exit 5`, or a VM error) fails `--fail-above` too, whatever its
cycles: a cheaper rejection is not a saving. `--fail-on-result-change` is
broader: it also fails on a rejection that now accepts, one exit code turning
into another, and a new group that does not accept. With `--binaries-from`, a binary missing from that
checkout is left as the mock has it: only the groups whose code it is are not
compared, and every other binary is still swapped in. A binary offered to a
scenario that matches none of its cell deps is a warning on that scenario, in
the comment too. The summary says when the two reports come from different
ckb-debugger versions.

#### What a report was measured with: the manifest

Each report's JSON has a `manifest` (from 1.3.0 on): the ckb-cycle-tools version,
ckb-debugger's `--version` and the sha256 of the binary every scenario ran (or a
WebAssembly build's id, when a library caller runs one), the git commit of the
checkout the cycles.json is in (and of `--binaries-from`; none outside a git
checkout), an optional `--toolchain <text>` (say, `rustc -V` and the build
profile), and per scenario the CKB-VM version, an `inputs` sha256 and each
swapped-in binary's path, sha256 and size. `inputs` covers what decides what a
scenario runs: the bytes of its mock or transaction file as read, and its
cycles.json entry without its name or file path (its form, transaction hash,
`binaries` list, `scriptVersion`, and the network for a transaction fetched
from a node).

`diff` reads both manifests. A scenario whose `inputs` differ between base and
head did not measure the same transaction: its groups are **NOT COMPARED:
inputs changed**, and a gated diff (`--fail-above` or `--fail-on-result-change`)
fails on it unless `--allow-changed-inputs`. Another ckb-debugger (version,
binary, or native against WebAssembly) or another CKB-VM version for a scenario
fails a gated diff with the reason listed under the summary, and is a
prominent note otherwise. A different toolchain is a note. A report without a
manifest (written before 1.3.0) on one side is a note, never a failure; two
such reports diff as they always did. Every manifest string (a toolchain, a
path) is cleaned like any other report text before it reaches a terminal or a
comment.

Here the ckb-js-vm session lock was changed to allow one shannon more than its
limit and to do extra work per recipient check:

```
$ npx -p ckb-cycle-tools ckb-cycles report cycles.json --json base.json
$ npx -p ckb-cycle-tools ckb-cycles report cycles.json --binaries-from ../pr --json head.json
$ npx -p ckb-cycle-tools ckb-cycles diff base.json head.json --fail-above 1
1 result change, 1 over the 1% threshold, 5 of 10 script groups changed
```

| Scenario | Group | Script | Base | Head | Δ | Δ% | |
|---|---|---|---:|---:|---:|---:|---|
| one shannon over max\_per\_tx | `input.0.lock` | session-lock (ckb-js-vm) | 14,544,014 (exit 12) | 14,557,318 | +13,304 | +0.09% | **RESULT CHANGED: exit 12 → ok** |
| pays the allowed recipient | `input.0.lock` | session-lock (ckb-js-vm) | 14,768,645 | 15,465,881 | +697,236 | +4.72% | **over 1%** |
| spend exactly max\_per\_tx | `input.0.lock` | session-lock (ckb-js-vm) | 14,544,018 | 14,557,320 | +13,302 | +0.09% | |

That table (with `--markdown`) is what the PR comment shows; unchanged groups
fold away below it. This repo runs the Action on its own pull requests
([`.github/workflows/cycle-report.yml`](.github/workflows/cycle-report.yml)).

The PR's build is the PR's code. In the Action's one-job setup it runs in the
job that also holds the comment's token (`pull-requests: write`; read-only for
a PR from a fork): the Action keeps what the build writes to `$GITHUB_PATH` and
`$GITHUB_ENV` away from that token, but a build that leaves a process running
or replaces files on the runner can still take it. For pull requests you would
not trust with it, the [two-job setup](action/README.md#two-jobs-the-build-never-shares-a-runner-with-the-comment-token)
builds with a read-only token and posts from a second job that runs no PR code
(`action/comment`). Check out with `persist-credentials: false` either way.

### Which functions changed

A row says a group got 3% dearer; the flamegraph mode can say where. Give a
binary an unstripped build of the same code as `symbols`, and ask for
`functions`, for every scenario or per scenario:

```json
{
  "functions": true,
  "binaries": {
    "my-lock": {
      "path": "build/release/my-lock",
      "symbols": "build/release/my-lock.debug",
      "codeHash": "0x…"
    }
  },
  "scenarios": [{ "name": "spend", "mock": "tests/mocks/spend.json" }]
}
```

For each group whose script is that binary, `report` runs the group again in
ckb-debugger's flamegraph mode with `--bin <symbols>` and records the 15
costliest functions (self and total cycles) in the report. It first checks that
the symbols build costs exactly the cycles of the binary it stands for; if not,
it is not the same code, and the group gets a warning instead of functions.
Code the debugger has no line info for (ckb-std's `_start`, the allocator shims
rustc adds) it calls `func_0x<address>`; those frames take their name from the
build's ELF symbol table, so a function that moved between builds is not a
removal and an addition in a diff. `diff --markdown` then adds a folded block under the table for each changed
group: the functions whose self cycles changed, base, head and Δ, the ten
largest changes first. A report without functions (an older base, or a
config without `symbols`) still diffs as before; a function shows `—` where
its cycles are not known on that side.

A Rust build keeps its symbols with `CARGO_PROFILE_RELEASE_STRIP=false`; build
it next to the stripped one, from the same commit.

### From ckb-testtool tests (ckb-script-templates projects)

A project made from
[ckb-script-templates](https://github.com/nervosnetwork/ckb-script-templates)
already has its scenarios: the Rust tests in `tests/`, on ckb-testtool. Each
test can leave its transaction behind as a mock, and `ckb-cycles scan` writes
the cycles.json from them, so nothing is written by hand.

1. In the tests crate, add the helper in
   [`integrations/ckb-testtool`](integrations/ckb-testtool/src/lib.rs) and call
   it where a test calls `context.verify_tx`:

   ```toml
   # tests/Cargo.toml
   [dependencies]
   ckb-cycles-testtool = { git = "https://github.com/luongthanhtung03/ckb-cycle-tools" }
   ```

   ```rust
   let cycles = ckb_cycles_testtool::verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
   ```

   The tests `make generate` writes call `context.verify_tx(&tx, 10_000_000)`
   over two lines; one substitution changes them all:

   ```
   perl -0pi -e 's/context\s*\.verify_tx\(&tx,/ckb_cycles_testtool::verify_tx(&context, &tx,/g' tests/src/tests.rs
   ```

   It returns what `context.verify_tx` returns. When `CKB_CYCLES_MOCKS` names a
   directory, it also writes `context.dump_tx(&tx)` there, accepted or rejected,
   named after the test: `tests::test_transfer` is `tests.test_transfer.json`, a
   second transaction in the same test `tests.test_transfer-2.json`. Without the
   variable it writes nothing. (It is about 40 lines; copying it into
   `tests/src/lib.rs` works as well.)

2. Add a target to the workspace Makefile:

   ```make
   CKB_CYCLES ?= npx -y -p ckb-cycle-tools ckb-cycles
   CYCLES_MOCKS := target/ckb-cycles

   cycles-config: build
   	rm -rf $(CYCLES_MOCKS)
   	CKB_CYCLES_MOCKS="$(abspath $(CYCLES_MOCKS))" cargo test -p tests
   	$(CKB_CYCLES) scan $(CYCLES_MOCKS) --binaries $(BUILD_DIR) --functions -o cycles.json

   cycles: cycles-config
   	$(CKB_CYCLES) report cycles.json
   ```

   The npm package is `ckb-cycle-tools`; its command is `ckb-cycles`, so a
   project with no package.json needs `npx -p ckb-cycle-tools` (a bare
   `npx ckb-cycles` looks for a package of that name). `scan` needs 1.1.0 or
   later; to run a checkout instead, point the variable at it,
   `make cycles CKB_CYCLES="node ../ckb-cycle-tools/dist/cli.js"`.

`make cycles` then builds the contracts, runs the tests, and reports each
test's script groups, with the costliest functions of your own contracts. The
fixture project below, its two steps run by hand:

```
$ npx -p ckb-cycle-tools ckb-cycles scan mocks --binaries build/release --functions -o cycles.json
cycles.json: 6 scenario(s), 1 binary (args-loop)
code cells that are none of the binaries: 0xe683b041…3660d7
$ npx -p ckb-cycle-tools ckb-cycles report cycles.json
SCENARIO                          GROUP         SCRIPT           RESULT   CYCLES
tests.test_beside_always_success  input.0.lock  args-loop        ok       95,392
tests.test_beside_always_success  input.1.lock  0x91b570…218629  ok        2,107
tests.test_empty_args_rejected    input.0.lock  args-loop        exit 5    2,186
tests.test_heavy_spend            input.0.lock  args-loop        ok      468,128
tests.test_light_spend            input.0.lock  args-loop        ok       25,504
…
tests.test_heavy_spend input.0.lock: costliest functions (self cycles): args_loop::work 440,320, _start 26,713, memset 230
```

`scan` makes one `"mock"` scenario per file, and one binary per file in
`--binaries` (default `build/release`) that a test deployed, matched by its data
hash, with `<name>.debug` (the template's unstripped copy) as its `symbols`. It
says on stderr which files no test deployed and which code cells are none of
the binaries (ckb-testtool's always-success, above). The code hashes are those of
the build the tests ran against, so the cycles.json is regenerated after each
build, not committed.

ckb-testtool gives each deployed cell a Type ID type script and `build_script`
uses `hash_type: "type"`, so swapping in another build changes only the code.
On a pull request, make the head's mocks and cycles.json in a step before the
Action, and let the Action build both sides (the base's tests may not have the
helper yet):

```yaml
- run: make cycles-config
- uses: luongthanhtung03/ckb-cycle-tools/action@<commit-sha>
  with:
    build: make build
```

[`test/fixtures/testtool-project`](test/fixtures/testtool-project) is a small
project in the template's layout, with the output above; the design and its
open questions are in [docs/design/testtool-integration.md](docs/design/testtool-integration.md).

[`scripts/templates-e2e.sh`](scripts/templates-e2e.sh) does all of this on a
real project: it generates a workspace from ckb-script-templates (commit
`f90b1e2`), adds two contracts with `make generate` (`alpha` from `contract`,
`beta` from `contract-without-simulator`), applies the two steps above, runs
`make cycles-config`, then makes `alpha` run a 1,000-step loop and runs it again.
It fails unless each report agrees with the cycles ckb-testtool itself counted
and only `alpha` changed. Its run on Linux (rustc 1.99, clang 19, ckb-debugger
1.1.1):

```
SCENARIO          GROUP         SCRIPT   BASE    HEAD        Δ        Δ%
tests.test_alpha  input.0.lock  alpha   7,156  19,174  +12,018  +167.94%
tests.test_beta   input.0.lock  beta    7,156   7,156        0        0%

functions in tests.test_alpha input.0.lock: __ckb_std_main +12,008
```

The base column is the base's binaries swapped into the head's mocks
(`report --binaries-from`); it gives the same 7,156 as the base's own tests.
(The Action measures the base with the base commit's own cycles.json and mocks,
so a scenario a pull request deletes still shows up, as removed.)

## ckb-js-vm vs Rust: one lock, two implementations

`benchmarks/session-lock` holds a TypeScript port of the
[ckb-session-kit](https://github.com/luongthanhtung03/ckb-session-kit) session lock
for ckb-js-vm, plain CKB and token sessions (error codes 10-20). It runs the same
58 scenarios as the Rust original (ckb-session-kit 49227cd) in the real CKB-VM and
fails unless both implementations make every accept/reject decision correctly.

| | Rust | ckb-js-vm |
|---|---:|---:|
| Mean cycles, accepted plain CKB spends | 14,758 | 15,037,968 |
| Mean cycles, accepted token spends | 20,348 | 15,518,698 |
| Cheapest run (start-up cost) | 3,145 | 14,272,805 |

About 95% of the ckb-js-vm cost is starting the VM; the lock's own logic runs at
roughly 66× the Rust logic. Full table, and the 8 Oct numbers for comparison:
[RESULTS.md](benchmarks/session-lock/RESULTS.md).

```bash
npm run bench:session-lock   # needs the Rust lock built in ../ckb-session-kit, or SESSION_LOCK_BIN
```

CI rebuilds both implementations from source — the Rust lock from a pinned
ckb-session-kit commit — reruns every scenario, and publishes the table in the
job summary.

## Mainnet cycle atlas

A one-off snapshot of what the scripts in recent mainnet transactions cost, measured
with the same replay as `ckb-cycles <tx-hash>`:
[atlas/2026-10-28/report.md](atlas/2026-10-28/report.md), raw results in
[data.json](atlas/2026-10-28/data.json).

1,000 transactions from every 12th block between 20,835,876 and 20,851,152
(26 to 27 Oct 2026, about 39 hours), each replayed per script group in
ckb-debugger 1.1.1. All 1,000 matched the node's cycle totals exactly, so none was
excluded. secp256k1_blake160 accounts for 93.7% of the cycles, at a median of
1,647,788 per group; it runs once per distinct owner, so the costliest transaction
in the sample (68 owners) cost 111,979,599 cycles. 694 of the 1,000 transactions
update d.id's on-chain time oracle (two type scripts at about 45k and 33k cycles),
and the next most expensive type script is the Bitcoin SPV client behind RGB++
(median 1,369,197). The report lists min, median, p90 and max per script, its
share, an example transaction, and the cell each script's code came from.

The random sample saw no xUDT, Omnilock, Spore or Type ID, so the report has a
second, separate section of targeted samples: for each of 22 scripts, up to 40 of
the most recent transactions in which it ran, found with the indexer RPC and
replayed the same way (653 replays; 601 matched the node, none mismatched, and
52 older transactions, all at or before block 19,011,137, have no cycle total
on the public node and are listed as not recorded). Medians per group from that
section: xUDT 20,498, Spore 103,953, Cluster 98,683, Omnilock 1,458,708
(Ethereum displaying) and 1,458,571 (Bitcoin), JoyID 6,844,452, RGB++ lock
1,418,522, COTA 1,134,820. These are costs per run, not shares of mainnet.

Only a transaction whose groups add up to the node's total is aggregated; any other
is listed in the report with its reason, never dropped. To reproduce the same window
(read-only JSON-RPC against a public node, paced and retried; about 25 minutes):

```bash
npm ci
npm run atlas -- --rpc https://mainnet.ckb.dev/ --to 20851152 --blocks 15277 --stride 12 --max-txs 1000
```

Without `--to` it samples back from the current tip; `--out <dir>` chooses where
`data.json` and `report.md` go, `--resume` continues an interrupted run, and
`--report-only <dir>` rebuilds the report from an existing `data.json` (and names
scripts identified since the run). The atlas and its script are part of the
repository only, not the npm package.

Targeted samples are added to an existing atlas folder. `--script` takes a name
(`xudt`, `omnilock`, `spore`, `cluster`, `type-id`, `joyid`, `rgbpp-lock`,
`ickb-logic`, `das-lock` and others; an unknown name lists them) or a code hash as
`<hash>[:<hash type>[:lock|type]]`, optionally narrowed to an args prefix with
`@<hex>`, e.g. `omnilock@0x04` for Omnilock's Bitcoin auth. The search looks back
from `--to`, widening five-fold from 20,000 blocks up to `--max-window`, and
replays the newest `--max-txs` (default 40). The command that made the report's
section is at the end of the report.

## Across ckb-debugger versions

Do the numbers depend on which ckb-debugger you have? `npm run compat` replays the
same 35 frozen scenarios under every release in
[compat/debuggers.json](compat/debuggers.json) and compares each script group
with the reference, 1.1.1 (the release the CLI and CI pin):
[compat/RESULTS.md](compat/RESULTS.md), raw runs in
[results.json](compat/results.json).

The scenarios are the six ckb-testtool fixture mocks, the five session-lock
benchmark mocks (ckb-js-vm), the two recorded testnet transactions (one on VM 1),
and 22 mainnet transactions from the atlas, one per script it sampled (xUDT,
Omnilock, Spore, Type ID, JoyID, RGB++, iCKB, COTA, Nervos DAO and others). They
are stored with every cell in
[compat/scenarios.json.br](compat/scenarios.json.br), so every build reads the
same bytes and the run needs no network.

Measured on 28 Oct 2026 on Windows: native releases 0.121.0, 0.200.0, 0.200.1,
0.200.2, 0.203.0, 1.0.0, 1.1.0 and 1.1.1, and the WebAssembly builds of 0.200.1
to 1.1.1 (the web page's build in ckb-testtool is byte for byte the 0.200.1 one).
All 455 scenario runs, 1,170 script groups, gave the reference's cycles and exit
code, and every mainnet and testnet total matched the node. The same
transactions on another CKB-VM version do cost differently (VM 2 is cheaper than
VM 1, and VM 0 cannot run most of today's binaries); the results explain each
case from the hardfork RFCs. That is why the replay takes the VM version from the
block's epoch, not from the debugger.

```bash
npm ci
npm run compat -- fetch    # downloads each release into .cache/, sha256 checked
npm run compat             # runs everything (about 2.5 minutes), exits 1 on any mismatch
```

`--only 1.0.0,1.1.0` limits the releases, `--no-wasm` skips the WebAssembly
builds, `--no-sweep` skips the VM 0/1/2 sweep, and `npm run compat -- record`
rebuilds the scenario file (read-only RPC; needs `npm run bench:build` first).
[.github/workflows/compat.yml](.github/workflows/compat.yml) runs the check with
the Linux builds weekly and on demand; its first run on GitHub (2 Nov 2026) passed.

## Limits

- **It needs a node, or a saved transaction.** Rebuilding a transaction means
  fetching every input cell and cell dep; without RPC access, use a mock file
  (`ckb-cycles mock` saves one) or `--file`.
- **Type ID is charged, not run.** The node verifies Type ID natively; the tools
  charge its fixed 1,000,000 cycles and check its rules the way the node does.
- **Two debugger builds.** The CLI uses the native ckb-debugger you install
  (1.1.1 here); the web page uses the WebAssembly build shipped in
  `ckb-testtool` (0.200.1). They agree on every transaction checked, and so do
  the releases in between ([Across ckb-debugger versions](#across-ckb-debugger-versions)),
  but a future CKB-VM change could reach one before the other; each result names
  the version it used.
- **Flamegraphs need symbols.** On-chain binaries are stripped; `flame` names
  functions only with an unstripped build passed by `--bin` (or `symbols` in a
  cycles.json). The CLI draws the graphs, the PR comment lists the changed
  functions, and the web page draws a `.folded` file the CLI made.
- **Groups run on their own.** Every group is a separate ckb-debugger run with
  its own 3,500,000,000-cycle limit; the node runs them in its own order under
  one per-transaction limit and stops at the first failure. A rejected
  transaction's sum is labelled as such, and the group the node would stop at
  is computed from ckb-script's order, not yet confirmed by a node. A sum over
  the per-transaction limit is flagged as a rejection, from the summed group
  cycles; no node has been asked to confirm one yet
  ([What comes from where](#what-comes-from-where-when-replaying)).
- **Older blocks.** Some public nodes report `0x0` cycles for old blocks; the
  tools then say the total is unknown instead of claiming a match.
- **The PR Action has run on one public pull request so far**, in this repository:
  [#1](https://github.com/luongthanhtung03/ckb-cycle-tools/pull/1) slows one check of
  the ckb-js-vm benchmark lock on purpose, and the comment reports it (+2.94% on that
  scenario, results unchanged). It has not yet run in another project's repository.

## Why it is a separate repository

It started as measurement scaffolding inside a learning exercise. That is a bad place
for a tool to live if anyone else might want it.

## Related work

Other CKB tools touch the same ground. This is what each one does, as far as its
own documentation says, and where this repository sits next to it.

- **[ckb-debugger](https://github.com/nervosnetwork/ckb-standalone-debugger)**
  (nervosnetwork) runs CKB scripts off chain from a mock transaction and reports
  their cycles, with a flamegraph mode. It is the engine everything here drives;
  nothing in this repository re-implements the VM. What is added on top: rebuilding
  a mock transaction from a tx hash or a saved transaction, one run per script
  group with totals checked against the node, picking the VM version from the
  block, Type ID charged as the node charges it, named flamegraphs checked against
  the deployed binary, report diffs, and the PR Action.
- **[ckb-devnet-explorer](https://github.com/wildanrhmn/ckb-devnet-explorer)** is a
  lightweight explorer for OffCKB devnets that reads the node directly. It names
  genesis and project-deployed scripts (including JS contracts on ckb-js-vm),
  decodes cells such as DAO, xUDT, Spore and Type ID, and shows each transaction's
  fee, size and cycles. It answers "what is in this transaction"; cycle-tools
  answers "which script spent the cycles, and why", on testnet and mainnet as well.
  The two fit together: a devnet transaction can be saved with `ckb-cycles mock`
  and profiled here.
- **[CKB Contract Flow](https://talk.nervos.org/t/ckb-contract-flow-visual-cell-transition-explainers-on-chain-tx-decoder-for-46-ckb-contracts/11014)**
  ([repo](https://github.com/gpBlockchain/ckb-contract-flow-html)) explains the
  cell transition rules of 46 contracts as visual pages, and its decoder splits a
  testnet or mainnet transaction into script groups and checks each contract's
  rules. It explains what a script requires; it does not run scripts or measure
  cycles. Cycle-tools runs them and measures, without explaining the rules.
- **[CKBadger](https://talk.nervos.org/t/ckbadger-a-local-first-ckb-native-explorer-and-a-vibe-coding-experiment/10276)**
  ([repo](https://github.com/janx/ckbadger)) is a local-first explorer built around
  the cell model, syncing from a node and showing mainnet and testnet side by side.
  It is for browsing the chain; cycle-tools looks at one transaction at a time and
  only at its execution cost.
- **[CellScript](https://github.com/CellScript-Labs/CellScript)**'s
  [cost report](https://talk.nervos.org/t/cellscript-0-30-abstractions-bytes-and-the-cost/10732)
  compares executable bytes and cycles of matched CellScript and hand-written Rust
  contracts, with acceptance and rejection cases on both sides. It is a language
  project measuring its own compiler output, and the method is close to this
  repository's ckb-js-vm vs Rust harness. The two are complementary: a
  `cycles.json` and the PR Action could track such pairs on every change, with
  per-function diffs, rather than only at release time.

## Licence

MIT. See [LICENSE](LICENSE).

## Author

Luong Thanh Tung — [@luongthanhtung03](https://github.com/luongthanhtung03)

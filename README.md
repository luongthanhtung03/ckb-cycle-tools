# ckb-cycle-tools

Cycle measurement for CKB on-chain scripts.

**Live demo:** [ckb-cycle-tools.vercel.app](https://ckb-cycle-tools.vercel.app/) — paste a testnet tx hash, see cycles and script groups (CKB testnet).

**Status: early development.** Built in the open during my CKBuilder programme.

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
$ npx ckb-cycles --file session-lock-overspend.json
tx not on chain

GROUP  SCRIPT             RUN AT        RESULT       CYCLES  SHARE
lock   0x1ae8b8…26bc20    input.0.lock  exit 12      12,893   0.8%
lock   Secp256k1Blake160  input.1.lock  exit -31  1,642,194  99.2%
```

The session lock refuses with its code 12 (outflow over `max_per_tx`) after
12,893 cycles; the secp256k1 lock fails too, because the edit invalidated the
signature. CI replays this file and requires exactly that refusal.

In code: `profileTransaction(readTransactionJson(json))`, or pass an RPC-shaped
transaction object directly.

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

Here the ckb-js-vm session lock was changed to allow one shannon more than its
limit and to do extra work per recipient check:

```
$ npx ckb-cycles report cycles.json --json base.json
$ npx ckb-cycles report cycles.json --binaries-from ../pr --json head.json
$ npx ckb-cycles diff base.json head.json --fail-above 1
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

## ckb-js-vm vs Rust: one lock, two implementations

`benchmarks/session-lock` holds a TypeScript port of the
[ckb-session-kit](https://github.com/luongthanhtung03/ckb-session-kit) session lock
for ckb-js-vm. It runs the same 20 scenarios as the Rust original in the real
CKB-VM and fails unless both implementations make every accept/reject decision
correctly.

| | Rust | ckb-js-vm |
|---|---:|---:|
| Mean cycles, accepted spends | 12,263 | 14,573,318 |
| Cheapest run (start-up cost) | 2,318 | 13,916,789 |

About 95% of the ckb-js-vm cost is starting the VM; the lock's own logic runs at
roughly 66× the Rust logic. Full table: [RESULTS.md](benchmarks/session-lock/RESULTS.md).

```bash
npm run bench:session-lock   # needs the Rust lock built in ../ckb-session-kit, or SESSION_LOCK_BIN
```

CI rebuilds both implementations from source — the Rust lock from a pinned
ckb-session-kit commit — reruns the 20 scenarios, and publishes the table in the
job summary.

## Why it is a separate repository

It started as measurement scaffolding inside a learning exercise. That is a bad place
for a tool to live if anyone else might want it.

## Licence

MIT. See [LICENSE](LICENSE).

## Author

Luong Thanh Tung — [@luongthanhtung03](https://github.com/luongthanhtung03)

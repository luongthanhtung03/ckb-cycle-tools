# ckb-cycle-tools

Cycle measurement for CKB on-chain scripts.

**Live demo:** [ckb-cycle-tools.vercel.app](https://ckb-cycle-tools.vercel.app/) — paste a testnet tx hash, see cycles and script groups (CKB testnet).

**Status: early development.** Built in the open during my CKBuilder programme.

| When | Milestone |
|---|---|
| w/c 5 Oct 2026 | Scaffold, CI, the Windows `ckb-debugger` shim fix |
| w/c 12 Oct | CLI: per-script cycle table for a transaction |
| w/c 19 Oct | Failure-path profiling; CI on Linux and Windows |
| w/c 26 Oct | ckb-js-vm vs Rust comparison harness |
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
the per-group breakdown (CLI, next) and the ckb-js-vm vs Rust harness are for.

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

input.0.type logged:
  [DEBUG] counter: 1 input(s) -> 1 output(s)
  [DEBUG] counter incremented 2 -> 3
```

So in that transaction, **89.5% of the cost is the counter Type Script running on
ckb-js-vm**. Type ID is verified natively by the node and cannot run in
ckb-debugger; the CLI charges it the node's fixed `TYPE_ID_CYCLES` (1,000,000), and
the totals still match exactly.

The CLI exits non-zero on a mismatch or a rejecting script, and CI runs it against
live testnet transactions on a clean machine. `--json` for machine output,
`--mainnet` or `--rpc <url>` for another node. ckb-debugger is found the same way
as everywhere else in this repo (see the Windows fix above).

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

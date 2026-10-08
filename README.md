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

## Why it is a separate repository

It started as measurement scaffolding inside a learning exercise. That is a bad place
for a tool to live if anyone else might want it.

## Licence

MIT. See [LICENSE](LICENSE).

## Author

Luong Thanh Tung — [@luongthanhtung03](https://github.com/luongthanhtung03)

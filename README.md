# ckb-cycle-tools

Cycle measurement for CKB on-chain scripts.

**Status: not started.** This repository exists so the work has somewhere to land.
There is no implementation here yet — the first real commit is due in Week 4 of my
CKBuilder programme (w/c 5 October 2026), when the measurement harness this is built
from gets written.

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

## Why it is a separate repository

It started as measurement scaffolding inside a learning exercise. That is a bad place
for a tool to live if anyone else might want it.

## Licence

MIT. See [LICENSE](LICENSE).

## Author

Luong Thanh Tung — [@luongthanhtung03](https://github.com/luongthanhtung03)

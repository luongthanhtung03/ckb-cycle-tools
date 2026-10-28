## Reading the results

**Across debugger releases: no difference.** At each scenario's own CKB-VM
version, every release from 0.121.0 to 1.1.1, native and WebAssembly, gave the
reference's cycles and exit code for every script group. Where the node recorded
a total, the reference's groups add up to it exactly (a `≠ node` would mark any
that did not). This is what was expected: a debugger release changes the tool
around the VM, not what an instruction costs. The WebAssembly build the web page
runs (from ckb-testtool 1.0.5) is byte for byte the wasm32-wasip1 asset of
release 0.200.1, so that row covers the web page.

0.121.0 predates the `--script input.0.lock` flag; the check passes it the same
group as `--cell-type input --cell-index 0 --script-group-type lock`. Releases
before 0.121.0 were not tried.

Run time differs, cycles do not: 0.121.0 to 0.200.2 took about three times as
long as 0.203.0 and later for the same runs (native 11 to 15 s against 4.5 s,
WebAssembly 20 s against 7 s, on this machine).

**Across CKB-VM versions: differences, all from the hardforks.** The sweep runs
the same transactions with `--script-version` 0, 1 and 2 under the reference.
That flag sets the VM for `hash_type: "type"` scripts; a `data1` or `data2`
script names its own VM.

- *VM 2 costs fewer cycles than VM 1* for the same code (for example the
  secp256k1 lock in mainnet/omnilock: 1,491,449 on VM 1, 1,456,364 on VM 2).
  CKB-VM version 2 (RFC 0049, the Meepo hardfork) adds macro-operation fusion
  patterns, and a fused instruction sequence is charged as one. This is why the
  CKB-VM version must come from the block's epoch: the testnet transaction from
  2023 (testnet/0x6f31e5b8) matches the node only on VM 1 (1,787,335); on VM 2
  it would read 1,731,503.
- *VM 0 costs more again, or cannot run the code at all.* Binaries built with
  today's toolchains stop on VM 0 with `write on executable page` (VM 0 loads
  ELF segments differently; CKB-VM version 1, RFC 0033, changed the loader) or
  `invalid instruction` (a B-extension instruction, added in CKB-VM version 1).
- *"debugger refused, InvalidVmVersion(n)"*: the transaction holds a `data1`
  (n = 1) or `data2` (n = 2) script, which cannot run when the highest VM
  allowed is lower than the one it names. The session-lock benchmark's second
  input is locked by an always-success script with `data2`, so those scenarios
  run on VM 2 only. A node before that hardfork would not accept these
  transactions either.

None of these is a disagreement between tools: on the VM version the node used,
every build agrees with the node.

## What this check does not cover

- It ran on Windows (native builds for x86_64-pc-windows-msvc). The CI job in
  `.github/workflows/compat.yml` runs the same check with the Linux builds; it
  has not run on GitHub yet. The Linux tarballs were downloaded and checked
  (sha256 and contents) but not executed here.
- macOS builds are not in the manifest.
- The scenarios are frozen inputs. A future CKB-VM version would be a new
  `--script-version`, and the sweep would need it added.

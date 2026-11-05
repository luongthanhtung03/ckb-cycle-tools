# Replays across the CKB-VM hardforks

Real transactions committed just before and just after each CKB-VM hardfork,
replayed the way `ckb-cycles <tx-hash>` replays them, with the per-group sum
compared with the chain's recorded total. Asked for in the review of #46
(point 1): does the replay pick the right VM version on each side of Mirana
(CKB2021, VM v1) and Meepo (CKB2023, VM v2), and do the numbers then agree?

Made by `npm run hardfork` (scripts/hardfork-check.ts); the data is in
`compat/hardfork.json`, the mock transactions in
`test/fixtures/hardfork-mocks.json.br`, and `test/hardfork.test.ts` replays
them offline on every test run.

## What was checked

For each network (mainnet, testnet), each fork and each side, the transaction
nearest the fork's first block of each kind:

- **secp**: only the default secp256k1/blake160 lock runs (`hash_type: "type"`).
- **type**: some other `hash_type: "type"` script runs. Its VM version is the
  one of the block's epoch: this is what the replay has to get right.
- **data**: some script with `hash_type` `data`, `data1` or `data2` runs. Its
  version is named by the hash type (data v0, data1 v1, data2 v2), whatever
  the epoch, and ckb-debugger must keep it so while `--script-version` is set
  for the block.

For each one the table gives the block, epoch and the node's numbers, the
explorer's total, our sum at the version the replay chose, the version each
hash type ran on, and the result. Every transaction is also replayed with
`--script-version` forced to the two other values ("Other VMs"), which shows
whether that transaction can tell the versions apart at all: one whose sum is
the same on every version would match even if the replay chose wrongly.

The fork epochs are not hard-coded: they come from each node's
`get_consensus` (`hardfork_features`, RFC 0032 for VM v1 and RFC 0049 for v2),
the same call the replay makes, and the first block of each epoch from
`get_epoch_by_number`. A block's epoch is the low 24 bits of its header's
packed `epoch`. For a committed transaction the node selects the version from
that epoch with no proposal-window adjustment
(`TxVerifyEnv::epoch_number_without_proposal_window`, `Committed` → 0 blocks,
in ckb-script 1.2.1 `verify_env.rs`; `TxData::select_version` in `types.rs`
maps data → v0, data1 → v1, data2 → v2, type → the newest enabled).

## Findings (run of 6 Nov 2026, 24 transactions)

- **After each fork, every sum matches a node's recorded total, at the chosen
  version only.** 18 transactions (mainnet and testnet; after Mirana, before
  and after Meepo) match the cycles a node recorded for their block, exactly,
  and in each the sum at either other `--script-version` differs (or a
  data1/data2 group cannot run there). So these transactions do tell the
  versions apart, and the replay picked the one the node ran: v1 from the
  Mirana epoch on, v2 from the Meepo epoch on, including transactions within 4 to 14
  blocks of each fork's first block (mainnet 7,087,881 and 16,595,604, the
  first blocks after each fork with any transaction; testnet 3,199,684 and
  15,013,519) and within 13 blocks before Meepo on mainnet.
- **data, data1 and data2 keep their own version.** Every `data` group costs
  the same under `--script-version` 0, 1 and 2 (it runs on v0 whatever the
  flag); a `data1` group cannot run at 0 and a `data2` group at 0 or 1
  (ckb-debugger stops with `InvalidVmVersion`, as the node refuses such a
  script before its fork). So a `data` script after Mirana and a `data1` script
  after Meepo are run on their own versions, not the block's, and those
  transactions match the node too.
- **Before Mirana nothing could be checked against a node, and the explorer
  disagrees with the replay.** No node asked has cycles for blocks before each
  network's Mirana block (see below). For the 6 pre-Mirana transactions (and
  two more checked by hand at mainnet block 6,000,000, epoch 4471) the
  explorer's number equals the **v1** sum exactly, not the **v0** sum the
  replay uses for an epoch before 5414 (3113 on testnet). The difference is
  about 9,000 cycles per secp256k1 lock group (0.5%).

  The replay's v0 is what the consensus rules say: `type` scripts ran on VM
  v0 before the fork, and VM v1 did not exist in nodes before CKB2021. The
  gap is what v1 adds: ckb-script 1.2.1 runs v0 with `ISA_IMC` and v1 with
  `ISA_IMC | ISA_B | ISA_MOP` (`ScriptVersion::vm_isa`, `types.rs`), and
  macro-op fusion charges fused instruction pairs less. A node running these
  blocks before Mirana had no fusion to apply, so a v1 number for them cannot
  be what such a node charged. The most likely reading is that the explorer's
  numbers for pre-Mirana blocks were computed later with CKB2021 rules, not
  recorded when the blocks were verified; I have not found the explorer's
  code or a statement that says so. For blocks after Mirana the explorer
  agrees with the node on all 18 transactions.

  So for pre-Mirana transactions this run shows that the replay follows the
  consensus rules (v0), and that the only public total available for them
  says v1. It does not show which number a node recorded at the time. To
  settle it: a node synced from genesis with full script verification
  (`ckb run --assume-valid-target 0x0000000000000000000000000000000000000000000000000000000000000000`)
  and asked `get_block <hash> null true` for these blocks; if its `cycles`
  equal the v0 sums, the explorer is wrong for those blocks; if they equal the
  v1 sums, the replay is.

## Where the totals come from

- **https://mainnet.ckb.dev and https://testnet.ckb.dev (the replay's default
  nodes) have none of them.** For all 24 transactions `get_transaction`
  returns `"cycles": "0x0"` and `get_block` with `with_cycles = true` returns
  `0x0` for each of their blocks' transactions. A transaction with an input
  always runs at least one lock, so `0x0` is "not recorded", not zero (the
  replay already treats it so: "total unknown"). The table shows the raw
  values.
- **https://mainnet.ckbapp.dev/rpc and https://testnet.ckbapp.dev/rpc have
  them from Mirana on.** `get_block` with `with_cycles` returns the block's
  cycles on these nodes starting exactly at each network's first Mirana block
  (mainnet 7,087,867, testnet 3,199,680), and no `cycles` field at all for
  every earlier block tried (mainnet 6,000,000 and the blocks just before the
  fork; https://ckb-rpc.nervape.com answers the same). Their
  `get_transaction` returns `"cycles": null`. That is the node total used
  here; only the block's `cycles` array is read from them. Why the record
  starts at the fork I can only guess (nodes upgraded for CKB2021 recording
  cycles from then on); the numbers themselves agree with the explorer and
  with the replay wherever they exist.
- **The Nervos explorer API** (`mainnet-api.explorer.nervos.org`,
  `testnet-api.explorer.nervos.org`, `/api/v1/transactions/<hash>`) returns a
  `cycles` field for every transaction here, before Mirana too. It is the
  explorer's own record, not a consensus field anyone can recompute from the
  chain, and it is used only where no node has a number (the 6 pre-Mirana
  rows). Only that one field is read from the response.
- **`estimate_cycles` is not an oracle for these transactions.** It verifies
  a transaction as if it were sent now. Its inputs are resolved against
  today's live cell set, so a historical transaction, whose inputs are long
  spent, does not resolve at all: mainnet.ckb.dev answers
  `TransactionFailedToResolve: Unknown(OutPoint(…))` for `0x331e62b2…`, and
  `dry_run_transaction` the same. And a transaction whose cells did still exist
  would be verified at the tip's epoch, as a submitted transaction
  (`epoch_number_without_proposal_window` of the next block), so its `type`
  scripts would run on VM v2, today's rules, not the v0 or v1 its block ran
  them on. It measures a transaction under the current rules, which is what a
  replay of a pre-fork block must not do.

## Limitations

- **Pre-Mirana totals are unverified** (above): no public node asked records
  them, and the one public number disagrees with the consensus rules.
- **One transaction per kind and side, the nearest to the fork.** 24 in all,
  picked by `--discover` (secp and type within 300 blocks of the fork, data
  within 2,000; for data only transactions whose outputs carry a data* type
  script are looked at past 300 blocks, so one with only an input data* lock
  would be missed there). A scan of output type scripts in the first 4,600
  blocks after mainnet's Mirana block (7,087,867 to 7,092,467, done while
  choosing) found `data` ones only, no `data1`; so mainnet's Mirana "data"
  rows are `data` (v0) scripts, and so are testnet's; `data1` is covered before Meepo (mainnet and testnet)
  and `data2` after it (mainnet). Mainnet Meepo-before "data" is 235 blocks
  out and testnet Meepo-after "data" 396 blocks out.
- **Mainnet and testnet only**, through the nodes listed; no devnet with
  other fork epochs.
- **One ckb-debugger build per check**: native 1.1.1 for the run, the
  WebAssembly build in ckb-testtool for the offline test (it gives the same
  per-group cycles at every version, which is part of what the test checks).
- **Sums of accepted transactions only.** All 24 were committed, so every
  group accepts at the chosen version; the per-transaction node limit and
  group order (README, "What comes from where") are not exercised.
- **Explorer data is third-party.** Where it is the only number it is marked
  as such; where a node has one the explorer is only compared, not used.

<!-- Generated by scripts/hardfork-check.ts from compat/hardfork.json; the prose sections are kept by hand in this file's header. -->

## Results

Run 2026-11-05T18:31:20.371Z to 2026-11-05T18:33:06.772Z with ckb-debugger 1.1.1 at commit `8cf7f5f1d0d0`.
Nodes: https://mainnet.ckb.dev/ (mainnet), https://testnet.ckb.dev/ (testnet). Explorer API: https://mainnet-api.explorer.nervos.org/api/v1/transactions/, https://testnet-api.explorer.nervos.org/api/v1/transactions/.

24 transactions: 18 match, 6 mismatch, 0 with no total to compare.

Fork epochs, from each node's `get_consensus` (`hardfork_features`, RFC 0032 and RFC 0049), and the first block of that epoch (`get_epoch_by_number`):

| Network | Fork | Epoch | First block |
|---|---|---|---|
| mainnet | Mirana (CKB2021, VM v1) | 5414 | 7,087,867 |
| mainnet | Meepo (CKB2023, VM v2) | 12293 | 16,595,590 |
| testnet | Mirana (CKB2021, VM v1) | 3113 | 3,199,680 |
| testnet | Meepo (CKB2023, VM v2) | 9690 | 15,013,505 |

Node totals: one line per node asked, for each network first mainnet.ckb.dev / testnet.ckb.dev, then mainnet.ckbapp.dev, testnet.ckbapp.dev: `cycles` from `get_transaction` / the block's entry from `get_block` with `with_cycles`, raw (null: absent). The first non-zero one is the total compared with; with none, the explorer's. Explorer total: `cycles` from the Nervos explorer API. Our sum: the per-group cycles at the VM version the replay chose, what `ckb-cycles <hash>` prints. VM: the version each hash type ran on. Other VMs: the sum with ckb-debugger's `--script-version` forced to the other values, every group; `(=)` marks one that would also have matched, so that transaction does not tell the versions apart.

| Network | Fork | Side | Kind | Block | Epoch | Transaction | Node totals (tx / block) | Explorer total | Our sum | VM | Result | Other VMs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mainnet | mirana | before | secp | 7,087,857 | 5413 | [0x331e62b2…](https://explorer.nervos.org/transaction/0x331e62b22235a381967f924aa60c22b51081419e25e461041415406738e81c42) | `0x0` / `0x0`<br>null / null | 1,687,119 | 1,696,062 | type v0 | **mismatch** (explorer) | v1: 1,687,119 (=); v2: 1,631,886 |
| mainnet | mirana | before | type | 7,087,856 | 5413 | [0xe4832c66…](https://explorer.nervos.org/transaction/0xe4832c669935608ae4174bef8a7a4253246ff307e2bd4a8a73268a5f6363a25b) | `0x0` / `0x0`<br>null / null | 2,406,176 | 2,406,232 | type v0 | **mismatch** (explorer) | v1: 2,406,176 (=); v2: 2,344,805 |
| mainnet | mirana | before | data | 7,087,842 | 5413 | [0x963d42ee…](https://explorer.nervos.org/transaction/0x963d42eec214971680f7c018cb479bf947cf53b85ae3f9291f3a1162c4361b04) | `0x0` / `0x0`<br>null / null | 1,741,459 | 1,750,432 | type v0, data v0 | **mismatch** (explorer) | v1: 1,741,459 (=); v2: 1,686,110 |
| mainnet | mirana | after | type | 7,087,881 | 5414 | [0xdc67b70d…](https://explorer.nervos.org/transaction/0xdc67b70d0116ec320526bd8230fab86979a2c1419afb812ff15ccfe2ad2a37f2) | `0x0` / `0x0`<br>null / `0x1b7e66` | 1,801,830 | 1,801,830 | type v1 | match (node mainnet.ckbapp.dev) | v0: 1,811,009; v2: 1,745,450 |
| mainnet | mirana | after | secp | 7,087,882 | 5414 | [0x7662e654…](https://explorer.nervos.org/transaction/0x7662e6546d816b182afb68a896dd18155f548e83565d73664514ec7ee5d483c5) | `0x0` / `0x0`<br>null / `0x19c165` | 1,687,909 | 1,687,909 | type v1 | match (node mainnet.ckbapp.dev) | v0: 1,696,807; v2: 1,632,906 |
| mainnet | mirana | after | data | 7,087,885 | 5414 | [0xc38599de…](https://explorer.nervos.org/transaction/0xc38599de0cab5000f65a9d34924d5dbe9ac0cde81e1fadaaa0ec2461cbd82b33) | `0x0` / `0x0`<br>null / `0x1a9cd8` | 1,744,088 | 1,744,088 | type v1, data v0 | match (node mainnet.ckbapp.dev) | v0: 1,753,081; v2: 1,688,636 |
| mainnet | meepo | before | type | 16,595,580 | 12292 | [0xfac50edc…](https://explorer.nervos.org/transaction/0xfac50edc9daacd7ac5a95b895c86dabd668e0b632ad8344ba32114fe29a16a2d) | `0x0` / `0x0`<br>null / `0x1b5b84` | 1,792,900 | 1,792,900 | type v1 | match (node mainnet.ckbapp.dev) | v0: 1,802,004; v2: 1,736,838 |
| mainnet | meepo | before | secp | 16,595,577 | 12292 | [0x5551d4ec…](https://explorer.nervos.org/transaction/0x5551d4ecc9eea6d1da6f64b65924e4cb062876d6915635a9c14e90ba323b5133) | `0x0` / `0x0`<br>null / `0x19b9f8` | 1,686,008 | 1,686,008 | type v1 | match (node mainnet.ckbapp.dev) | v0: 1,694,946; v2: 1,630,813 |
| mainnet | meepo | before | data | 16,595,355 | 12292 | [0xbfdbaa67…](https://explorer.nervos.org/transaction/0xbfdbaa67cf40cbed33387cff6abfb92d70e3e6d8191c4ac94734f2ada032c84f) | `0x0` / `0x0`<br>null / `0x30f420` | 3,208,224 | 3,208,224 | type v1, data1 v1 | match (node mainnet.ckbapp.dev) | v0: rejects; v2: 3,117,949 |
| mainnet | meepo | after | type | 16,595,604 | 12293 | [0x5733b266…](https://explorer.nervos.org/transaction/0x5733b2665e4c6d25069741c70f1d6299e85e82865b3db7ffd6504f5175c389fe) | `0x0` / `0x0`<br>null / `0x447296` | 4,485,782 | 4,485,782 | type v2 | match (node mainnet.ckbapp.dev) | v0: rejects; v1: 4,654,882 |
| mainnet | meepo | after | secp | 16,595,604 | 12293 | [0x76174741…](https://explorer.nervos.org/transaction/0x76174741f477bc3dba21fb96c28c4fa078ae57edd34b414d96ae95bd65f6da59) | `0x0` / `0x0`<br>null / `0x18fd10` | 1,637,648 | 1,637,648 | type v2 | match (node mainnet.ckbapp.dev) | v0: 1,702,093; v1: 1,693,100 |
| mainnet | meepo | after | data | 16,595,732 | 12293 | [0x472048c8…](https://explorer.nervos.org/transaction/0x472048c894b05b4e7a126eaab46dee852f656751dbdd9aeb8099981b8bfcc7e7) | `0x0` / `0x0`<br>null / `0x18f4f6` | 1,635,574 | 1,635,574 | type v2, data2 v2 | match (node mainnet.ckbapp.dev) | v0: rejects; v1: rejects |
| testnet | mirana | before | type | 3,199,678 | 3112 | [0xb8f6f4a6…](https://testnet.explorer.nervos.org/transaction/0xb8f6f4a6b5cd6789f8bcb3b22188a4fdb6ee21de6f91162f9366c74c7ca29d37) | `0x0` / `0x0`<br>null / null | 1,807,460 | 1,816,689 | type v0 | **mismatch** (explorer) | v1: 1,807,460 (=); v2: 1,750,875 |
| testnet | mirana | before | data | 3,199,665 | 3112 | [0x5e5b117e…](https://testnet.explorer.nervos.org/transaction/0x5e5b117ecbb968d77bef32f60572383caa58cd414612824841029cd83febe79d) | `0x0` / `0x0`<br>null / null | 1,737,828 | 1,746,826 | type v0, data v0 | **mismatch** (explorer) | v1: 1,737,828 (=); v2: 1,682,366 |
| testnet | mirana | before | secp | 3,199,645 | 3112 | [0xc3860d6d…](https://testnet.explorer.nervos.org/transaction/0xc3860d6d94caffc33355ecefda501cb6c64bb08a60eaa9623c150e2b777c4e0e) | `0x0` / `0x0`<br>null / null | 1,694,060 | 1,703,013 | type v0 | **mismatch** (explorer) | v1: 1,694,060 (=); v2: 1,638,828 |
| testnet | mirana | after | type | 3,199,684 | 3113 | [0x03b7dc4d…](https://testnet.explorer.nervos.org/transaction/0x03b7dc4db375c8fdbf2287b72695c9aebf4c919ec6bac506cf599926d0d915be) | `0x0` / `0x0`<br>null / `0x444b8e` | 4,475,790 | 4,475,790 | type v1 | match (node testnet.ckbapp.dev) | v0: 4,486,338; v2: 4,417,770 |
| testnet | mirana | after | secp | 3,199,693 | 3113 | [0x01852c8d…](https://testnet.explorer.nervos.org/transaction/0x01852c8ded550d96b460a9597a4115dd2b592aa82efbc3e58ba9108fd584827c) | `0x0` / `0x0`<br>null / `0x19dbee` | 1,694,702 | 1,694,702 | type v1 | match (node testnet.ckbapp.dev) | v0: 1,703,715; v2: 1,639,189 |
| testnet | mirana | after | data | 3,199,736 | 3113 | [0x795039b5…](https://testnet.explorer.nervos.org/transaction/0x795039b5cb6f708f819905ee6719b2f27528bdef39e3592c7b6a366a37c51aed) | `0x0` / `0x0`<br>null / `0x1abe11` | 1,752,593 | 1,752,593 | type v1, data v0 | match (node testnet.ckbapp.dev) | v0: 1,761,716; v2: 1,696,594 |
| testnet | meepo | before | type | 15,013,494 | 9689 | [0xe1127000…](https://testnet.explorer.nervos.org/transaction/0xe11270003e1926cebfa4880e26a56a4a2e5d847a6b0371e03770e75bf9f3f5aa) | `0x0` / `0x0`<br>null / `0x485cb1` | 4,742,321 | 4,742,321 | type v1 | match (node testnet.ckbapp.dev) | v0: 4,760,247; v2: 4,650,585 |
| testnet | meepo | before | secp | 15,013,319 | 9689 | [0xe860e051…](https://testnet.explorer.nervos.org/transaction/0xe860e051cabe35cfe677061f2cf530577abd890d37cfd4adc813708c22cdf242) | `0x0` / `0x0`<br>null / `0x19b42d` | 1,684,525 | 1,684,525 | type v1 | match (node testnet.ckbapp.dev) | v0: 1,693,448; v2: 1,629,395 |
| testnet | meepo | before | data | 15,013,228 | 9689 | [0x5618e782…](https://testnet.explorer.nervos.org/transaction/0x5618e782ea7d3a1b68883a56bffd63cb9898f6a14a5c98ee34803d0b9e623c21) | `0x0` / `0x0`<br>null / `0x221952` | 2,234,706 | 2,234,706 | type v1, data1 v1 | match (node testnet.ckbapp.dev) | v0: rejects; v2: 2,178,683 |
| testnet | meepo | after | type | 15,013,519 | 9690 | [0xd64d6440…](https://testnet.explorer.nervos.org/transaction/0xd64d64405c01d84a6ed98f57f461936862bf0889ac457ff13b2882572d21415f) | `0x0` / `0x0`<br>null / `0x1a6f57` | 1,732,439 | 1,732,439 | type v2 | match (node testnet.ckbapp.dev) | v0: 1,797,373; v1: 1,788,309 |
| testnet | meepo | after | secp | 15,013,546 | 9690 | [0xd265f5af…](https://testnet.explorer.nervos.org/transaction/0xd265f5af8bc1023b5ed678739d8c38c0e296db48d92c08c124168473919c36c6) | `0x0` / `0x0`<br>null / `0x18d692` | 1,627,794 | 1,627,794 | type v2 | match (node testnet.ckbapp.dev) | v0: 1,691,781; v1: 1,682,873 |
| testnet | meepo | after | data | 15,013,901 | 9690 | [0xc9cc9919…](https://testnet.explorer.nervos.org/transaction/0xc9cc9919ee359424b3fc5836d64abe9f09adf66d5a781be87b661f607dfd7d6a) | `0x0` / `0x0`<br>null / `0x2dd0d5` | 3,002,581 | 3,002,581 | type v2, data1 v1 | match (node testnet.ckbapp.dev) | v0: rejects; v1: 3,057,290 |

### Groups

- `0x331e62b22235a381967f924aa60c22b51081419e25e461041415406738e81c42` (mainnet, block 7087857, epoch 5413, tx 1):
  - lock Secp256k1Blake160 (type, runs on v0): v0 1,696,062, v1 1,687,119, v2 1,631,886
- `0xe4832c669935608ae4174bef8a7a4253246ff307e2bd4a8a73268a5f6363a25b` (mainnet, block 7087856, epoch 5413, tx 1):
  - lock 0x9376c3b581194296… (type, runs on v0): v0 2,263,231, v1 2,263,223, v2 2,202,045
  - type 0xebafc1ebe95b88ca… (type, runs on v0): v0 143,001, v1 142,953, v2 142,760
- `0x963d42eec214971680f7c018cb479bf947cf53b85ae3f9291f3a1162c4361b04` (mainnet, block 7087842, epoch 5413, tx 1):
  - lock Secp256k1Blake160 (type, runs on v0): v0 1,705,855, v1 1,696,882, v2 1,641,533
  - type 0x8b9cf1c536c25902… (data, runs on v0): v0 44,577, v1 44,577, v2 44,577
- `0xdc67b70d0116ec320526bd8230fab86979a2c1419afb812ff15ccfe2ad2a37f2` (mainnet, block 7087881, epoch 5414, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,732,881, v1 1,723,698, v2 1,667,432
  - type 0x3a468d53352eb855… (type, runs on v1): v0 33,019, v1 33,021, v2 32,977
  - type 0x9e537bf5b8ec044c… (type, runs on v1): v0 45,109, v1 45,111, v2 45,041
- `0x7662e6546d816b182afb68a896dd18155f548e83565d73664514ec7ee5d483c5` (mainnet, block 7087882, epoch 5414, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,696,807, v1 1,687,909, v2 1,632,906
- `0xc38599de0cab5000f65a9d34924d5dbe9ac0cde81e1fadaaa0ec2461cbd82b33` (mainnet, block 7087885, epoch 5414, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,708,504, v1 1,699,511, v2 1,644,059
  - type 0x8b9cf1c536c25902… (data, runs on v0): v0 44,577, v1 44,577, v2 44,577
- `0xfac50edc9daacd7ac5a95b895c86dabd668e0b632ad8344ba32114fe29a16a2d` (mainnet, block 16595580, epoch 12292, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,723,876, v1 1,714,768, v2 1,658,820
  - type 0x3a468d53352eb855… (type, runs on v1): v0 33,019, v1 33,021, v2 32,977
  - type 0x9e537bf5b8ec044c… (type, runs on v1): v0 45,109, v1 45,111, v2 45,041
- `0x5551d4ecc9eea6d1da6f64b65924e4cb062876d6915635a9c14e90ba323b5133` (mainnet, block 16595577, epoch 12292, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,694,946, v1 1,686,008, v2 1,630,813
- `0xbfdbaa67cf40cbed33387cff6abfb92d70e3e6d8191c4ac94734f2ada032c84f` (mainnet, block 16595355, epoch 12292, tx 4):
  - lock OmniLock (type, runs on v1): v0 1,486,219, v1 1,480,384, v2 1,446,132
  - type XUdt (data1, runs on v1): v0 VM error, v1 18,737, v2 18,737
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,718,231, v1 1,709,103, v2 1,653,080
- `0x5733b2665e4c6d25069741c70f1d6299e85e82865b3db7ffd6504f5175c389fe` (mainnet, block 16595604, epoch 12293, tx 1):
  - lock Secp256k1Multisig (type, runs on v2): v0 4,619,331, v1 4,591,718, v2 4,422,695
  - type 0x92156e93acbad7b1… (type, runs on v2): v0 VM error, v1 63,164, v2 63,087
- `0x76174741f477bc3dba21fb96c28c4fa078ae57edd34b414d96ae95bd65f6da59` (mainnet, block 16595604, epoch 12293, tx 2):
  - lock Secp256k1Blake160 (type, runs on v2): v0 1,702,093, v1 1,693,100, v2 1,637,648
- `0x472048c894b05b4e7a126eaab46dee852f656751dbdd9aeb8099981b8bfcc7e7` (mainnet, block 16595732, epoch 12293, tx 1):
  - lock Secp256k1Blake160 (type, runs on v2): v0 1,690,690, v1 1,681,792, v2 1,626,803
  - type 0x1f591452ba058b6f… (data2, runs on v2): v0 VM error, v1 VM error, v2 8,771
- `0xb8f6f4a6b5cd6789f8bcb3b22188a4fdb6ee21de6f91162f9366c74c7ca29d37` (testnet, block 3199678, epoch 3112, tx 1):
  - lock Secp256k1Blake160 (type, runs on v0): v0 1,738,427, v1 1,729,194, v2 1,672,723
  - type 0x554cff969f3148e3… (type, runs on v0): v0 33,019, v1 33,021, v2 32,977
  - type 0x96248cdefb09eed9… (type, runs on v0): v0 45,243, v1 45,245, v2 45,175
- `0x5e5b117ecbb968d77bef32f60572383caa58cd414612824841029cd83febe79d` (testnet, block 3199665, epoch 3112, tx 1):
  - lock Secp256k1Blake160 (type, runs on v0): v0 1,702,249, v1 1,693,251, v2 1,637,789
  - type 0x8b9cf1c536c25902… (data, runs on v0): v0 44,577, v1 44,577, v2 44,577
- `0xc3860d6d94caffc33355ecefda501cb6c64bb08a60eaa9623c150e2b777c4e0e` (testnet, block 3199645, epoch 3112, tx 1):
  - lock Secp256k1Blake160 (type, runs on v0): v0 1,703,013, v1 1,694,060, v2 1,638,828
- `0x03b7dc4db375c8fdbf2287b72695c9aebf4c919ec6bac506cf599926d0d915be` (testnet, block 3199684, epoch 3113, tx 1):
  - lock 0x5447ad1c351fe85d… (type, runs on v1): v0 29,391, v1 29,393, v2 29,387
  - type 0x5c365147bb6c40e8… (type, runs on v1): v0 1,659,077, v1 1,657,756, v2 1,656,234
  - lock 0x7dc668794fa55dd8… (type, runs on v1): v0 4,427, v1 4,429, v2 4,426
  - type TypeId (type, runs on v1): v0 1,000,000, v1 1,000,000, v2 1,000,000
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,731,508, v1 1,722,275, v2 1,665,804
  - lock 0xf56d2feb9b534b5d… (type, runs on v1): v0 61,935, v1 61,937, v2 61,919
- `0x01852c8ded550d96b460a9597a4115dd2b592aa82efbc3e58ba9108fd584827c` (testnet, block 3199693, epoch 3113, tx 3):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,703,715, v1 1,694,702, v2 1,639,189
- `0x795039b5cb6f708f819905ee6719b2f27528bdef39e3592c7b6a366a37c51aed` (testnet, block 3199736, epoch 3113, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,717,139, v1 1,708,016, v2 1,652,017
  - type 0x8b9cf1c536c25902… (data, runs on v0): v0 44,577, v1 44,577, v2 44,577
- `0xe11270003e1926cebfa4880e26a56a4a2e5d847a6b0371e03770e75bf9f3f5aa` (testnet, block 15013494, epoch 9689, tx 1):
  - lock 0x79f90bb5e892d80d… (type, runs on v1): v0 1,473,442, v1 1,467,564, v2 1,433,059
  - type 0x1e44736436b406f8… (type, runs on v1): v0 1,512,692, v1 1,509,765, v2 1,508,547
  - lock 0x7f5a09b8bd0e85bc… (type, runs on v1): v0 54,940, v1 54,942, v2 54,928
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,719,173, v1 1,710,050, v2 1,654,051
- `0xe860e051cabe35cfe677061f2cf530577abd890d37cfd4adc813708c22cdf242` (testnet, block 15013319, epoch 9689, tx 1):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,693,448, v1 1,684,525, v2 1,629,395
- `0x5618e782ea7d3a1b68883a56bffd63cb9898f6a14a5c98ee34803d0b9e623c21` (testnet, block 15013228, epoch 9689, tx 3):
  - lock Secp256k1Blake160 (type, runs on v1): v0 1,770,707, v1 1,761,579, v2 1,705,556
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 116,568, v2 116,568
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 117,460, v2 117,460
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 117,977, v2 117,977
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 121,122, v2 121,122
- `0xd64d64405c01d84a6ed98f57f461936862bf0889ac457ff13b2882572d21415f` (testnet, block 15013519, epoch 9690, tx 1):
  - lock Secp256k1Blake160 (type, runs on v2): v0 1,719,245, v1 1,710,177, v2 1,654,421
  - type 0x554cff969f3148e3… (type, runs on v2): v0 33,019, v1 33,021, v2 32,977
  - type 0x96248cdefb09eed9… (type, runs on v2): v0 45,109, v1 45,111, v2 45,041
- `0xd265f5af8bc1023b5ed678739d8c38c0e296db48d92c08c124168473919c36c6` (testnet, block 15013546, epoch 9690, tx 1):
  - lock Secp256k1Blake160 (type, runs on v2): v0 1,691,781, v1 1,682,873, v2 1,627,794
- `0xc9cc9919ee359424b3fc5836d64abe9f09adf66d5a781be87b661f607dfd7d6a` (testnet, block 15013901, epoch 9690, tx 1):
  - lock Secp256k1Blake160 (type, runs on v2): v0 1,753,105, v1 1,744,277, v2 1,689,568
  - type 0x0bbe768b519d8ea7… (data1, runs on v1): v0 VM error, v1 120,928, v2 120,928
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 224,601, v2 224,601
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 231,509, v2 231,509
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 238,417, v2 238,417
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 245,325, v2 245,325
  - type 0x685a60219309029d… (data1, runs on v1): v0 VM error, v1 252,233, v2 252,233

### Reproduce

```sh
npm ci
npm run hardfork            # the recorded transactions
npm run hardfork -- --discover  # pick them again
```

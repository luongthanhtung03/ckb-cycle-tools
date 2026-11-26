# CKB mainnet cycle atlas: blocks 21080688 to 21098256

What the scripts in recent CKB mainnet transactions cost in cycles, measured per script group by replaying each transaction in ckb-debugger with [ckb-cycle-tools](../../README.md). A transaction counts only when its groups add up exactly to the cycles the node reported for it; anything else is listed under Excluded, not dropped.

## Sample

| | |
|---|---|
| Node | https://mainnet.ckb.dev/ (chain `ckb`) |
| Blocks | 21080688 to 21098256, every 12th block (1465 blocks) |
| Transactions replayed | 1002 (1465 cellbase transactions skipped: they run no scripts) |
| Matched the node exactly | 1002 |
| Excluded | 0 mismatch, 0 not recorded by the node, 0 could not be replayed |
| ckb-debugger | ckb-debugger 1.1.2, CKB-VM version 2 |
| Run | 2026-11-24T14:45:48.258Z to 2026-11-24T15:50:13.897Z, ckb-cycle-tools 78d7b8b |

Per matched transaction: median 1,727,096 cycles, p90 2,816,911, min 1,606,661, max 23,182,906; 1,910,637,701 cycles in all.

## Cost per script group

One row per script (code hash and hash type; Omnilock split by auth mode). Groups: how many times the script ran as a group, which is once per transaction for most scripts. Share: its part of all cycles in the matched transactions. Median and p90 are nearest-rank, so each is a cost that was actually measured. The example is the transaction whose group cost is closest to the median.

| Script | Role | Groups | Min | Median | p90 | Max | Share | Example |
|---|---|--:|--:|--:|--:|--:|--:|---|
| secp256k1_blake160 | lock | 1015 | 1,599,588 | 1,650,036 | 1,669,018 | 2,018,017 | 87.7% | [0x5c26d0e7…7675ff](https://explorer.nervos.org/transaction/0x5c26d0e73cc5ba64979fb35d7a0048a9c54b996a039b896a4372d50a017675ff) |
| Bitcoin SPV client (RGB++) | type | 56 | 1,184,787 | 1,462,427 | 1,636,146 | 1,733,936 | 4.2% | [0x3ea55a44…42ee2e](https://explorer.nervos.org/transaction/0x3ea55a447654b42392992a13384714e57fb124909cf1f0b46eb52800b142ee2e) |
| unknown 0xc6d28b76…76af | type | 41 | 998,367 | 1,275,391 | 1,877,188 | 2,063,197 | 3.0% | [0xbfa49caa…48c62d](https://explorer.nervos.org/transaction/0xbfa49caa455a94d89b431c503a11c62bde448a22e18a1a2e8f9eab9b6a48c62d) |
| d.id time oracle (info) | type | 804 | 45,041 | 45,174 | 45,175 | 45,175 | 1.9% | [0x3884b46b…6cb41a](https://explorer.nervos.org/transaction/0x3884b46beb0b7d10c500342052a60623c5b0eee4d45ca5b951c7e81db16cb41a) |
| JoyID | lock | 4 | 6,805,379 | 6,811,018 | 6,945,559 | 6,945,559 | 1.4% | [0x3f3eb298…0aaaaa](https://explorer.nervos.org/transaction/0x3f3eb29852631c231fbda02442952f90e3ec1caf6584f4fa96e638eb780aaaaa) |
| d.id time oracle (index state) | type | 804 | 32,975 | 32,977 | 32,977 | 32,977 | 1.4% | [0xcbfeeae0…5bee1f](https://explorer.nervos.org/transaction/0xcbfeeae0a754d404baf2f3b8bb8e07b014867086dc6f3afa421dc847af5bee1f) |
| COTA | type | 2 | 1,111,639 | 1,111,639 | 2,333,515 | 2,333,515 | 0.2% | [0x7275dd1b…f75d6b](https://explorer.nervos.org/transaction/0x7275dd1bfcbd57cc3e6b8bdfef0117bc166c186c6a3fba0c47cdef8fe1f75d6b) |
| d.id AccountCell type | type | 1 | 739,116 | 739,116 | 739,116 | 739,116 | 0.04% | [0x024c313c…a26403](https://explorer.nervos.org/transaction/0x024c313c419c345e0dd55da740f082a4d686ae352bf14494cbe5795048a26403) |
| d.id das-lock | lock | 2 | 282,271 | 282,271 | 282,271 | 282,271 | 0.03% | [0x024c313c…a26403](https://explorer.nervos.org/transaction/0x024c313c419c345e0dd55da740f082a4d686ae352bf14494cbe5795048a26403) |
| unknown 0xd96cee56…fe54 | type | 2 | 224,657 | 224,657 | 310,803 | 310,803 | 0.03% | [0x4b8125c8…628cb0](https://explorer.nervos.org/transaction/0x4b8125c8831e0d857af1b72aae829b4f154d8ebb7235951339e1965fe1628cb0) |
| d.id BalanceCell type | type | 1 | 310,938 | 310,938 | 310,938 | 310,938 | 0.02% | [0x024c313c…a26403](https://explorer.nervos.org/transaction/0x024c313c419c345e0dd55da740f082a4d686ae352bf14494cbe5795048a26403) |
| unknown 0x578e1f83…f12b | type | 2 | 97,060 | 97,060 | 101,603 | 101,603 | 0.01% | [0x0114ce59…3511b0](https://explorer.nervos.org/transaction/0x0114ce59a36c6c567aa7b8cc61f7993d6999287b0b6d00c09c55a651183511b0) |
| unknown 0x578e1f83…f12b | lock | 2 | 27,427 | 27,427 | 27,427 | 27,427 | <0.01% | [0x0114ce59…3511b0](https://explorer.nervos.org/transaction/0x0114ce59a36c6c567aa7b8cc61f7993d6999287b0b6d00c09c55a651183511b0) |
| Nervos DAO | type | 3 | 10,992 | 13,826 | 14,088 | 14,088 | <0.01% | [0x2afdaccb…abd8c3](https://explorer.nervos.org/transaction/0x2afdaccb9abfdc35b9fdadf9acca88499fded0baee4497e263b0bcb6d9abd8c3) |
| unknown 0x9f0f0ba1…71ab | lock | 2 | 636 | 636 | 636 | 636 | 0.0% | [0x7e8a2956…3ce66b](https://explorer.nervos.org/transaction/0x7e8a2956605b1ee8b8e082112f02dad4dd119540b7f02942e463f2b5943ce66b) |

Code hashes, and the cell each script's code was loaded from:

- secp256k1_blake160: `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 1
- Bitcoin SPV client (RGB++): `0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d` (type), code in [0x1dc9a535…d8a2b8](https://explorer.nervos.org/transaction/0x1dc9a53526bb7a9a4974aa6de7636014279bff996321c9acc5180912e7d8a2b8) output 0
- unknown 0xc6d28b76…76af: `0xc6d28b7694a45141c0789ec57e0628fb375e549e50f6df9786cf2ba4a32f76af` (type), code in [0xa1e6eff4…c488fb](https://explorer.nervos.org/transaction/0xa1e6eff4f3599bcdd22c168b5e7c395db1602430f3b8743adbaba0ec87c488fb) output 0
- d.id time oracle (info): `0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79` (type), code in [0x3ba4c4b6…c905a5](https://explorer.nervos.org/transaction/0x3ba4c4b6cb70fd332d0159fa1c2ce021b361b7ccfe1acf2c44ad4902b1c905a5) output 0
- JoyID: `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type), code in [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0
- d.id time oracle (index state): `0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43` (type), code in [0xae3197c3…dc61b3](https://explorer.nervos.org/transaction/0xae3197c306c0d0b36722773cff7dafcc8e312154826f876cec4bd94d24dc61b3) output 0
- COTA: `0x1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df` (type), code in [0x668921df…6837ab](https://explorer.nervos.org/transaction/0x668921df2836e5ce4b3c41c626aab1ee3ef9bccfa4b527abcf28a61b166837ab) output 1
- d.id AccountCell type: `0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918` (type), code in [0x2455f39f…cddaba](https://explorer.nervos.org/transaction/0x2455f39ff2a655e3b02f58266b1a7b7d9efc95f2d724410aff1052717acddaba) output 0
- d.id das-lock: `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type), code in [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0
- unknown 0xd96cee56…fe54: `0xd96cee56727a2bb9a21408c154d278df5095fb4b4dcfd50516156424479bfe54` (type), code in [0x0d48aa83…f55109](https://explorer.nervos.org/transaction/0x0d48aa833f97aa1c10f803c03a58e32b4184556f0ddba3137b014aa48df55109) output 0
- d.id BalanceCell type: `0xebafc1ebe95b88cac426f984ed5fce998089ecad0cd2f8b17755c9de4cb02162` (type), code in [0xd421384c…33446d](https://explorer.nervos.org/transaction/0xd421384c0f6ed1a5fcf603493fb2450f9cb0e071f7ff80e0bc05ae375d33446d) output 0
- unknown 0x578e1f83…f12b: `0x578e1f832861bc0040beaf777182f82262aa58a21ae2135f6afb0cbdfcfbf12b` (type), code in [0xee0a27d9…72cebe](https://explorer.nervos.org/transaction/0xee0a27d9ccc317c7d4014c3e6683cb2a8d335d709d5afeb02939a4909772cebe) output 0
- Nervos DAO: `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2
- unknown 0x9f0f0ba1…71ab: `0x9f0f0ba142b58cba2fe047546cfd8481d5b1769437cd3533e6458b21b61871ab` (type), code in [0x522c91d3…c59268](https://explorer.nervos.org/transaction/0x522c91d3242450fdc5ae4cc6891d566de34d6f99663679f15e96c03d01c59268) output 1

## What ran together

Matched transactions by the scripts that ran in them ("2 x" is one script running as two groups, e.g. inputs with two different owners).

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| d.id time oracle (index state) + d.id time oracle (info) + secp256k1_blake160 | 804 | 1,726,339 |
| secp256k1_blake160 | 86 | 1,646,648 |
| Bitcoin SPV client (RGB++) + secp256k1_blake160 | 56 | 3,124,683 |
| secp256k1_blake160 + unknown 0xc6d28b76…76af | 41 | 2,940,266 |
| Nervos DAO + 2 x secp256k1_blake160 | 3 | 3,296,757 |
| 2 x secp256k1_blake160 | 2 | 3,218,720 |
| COTA + JoyID | 2 | 8,057,198 |
| JoyID | 2 | 6,811,018 |
| secp256k1_blake160 + 2 x unknown 0x578e1f83…f12b | 2 | 1,761,411 |
| secp256k1_blake160 + unknown 0x9f0f0ba1…71ab + unknown 0xd96cee56…fe54 | 2 | 1,851,975 |
| 2 other combinations | 2 | |

## Excluded

None: every sampled transaction matched the node's total exactly.

## Targeted samples

A second, separate sample. The random sample above saw too few transactions of some well-known scripts to say what they cost, so for each script below the node's indexer (`get_transactions`) was asked for the most recent mainnet transactions in which that script ran, and up to 40 of them were replayed the same way, with the same check against the node's total. These transactions were picked because of the script, so they show what the script costs when it runs, not how much of mainnet it is: there are no shares here, and none of them is counted in the random sample above.

| | |
|---|---|
| Node | https://mainnet.ckb.dev/ (chain `ckb`) |
| Searched back from | block 21098603 |
| ckb-debugger | ckb-debugger 1.1.2 |
| Run | 2026-11-24T15:50:33.108Z to 2026-11-24T16:29:37.487Z, ckb-cycle-tools 78d7b8b |

Cost of the searched script per group. Found: transactions in the searched window in which the script ran; the most recent of them were replayed. Only replays that matched the node's total count toward the costs; the rest are listed under each script.

| Script | Blocks searched | Found | Replayed | Matched | Groups | Min | Median | p90 | Max |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| xUDT | 20598604 to 21098603 | 368 | 40 | 40 | 41 | 16,314 | 19,884 | 22,989 | 23,538 |
| Omnilock (Ethereum displaying) | 20998604 to 21098603 | 51 | 40 | 40 | 40 | 1,424,199 | 1,462,148 | 1,479,839 | 1,487,527 |
| Omnilock (Ethereum) | 20998604 to 21098603 | 51 | 40 | 40 | 1 | 1,462,925 | 1,462,925 | 1,462,925 | 1,462,925 |
| Omnilock, args 0x00 | 18098604 to 21098603 | 0 | 0 | 0 | 0 | | | | |
| Omnilock (Ethereum), args 0x01 | 18098604 to 21098603 | 5 | 5 | 5 | 5 | 1,446,316 | 1,461,286 | 1,464,122 | 1,464,122 |
| Omnilock (Ethereum displaying), args 0x01 | 18098604 to 21098603 | 5 | 5 | 5 | 1 | 1,465,082 | 1,465,082 | 1,465,082 | 1,465,082 |
| Omnilock (Bitcoin), args 0x04 | 20598604 to 21098603 | 145 | 40 | 40 | 40 | 1,428,731 | 1,458,571 | 1,472,092 | 1,491,766 |
| Omnilock, args 0x06 | 18098604 to 21098603 | 1 | 1 | 0 | 0 | | | | |
| Spore | 20598604 to 21098603 | 47 | 40 | 40 | 40 | 74,719 | 106,800 | 185,602 | 275,707 |
| Spore Cluster | 18598604 to 21098603 | 157 | 40 | 40 | 40 | 90,444 | 98,683 | 122,630 | 526,090 |
| ckb-dex lock | 18598604 to 21098603 | 51 | 40 | 40 | 40 | 24,209 | 24,267 | 39,032 | 58,310 |
| Type ID | 20998604 to 21098603 | 6139 | 40 | 40 | 40 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 |
| JoyID | 21078604 to 21098603 | 48 | 40 | 40 | 40 | 6,730,032 | 6,844,342 | 6,961,681 | 7,032,200 |
| RGB++ lock | 18598604 to 21098603 | 1640 | 40 | 40 | 1444 | 860,908 | 1,418,522 | 1,419,245 | 1,420,650 |
| BTC time lock (RGB++) | 18098604 to 21098603 | 17 | 17 | 9 | 9 | 764,058 | 813,924 | 959,098 | 959,098 |
| iCKB logic | 18098604 to 21098603 | 18 | 18 | 10 | 10 | 89,850 | 105,870 | 130,234 | 160,850 |
| iCKB limit order | 18598604 to 21098603 | 62 | 40 | 40 | 40 | 47,990 | 75,334 | 79,679 | 88,104 |
| iCKB owned owner | 18098604 to 21098603 | 9 | 9 | 7 | 7 | 59,145 | 72,704 | 229,155 | 229,155 |
| sUDT | 20998604 to 21098603 | 143 | 40 | 40 | 128 | 4,993 | 223,821 | 235,869 | 365,439 |
| anyone-can-pay | 18598604 to 21098603 | 47 | 40 | 40 | 40 | 33,522 | 34,106 | 1,609,984 | 1,627,021 |
| UniqueType | 18098604 to 21098603 | 3 | 3 | 0 | 0 | | | | |
| COTA | 20598604 to 21098603 | 169 | 40 | 40 | 43 | 105,068 | 1,111,738 | 2,332,930 | 2,333,515 |
| d.id das-lock | 21078604 to 21098603 | 45 | 40 | 40 | 79 | 282,271 | 282,271 | 282,271 | 338,823 |
| Nervos DAO | 20998604 to 21098603 | 182 | 40 | 40 | 40 | 9,930 | 12,037 | 14,088 | 97,014 |

### xUDT

Searched for type script `0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95` (data1) in blocks 20598604 to 21098603: 368 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| xUDT | type | 41 | 16,314 | 19,884 | 22,989 | 23,538 | [0x89fb575c…f669d1](https://explorer.nervos.org/transaction/0x89fb575c92a9545349e27ca5af1c4158a729034c1a5e91c01a30eb5590f669d1) |

Code loaded from [0xc07844ce…558ab7](https://explorer.nervos.org/transaction/0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7) output 0.

Whole transactions: median 1,838,593 cycles, p90 6,872,663, min 1,471,431, max 7,003,641. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID + xUDT | 12 | 6,852,434 |
| secp256k1_blake160 + xUDT | 5 | 1,670,793 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 4 | 1,582,867 |
| Omnilock (Ethereum displaying) + xUDT | 4 | 1,475,305 |
| secp256k1_blake160 + unknown 0x3547c9aa…060e + unknown 0x393df335…9a88 + unknown 0x7ef6e226…56f7 + unknown 0xc70a8b00…3c98 + xUDT | 4 | 2,018,831 |
| 7 other combinations | 11 | |

### Omnilock

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type) in blocks 20998604 to 21098603: 51 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Ethereum displaying) | lock | 40 | 1,424,199 | 1,462,148 | 1,479,839 | 1,487,527 | [0x5f153123…67dd2d](https://explorer.nervos.org/transaction/0x5f15312352800f5f511c1d42ae0ae04bae913f50e6ff8acff2bf48bc2b67dd2d) |
| Omnilock (Ethereum) | lock | 1 | 1,462,925 | 1,462,925 | 1,462,925 | 1,462,925 | [0xbea3aa15…d21a03](https://explorer.nervos.org/transaction/0xbea3aa15f082f658b90e76b2d3cf253ec7d189600d03a169c3cd030e8cd21a03) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,538,895 cycles, p90 1,707,305, min 1,424,199, max 2,928,007. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Ethereum displaying) | 18 | 1,462,148 |
| Omnilock (Ethereum displaying) + unknown 0x9f0f0ba1…71ab + unknown 0xd96cee56…fe54 | 16 | 1,700,596 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 1 | 1,581,730 |
| ckb-dex lock + Omnilock (Ethereum displaying) + Spore | 1 | 1,587,697 |
| iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 1 | 1,538,895 |
| 3 other combinations | 3 | |

### Omnilock, args 0x00

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x00 in blocks 18098604 to 21098603: 0 transactions ran it, 0 replayed, 0 matched the node.

No transaction in the window ran this script, so there is nothing to measure.

### Omnilock, args 0x01

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x01 in blocks 18098604 to 21098603: 5 transactions ran it, 5 replayed, 5 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Ethereum) | lock | 5 | 1,446,316 | 1,461,286 | 1,464,122 | 1,464,122 | [0x266d0ff7…898a6b](https://explorer.nervos.org/transaction/0x266d0ff753e97b5eb2cda33b9bb558261a454d05445bfe6a319b2e3654898a6b) |
| Omnilock (Ethereum displaying) | lock | 1 | 1,465,082 | 1,465,082 | 1,465,082 | 1,465,082 | [0xbea3aa15…d21a03](https://explorer.nervos.org/transaction/0xbea3aa15f082f658b90e76b2d3cf253ec7d189600d03a169c3cd030e8cd21a03) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,464,122 cycles, p90 2,928,007, min 1,451,856, max 2,928,007. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Ethereum) | 2 | 1,454,344 |
| Omnilock (Ethereum) + sUDT | 2 | 1,451,856 |
| Omnilock (Ethereum displaying) + Omnilock (Ethereum) | 1 | 2,928,007 |

### Omnilock, args 0x04

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x04 in blocks 20598604 to 21098603: 145 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Bitcoin) | lock | 40 | 1,428,731 | 1,458,571 | 1,472,092 | 1,491,766 | [0x1c973e91…c3f2c2](https://explorer.nervos.org/transaction/0x1c973e9132085f5e1d63aca69b48d4f87adcfe3de9a297df8c6fdd51d1c3f2c2) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,472,092 cycles, p90 1,490,763, min 1,428,731, max 1,509,952. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Bitcoin) + xUDT | 28 | 1,477,341 |
| Omnilock (Bitcoin) | 12 | 1,452,155 |

### Omnilock, args 0x06

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x06 in blocks 18098604 to 21098603: 1 transaction ran it, 1 replayed, 0 matched the node.

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xd08befa5…f23ae4](https://explorer.nervos.org/transaction/0xd08befa554eb0975fb4aeeaaafeb8ac93844e89181db197fd41b832bccf23ae4) | 18803955 | not-recorded | - | 3,797,340 | the node reports no cycles for this transaction |

### Spore

Searched for type script `0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5` (data1) in blocks 20598604 to 21098603: 47 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Spore | type | 40 | 74,719 | 106,800 | 185,602 | 275,707 | [0x03590634…5147a0](https://explorer.nervos.org/transaction/0x03590634cf5f7f674b801ae709696d3088b88e2f2d03092e3c264369e55147a0) |

Code loaded from [0x96b198fb…b69824](https://explorer.nervos.org/transaction/0x96b198fb5ddbd1eed57ed667068f1f1e55d07907b4c0dbd38675a69ea1b69824) output 0.

Whole transactions: median 3,709,218 cycles, p90 7,208,039, min 1,587,697, max 8,921,403. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| ckb-dex lock + JoyID + Spore | 7 | 7,008,535 |
| secp256k1_blake160 + Spore + Spore Cluster | 7 | 1,928,115 |
| secp256k1_blake160 + Spore + unknown 0xb5d13ffe…d695 | 7 | 1,911,509 |
| JoyID + Spore | 5 | 6,907,846 |
| 2 x secp256k1_blake160 + Spore + Spore Cluster | 4 | 3,693,658 |
| 5 other combinations | 10 | |

### Spore Cluster

Searched for type script `0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075` (data1) in blocks 18598604 to 21098603: 157 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Spore Cluster | type | 40 | 90,444 | 98,683 | 122,630 | 526,090 | [0xbb76eed2…a20b88](https://explorer.nervos.org/transaction/0xbb76eed228f61e394d35e9d0b8db6313e8cb8ff8ff93ccc3a74f0fc99ca20b88) |

Code loaded from [0xe464b7fb…0dc938](https://explorer.nervos.org/transaction/0xe464b7fb9311c5e2820e61c99afc615d6b98bdefbe318c34868c010cbd0dc938) output 0.

Whole transactions: median 1,942,204 cycles, p90 3,718,356, min 1,080,959, max 8,621,009. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + Spore + Spore Cluster | 28 | 1,936,955 |
| 2 x secp256k1_blake160 + Spore + Spore Cluster | 4 | 3,693,658 |
| JoyID + Spore + Spore Cluster | 4 | 7,304,845 |
| Omnilock (Bitcoin) + 4 x Spore + Spore Cluster + 2 x unknown 0x6361d4b2…6f24 | 1 | 2,309,284 |
| Omnilock (Bitcoin) + 4 x Spore + Spore Cluster + 3 x unknown 0x6361d4b2…6f24 | 1 | 2,362,154 |
| 2 other combinations | 2 | |

### ckb-dex lock

Searched for lock script `0xab0ede4350a201bd615892044ea9edf12180189572e49a7ff3f78cce179ae09f` (type) in blocks 18598604 to 21098603: 51 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| ckb-dex lock | lock | 40 | 24,209 | 24,267 | 39,032 | 58,310 | [0xf3c7f383…7a5490](https://explorer.nervos.org/transaction/0xf3c7f38364e1794e0b511cb3fead41439e5cc044d2277737787eb5dc0b7a5490) |

Code loaded from [0x36ad4eb8…01847e](https://explorer.nervos.org/transaction/0x36ad4eb856e744648e3f1faf82095fef1140d26dbb85a87141e81a2b1a01847e) output 0.

Whole transactions: median 6,934,866 cycles, p90 7,137,815, min 1,583,243, max 7,208,039. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| ckb-dex lock + JoyID + Spore | 26 | 6,998,458 |
| ckb-dex lock + JoyID + xUDT | 5 | 6,853,774 |
| ckb-dex lock + Omnilock (Ethereum displaying) + Spore | 4 | 1,587,736 |
| ckb-dex lock + JoyID + Spore (DID) | 3 | 6,896,080 |
| ckb-dex lock + Omnilock (Bitcoin) + Spore | 1 | 1,583,243 |
| 1 other combinations | 1 | |

### Type ID

Searched for type script `0x00000000000000000000000000000000000000000000000000545950455f4944` (type) in blocks 20998604 to 21098603: 6139 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Type ID | type | 40 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 | [0x99d77906…12f9de](https://explorer.nervos.org/transaction/0x99d77906390125126525fd3e905ff478fdd482aa512f2c17b387aa0cfa12f9de) |

Whole transactions: median 4,589,908 cycles, p90 4,621,238, min 2,606,332, max 4,636,426. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + Type ID + unknown 0x1c04df09…e5ac + unknown 0x45c112df…6b1d + unknown 0xa9267ff5…e981 + unknown 0xede19974…f0ba + unknown 0xff022d55…2733 | 38 | 4,593,057 |
| anyone-can-pay + Type ID | 1 | 2,606,332 |
| secp256k1_blake160 + Type ID | 1 | 2,619,427 |

### JoyID

Searched for lock script `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type) in blocks 21078604 to 21098603: 48 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| JoyID | lock | 40 | 6,730,032 | 6,844,342 | 6,961,681 | 7,032,200 | [0x3e55d80e…f18b10](https://explorer.nervos.org/transaction/0x3e55d80ea5a92f3589bdceeb49cf6506d3a1aecde46e96e15a6a3cf684f18b10) |

Code loaded from [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0.

Whole transactions: median 6,897,126 cycles, p90 7,197,961, min 6,744,915, max 9,146,555. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID | 24 | 6,837,100 |
| JoyID + 2 x unknown 0x578e1f83…f12b | 7 | 7,019,288 |
| COTA + JoyID | 3 | 9,138,894 |
| JoyID + unknown 0x9f0f0ba1…71ab + unknown 0xd96cee56…fe54 | 3 | 6,897,126 |
| JoyID + unknown 0x578e1f83…f12b | 2 | 6,956,633 |
| 1 other combinations | 1 | |

### RGB++ lock

Searched for lock script `0xbc6c568a1a0d0a09f6844dc9d74ddb4343c32143ff25f727c59edf4fb72d6936` (type) in blocks 18598604 to 21098603: 1640 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| RGB++ lock | lock | 1444 | 860,908 | 1,418,522 | 1,419,245 | 1,420,650 | [0xbb671fd8…8a0367](https://explorer.nervos.org/transaction/0xbb671fd8a4bfed146c6f001c94ba208d7da49734c5badeda1a6318ef648a0367) |

Code loaded from [0xcb4d9f97…e82a63](https://explorer.nervos.org/transaction/0xcb4d9f9726e66306bfda6359d39d3bea8b4e5345d0f95f26a3e51626ebe82a63) output 0.

Whole transactions: median 56,950,188 cycles, p90 56,950,233, min 959,959, max 57,013,989. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| 40 x RGB++ lock + 3 x xUDT | 21 | 56,950,233 |
| 40 x RGB++ lock + 2 x xUDT | 14 | 56,899,698 |
| RGB++ lock + Spore | 3 | 1,008,839 |
| 40 x RGB++ lock + 4 x xUDT | 1 | 57,013,989 |
| RGB++ lock + Spore Cluster | 1 | 1,080,959 |

### BTC time lock (RGB++)

Searched for lock script `0x70d64497a075bd651e98ac030455ea200637ee325a12ad08aff03f1a117e5a62` (type) in blocks 18098604 to 21098603: 17 transactions ran it, 17 replayed, 9 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| BTC time lock (RGB++) | lock | 9 | 764,058 | 813,924 | 959,098 | 959,098 | [0x861fc59b…2fda1b](https://explorer.nervos.org/transaction/0x861fc59b16c497b310a2b53a58f1e9c256f600d0ead46046aeb0ad5fc12fda1b) |

Code loaded from [0x3d1c26b9…d08b9b](https://explorer.nervos.org/transaction/0x3d1c26b966504b09253ad84173bf3baa7b8135c5ff520c32cf70b631c1d08b9b) output 0.

Whole transactions: median 2,523,150 cycles, p90 2,735,632, min 2,420,601, max 2,735,632. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| BTC time lock (RGB++) + secp256k1_blake160 + Spore | 3 | 2,717,170 |
| BTC time lock (RGB++) + secp256k1_blake160 + USDI (xUDT compatible) | 3 | 2,601,536 |
| BTC time lock (RGB++) + secp256k1_blake160 + xUDT | 3 | 2,473,387 |

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xa803c7e0…161685](https://explorer.nervos.org/transaction/0xa803c7e0bbabbc35ae7838845d377412fd8568adf059b5abec4d50cf53161685) | 18618092 | not-recorded | - | 2,585,785 | the node reports no cycles for this transaction |
| [0xbbde4204…afe87e](https://explorer.nervos.org/transaction/0xbbde420497914f9a38a0c1bb701a566e81640bff30fcd7f8d47f360434afe87e) | 18617166 | not-recorded | - | 2,646,232 | the node reports no cycles for this transaction |
| [0x88739e65…063413](https://explorer.nervos.org/transaction/0x88739e653cbaf29a0fa3fc510c4c7e4ac41e9efd82b6ac0871b94c3c68063413) | 18469641 | not-recorded | - | 2,509,437 | the node reports no cycles for this transaction |
| [0x0e4b4ab2…19c3db](https://explorer.nervos.org/transaction/0x0e4b4ab23457cf5d31bc44ce8a2902239050cb2b36dfe1f8185eac2e9519c3db) | 18424522 | not-recorded | - | 2,458,522 | the node reports no cycles for this transaction |
| [0x41fa05ae…7929c7](https://explorer.nervos.org/transaction/0x41fa05aeac3f30078efe3b02bb2e6e86a75e7623baf28b74cef93ffd677929c7) | 18187302 | not-recorded | - | 2,543,466 | the node reports no cycles for this transaction |
| [0x5d93f109…1eaf9d](https://explorer.nervos.org/transaction/0x5d93f109316189928c6a80b79cc9326a86cfa2cf1852324d4b6c9e2b821eaf9d) | 18144932 | not-recorded | - | 2,457,264 | the node reports no cycles for this transaction |
| [0x1b92a08a…18b2b8](https://explorer.nervos.org/transaction/0x1b92a08ae5f5a6edae0e1d61248f11dc46404041f678840b8b895e742318b2b8) | 18135516 | not-recorded | - | 2,490,841 | the node reports no cycles for this transaction |
| [0x617b465e…998000](https://explorer.nervos.org/transaction/0x617b465e0de87b27b4497318ef3304f9537becafa29440ac10dedda30e998000) | 18135227 | not-recorded | - | 2,469,718 | the node reports no cycles for this transaction |

### iCKB logic

Searched for type script `0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3` (data1) in blocks 18098604 to 21098603: 18 transactions ran it, 18 replayed, 10 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| iCKB logic | type | 10 | 89,850 | 105,870 | 130,234 | 160,850 | [0x814c44c4…5c0dbc](https://explorer.nervos.org/transaction/0x814c44c45e33a496dc30f18131e01bf4b72282be58abd7f0fefff9a95b5c0dbc) |

Code loaded from [0xd7309191…dc8f44](https://explorer.nervos.org/transaction/0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44) output 0.

Whole transactions: median 7,106,075 cycles, p90 7,244,662, min 1,831,419, max 7,299,002. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| 2 x iCKB limit order + iCKB logic + JoyID + xUDT | 3 | 7,135,255 |
| iCKB limit order + iCKB logic + JoyID + Nervos DAO + xUDT | 2 | 7,228,651 |
| iCKB limit order + iCKB logic + Nervos DAO + secp256k1_blake160 + xUDT | 2 | 1,868,817 |
| iCKB limit order + iCKB logic + secp256k1_blake160 + xUDT | 2 | 1,831,419 |
| iCKB limit order + iCKB logic + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,299,002 |

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xffc7efb7…085bad](https://explorer.nervos.org/transaction/0xffc7efb7da964cf35d8e1223ba7946d4f300db1f82aa87fd4cce0881b8085bad) | 19011137 | not-recorded | - | 7,035,025 | the node reports no cycles for this transaction |
| [0xdc92e6a3…a619c5](https://explorer.nervos.org/transaction/0xdc92e6a30c09e2c537742490cc687528d026e83064b1b654f037598d2ba619c5) | 19011124 | not-recorded | - | 7,291,949 | the node reports no cycles for this transaction |
| [0x4472915f…d3af8f](https://explorer.nervos.org/transaction/0x4472915f75bb991221c620ddde53bdcd9f5529600ec2a001ca4b709989d3af8f) | 19011095 | not-recorded | - | 7,071,608 | the node reports no cycles for this transaction |
| [0xd246f23a…5e77c5](https://explorer.nervos.org/transaction/0xd246f23a1648dc82da7dd0aba019f94f89deff1d2880901a77a6e934845e77c5) | 19006460 | not-recorded | - | 6,937,913 | the node reports no cycles for this transaction |
| [0x1a9ff445…8efd91](https://explorer.nervos.org/transaction/0x1a9ff445a98ea8fceb587c43c8fa381036d8f270140df27e29cf4a60e18efd91) | 18732458 | not-recorded | - | 7,077,963 | the node reports no cycles for this transaction |
| [0xcd690c00…c1e372](https://explorer.nervos.org/transaction/0xcd690c00dedc8146b09f111da6f113763c344ac593b406af1bdf87f2d7c1e372) | 18732308 | not-recorded | - | 1,837,208 | the node reports no cycles for this transaction |
| [0x5f6d0d5b…8917ba](https://explorer.nervos.org/transaction/0x5f6d0d5b3a9ca17522b6a4e904c976ec09ae3cd943a9972145d3f249e88917ba) | 18732304 | not-recorded | - | 2,063,404 | the node reports no cycles for this transaction |
| [0xf8aed34a…b22170](https://explorer.nervos.org/transaction/0xf8aed34a7b086cc50b92bbb292045da54473d1c5e50b0937788f6b84adb22170) | 18732299 | not-recorded | - | 7,001,145 | the node reports no cycles for this transaction |

### iCKB limit order

Searched for lock script `0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a` (data1) in blocks 18598604 to 21098603: 62 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| iCKB limit order | lock | 40 | 47,990 | 75,334 | 79,679 | 88,104 | [0xfc8b45bd…0d8d4c](https://explorer.nervos.org/transaction/0xfc8b45bdc0cc98d7474d0c95d29393eeba4c99fb412cb5a0d201c756150d8d4c) |

Code loaded from [0xd7309191…dc8f44](https://explorer.nervos.org/transaction/0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44) output 1.

Whole transactions: median 1,745,736 cycles, p90 6,976,823, min 1,581,730, max 7,168,979. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| iCKB limit order + secp256k1_blake160 + xUDT | 16 | 1,738,140 |
| 2 x iCKB limit order + JoyID + xUDT | 11 | 6,948,411 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 6 | 1,586,021 |
| iCKB limit order + 2 x iCKB owned owner + Nervos DAO + secp256k1_blake160 + xUDT | 3 | 1,894,882 |
| 2 x iCKB limit order + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,168,979 |
| 3 other combinations | 3 | |

### iCKB owned owner

Searched for lock script `0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0` (data1) in blocks 18098604 to 21098603: 9 transactions ran it, 9 replayed, 7 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| iCKB owned owner | lock | 7 | 59,145 | 72,704 | 229,155 | 229,155 | [0x906bfa24…4b9308](https://explorer.nervos.org/transaction/0x906bfa2474535b6cb53cf0c3af363bb61eee675b038bbf9e3be79c06d34b9308) |

Code loaded from [0xd7309191…dc8f44](https://explorer.nervos.org/transaction/0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44) output 2.

Whole transactions: median 7,168,979 cycles, p90 8,064,887, min 1,866,221, max 8,064,887. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| iCKB limit order + 2 x iCKB owned owner + Nervos DAO + secp256k1_blake160 + xUDT | 3 | 1,894,882 |
| 2 x iCKB limit order + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,168,979 |
| 2 x iCKB limit order + iCKB logic + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 8,064,887 |
| iCKB limit order + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,307,827 |
| iCKB limit order + iCKB logic + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,299,002 |

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xb866945c…576b07](https://explorer.nervos.org/transaction/0xb866945c810a90eea0a000beb18cb64b5a3b3e29dec5f40550786872e2576b07) | 19011105 | not-recorded | - | 1,858,184 | the node reports no cycles for this transaction |
| [0x5f6d0d5b…8917ba](https://explorer.nervos.org/transaction/0x5f6d0d5b3a9ca17522b6a4e904c976ec09ae3cd943a9972145d3f249e88917ba) | 18732304 | not-recorded | - | 2,063,404 | the node reports no cycles for this transaction |

### sUDT

Searched for type script `0x5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5` (type) in blocks 20998604 to 21098603: 143 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| sUDT | type | 128 | 4,993 | 223,821 | 235,869 | 365,439 | [0xa9d04cd6…0d4888](https://explorer.nervos.org/transaction/0xa9d04cd681724f732323b2e6424e0b9233b4598fa4c23e711ac76db76f0d4888) |

Code loaded from [0xc7813f6a…9936d5](https://explorer.nervos.org/transaction/0xc7813f6a415144643970c2e88e0bb6ca6a8edc5dd7c1022746f628284a9936d5) output 0.

Whole transactions: median 17,232,450 cycles, p90 34,264,694, min 1,451,856, max 36,582,365. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + sUDT + Type ID + unknown 0x1c04df09…e5ac + unknown 0x45c112df…6b1d + unknown 0xa9267ff5…e981 + unknown 0xede19974…f0ba + unknown 0xff022d55…2733 | 17 | 4,806,334 |
| secp256k1_blake160 + 4 x sUDT + 400 x unknown 0xf1717ee3…2fed | 5 | 34,029,141 |
| secp256k1_blake160 + 3 x sUDT + 400 x unknown 0xf1717ee3…2fed | 4 | 33,797,169 |
| secp256k1_blake160 + 5 x sUDT + 400 x unknown 0xf1717ee3…2fed | 3 | 34,234,111 |
| Omnilock (Ethereum) + sUDT | 2 | 1,451,856 |
| 9 other combinations | 9 | |

### anyone-can-pay

Searched for lock script `0xd369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354` (type) in blocks 18598604 to 21098603: 47 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| anyone-can-pay | lock | 40 | 33,522 | 34,106 | 1,609,984 | 1,627,021 | [0x71f2e638…8b2e4f](https://explorer.nervos.org/transaction/0x71f2e6385148a413fb8a59e71eefb5dd19f6ed10c1271b9615a5b60b548b2e4f) |

Code loaded from [0x58eb58e2…6d6876](https://explorer.nervos.org/transaction/0x58eb58e2e3dd9852099a19424cf6e63b5238afe92e3085561b8feafced6d6876) output 0.

Whole transactions: median 6,820,707 cycles, p90 6,946,865, min 1,674,600, max 7,078,163. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| anyone-can-pay + JoyID + xUDT | 18 | 6,899,510 |
| anyone-can-pay + secp256k1_blake160 + xUDT | 15 | 3,240,813 |
| anyone-can-pay + JoyID | 5 | 6,992,933 |
| anyone-can-pay + Type ID | 2 | 2,606,208 |

### UniqueType

Searched for type script `0x2c8c11c985da60b0a330c61a85507416d6382c130ba67f0c47ab071e00aec628` (data1) in blocks 18098604 to 21098603: 3 transactions ran it, 3 replayed, 0 matched the node.

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xa1a96c2f…a4143c](https://explorer.nervos.org/transaction/0xa1a96c2f2f540b824fb767de0b059a6226327e13545370cea89b1683dba4143c) | 18660178 | not-recorded | - | 2,725,209 | the node reports no cycles for this transaction |
| [0x21737131…e00582](https://explorer.nervos.org/transaction/0x217371316e8abdc73a35cbbce27a9723efc75b58a8126bfba68ae4ea3ae00582) | 18636357 | not-recorded | - | 7,804,984 | the node reports no cycles for this transaction |
| [0x1ff16c40…33a37b](https://explorer.nervos.org/transaction/0x1ff16c40ab8cf8517960da69379d0b22655f13fae970c67cfa41ffc9fc33a37b) | 18635246 | not-recorded | - | 7,935,791 | the node reports no cycles for this transaction |

### COTA

Searched for type script `0x1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df` (type) in blocks 20598604 to 21098603: 169 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| COTA | type | 43 | 105,068 | 1,111,738 | 2,332,930 | 2,333,515 | [0x7600f453…326c49](https://explorer.nervos.org/transaction/0x7600f45351779c0f2a421484d81922655559e7503892bd9b212116c80b326c49) |

Code loaded from [0x668921df…6837ab](https://explorer.nervos.org/transaction/0x668921df2836e5ce4b3c41c626aab1ee3ef9bccfa4b527abcf28a61b166837ab) output 1.

Whole transactions: median 8,155,980 cycles, p90 9,347,136, min 2,318,897, max 9,405,821. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| COTA + JoyID | 24 | 9,244,319 |
| COTA + secp256k1_blake160 + unknown 0x90ca618b…9ac7 + unknown 0xd4839251…35f6 | 13 | 2,357,014 |
| 2 x COTA + secp256k1_blake160 + unknown 0x90ca618b…9ac7 + unknown 0xd4839251…35f6 | 3 | 2,910,580 |

### d.id das-lock

Searched for lock script `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type) in blocks 21078604 to 21098603: 45 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| d.id das-lock | lock | 79 | 282,271 | 282,271 | 282,271 | 338,823 | [0xdb36ec07…a9415f](https://explorer.nervos.org/transaction/0xdb36ec07ae53025a7d732aa0daad539aad4efedcc27d71f03bd7ffa246a9415f) |

Code loaded from [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0.

Whole transactions: median 1,636,396 cycles, p90 1,770,653, min 1,346,963, max 2,127,790. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| d.id AccountCell type + d.id BalanceCell type + 2 x d.id das-lock | 38 | 1,636,396 |
| d.id AccountCell type + d.id BalanceCell type + 2 x d.id das-lock + unknown 0x303ead37…3078 + unknown 0x63516de8…f4b4 | 1 | 2,127,790 |
| d.id AccountCell type + d.id BalanceCell type + d.id das-lock | 1 | 1,346,963 |

### Nervos DAO

Searched for type script `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type) in blocks 20998604 to 21098603: 182 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Nervos DAO | type | 40 | 9,930 | 12,037 | 14,088 | 97,014 | [0x974c52a1…c5872d](https://explorer.nervos.org/transaction/0x974c52a1563750afafa1fe33970dbbcbca9d8cc7c9b71b1de6473504c0c5872d) |

Code loaded from [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2.

Whole transactions: median 3,261,029 cycles, p90 3,368,155, min 1,641,854, max 6,814,746. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Nervos DAO + 2 x secp256k1_blake160 | 19 | 3,301,506 |
| Nervos DAO + secp256k1_blake160 | 13 | 1,651,852 |
| JoyID + Nervos DAO | 3 | 6,791,945 |
| Nervos DAO + PWLock | 3 | 1,760,106 |
| iCKB limit order + iCKB logic + Nervos DAO + secp256k1_blake160 + xUDT | 1 | 1,872,537 |
| 1 other combinations | 1 | |

## Method and limits

- Each transaction is rebuilt as a ckb-debugger mock transaction from the node (input cells, cell deps with dep groups expanded, header deps), then every script group runs once in the native ckb-debugger, on the CKB-VM version of the transaction's epoch. Type ID is verified natively by the node and charged its fixed 1,000,000 cycles, as the node does.
- The sample is every non-cellbase transaction in a window of recent blocks, so it reflects what was busy on mainnet in that window, not all of mainnet history. A different window will give different shares.
- Names come from CCC's mainnet table of known scripts, plus a short table in scripts/atlas-lib.ts of scripts whose code hash is published elsewhere (Spore and Cluster from @ckb-ccc/spore; d.id, RGB++, iCKB and ckb-dex from their own repositories, each with its source). Scripts in neither show as unknown with their code hash; Omnilock's mode is read from the first byte of its args.
- A targeted sample is the most recent transactions in which one script ran (a lock only counts where it guards an input, since an output's lock does not run), found with the indexer RPC in a window that widens until enough are found. Busy scripts are searched one first args byte at a time, which finds the same transactions in smaller requests.
- The raw per-transaction results are in data.json next to this file.

## Reproduce

```
npm ci
npm run atlas -- --rpc https://mainnet.ckb.dev/ --to 21098256 --blocks 17569 --stride 12 --max-txs 1002
```

The targeted samples, into the same folder:

```
npm run atlas -- --out atlas/2026-11-24 --rpc https://mainnet.ckb.dev/ --to 21098603 --max-txs 40 --max-window 3000000 \
  --script xudt --script omnilock --script omnilock@0x00 --script omnilock@0x01 --script omnilock@0x04 --script omnilock@0x06 --script spore --script cluster --script dex-lock --script type-id --script joyid --script rgbpp-lock --script btc-time-lock --script ickb-logic --script ickb-limit-order --script ickb-owned-owner --script sudt --script acp --script unique-type --script cota --script das-lock --script dao
```

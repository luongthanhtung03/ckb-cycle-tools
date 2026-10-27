# CKB mainnet cycle atlas: blocks 20835876 to 20851152

What the scripts in recent CKB mainnet transactions cost in cycles, measured per script group by replaying each transaction in ckb-debugger with [ckb-cycle-tools](../../README.md). A transaction counts only when its groups add up exactly to the cycles the node reported for it; anything else is listed under Excluded, not dropped.

## Sample

| | |
|---|---|
| Node | https://mainnet.ckb.dev/ (chain `ckb`) |
| Blocks | 20835876 to 20851152, every 12th block (1274 blocks) |
| Transactions replayed | 1000 (1274 cellbase transactions skipped: they run no scripts) |
| Matched the node exactly | 1000 |
| Excluded | 0 mismatch, 0 not recorded by the node, 0 could not be replayed |
| ckb-debugger | ckb-debugger 1.1.1, CKB-VM version 2 |
| Run | 2026-10-27T18:32:30.915Z to 2026-10-27T18:57:13.791Z, ckb-cycle-tools 95ec839 |

Per matched transaction: median 1,722,123 cycles, p90 1,745,654, min 876,106, max 111,979,599; 1,925,836,126 cycles in all.

## Cost per script group

One row per script (code hash and hash type; Omnilock split by auth mode). Groups: how many times the script ran as a group, which is once per transaction for most scripts. Share: its part of all cycles in the matched transactions. Median and p90 are nearest-rank, so each is a cost that was actually measured. The example is the transaction whose group cost is closest to the median.

| Script | Role | Groups | Min | Median | p90 | Max | Share | Example |
|---|---|--:|--:|--:|--:|--:|--:|---|
| secp256k1_blake160 | lock | 1095 | 1,596,322 | 1,647,788 | 1,666,559 | 2,316,419 | 93.7% | [0x752c6e76…152c52](https://explorer.nervos.org/transaction/0x752c6e7674068958fa514ef24bec53957d7746874cb7fc5e2fb8d21b27152c52) |
| Bitcoin SPV client (RGB++) | type | 43 | 1,091,750 | 1,369,197 | 1,464,612 | 1,644,286 | 3.1% | [0x3e550def…7de025](https://explorer.nervos.org/transaction/0x3e550def34726ecbf7d4522d2cb7b5f5ba9b08b42ab41962552ba192817de025) |
| d.id time oracle (info) | type | 694 | 45,041 | 45,174 | 45,175 | 45,175 | 1.6% | [0xca5c6a8f…7f1992](https://explorer.nervos.org/transaction/0xca5c6a8f682a3fb93dd16251e1b0cd9bc3b47b8461d8919637af02032c7f1992) |
| d.id time oracle (index state) | type | 694 | 32,975 | 32,977 | 32,977 | 32,977 | 1.2% | [0xb57da046…cb6c18](https://explorer.nervos.org/transaction/0xb57da046cb5b3122b99224e62652040ac74b0b8d63c94372afc8bdefe3cb6c18) |
| JoyID | lock | 1 | 6,823,163 | 6,823,163 | 6,823,163 | 6,823,163 | 0.4% | [0xb84acdcb…6b9fc4](https://explorer.nervos.org/transaction/0xb84acdcb169564aea46c2623544bef728bed094fc8079c1ffb54d6bf746b9fc4) |
| d.id AccountCell type | type | 1 | 586,648 | 586,648 | 586,648 | 586,648 | 0.03% | [0x24fc5c8d…17d00f](https://explorer.nervos.org/transaction/0x24fc5c8d9928eb75726e39b3374aa0300f0d81c20bc5c147f2cfbe85eb17d00f) |
| d.id das-lock | lock | 1 | 289,458 | 289,458 | 289,458 | 289,458 | 0.01% | [0x24fc5c8d…17d00f](https://explorer.nervos.org/transaction/0x24fc5c8d9928eb75726e39b3374aa0300f0d81c20bc5c147f2cfbe85eb17d00f) |
| Nervos DAO | type | 3 | 13,116 | 13,826 | 14,888 | 14,888 | <0.01% | [0xaebfaecd…a353e2](https://explorer.nervos.org/transaction/0xaebfaecd502136c6d567dcd22d1d01ad8fd08c61285410882c00fd4cdba353e2) |

Code hashes, and the cell each script's code was loaded from:

- secp256k1_blake160: `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 1
- Bitcoin SPV client (RGB++): `0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d` (type), code in [0x1dc9a535…d8a2b8](https://explorer.nervos.org/transaction/0x1dc9a53526bb7a9a4974aa6de7636014279bff996321c9acc5180912e7d8a2b8) output 0
- d.id time oracle (info): `0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79` (type), code in [0x3ba4c4b6…c905a5](https://explorer.nervos.org/transaction/0x3ba4c4b6cb70fd332d0159fa1c2ce021b361b7ccfe1acf2c44ad4902b1c905a5) output 0
- d.id time oracle (index state): `0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43` (type), code in [0xae3197c3…dc61b3](https://explorer.nervos.org/transaction/0xae3197c306c0d0b36722773cff7dafcc8e312154826f876cec4bd94d24dc61b3) output 0
- JoyID: `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type), code in [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0
- d.id AccountCell type: `0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918` (type), code in [0x2455f39f…cddaba](https://explorer.nervos.org/transaction/0x2455f39ff2a655e3b02f58266b1a7b7d9efc95f2d724410aff1052717acddaba) output 0
- d.id das-lock: `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type), code in [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0
- Nervos DAO: `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2

## What ran together

Matched transactions by the scripts that ran in them ("2 x" is one script running as two groups, e.g. inputs with two different owners).

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| d.id time oracle (index state) + d.id time oracle (info) + secp256k1_blake160 | 694 | 1,726,243 |
| secp256k1_blake160 | 251 | 1,641,528 |
| Bitcoin SPV client (RGB++) + secp256k1_blake160 | 43 | 3,041,047 |
| 2 x secp256k1_blake160 | 2 | 3,293,122 |
| 9 x secp256k1_blake160 | 2 | 14,720,839 |
| Nervos DAO + 2 x secp256k1_blake160 | 2 | 3,290,960 |
| 5 x secp256k1_blake160 | 1 | 8,219,754 |
| 68 x secp256k1_blake160 | 1 | 111,979,599 |
| 7 x secp256k1_blake160 | 1 | 11,568,395 |
| d.id AccountCell type + d.id das-lock | 1 | 876,106 |
| 2 other combinations | 2 | |

## Excluded

None: every sampled transaction matched the node's total exactly.

## Targeted samples

A second, separate sample. The random sample above saw too few transactions of some well-known scripts to say what they cost, so for each script below the node's indexer (`get_transactions`) was asked for the most recent mainnet transactions in which that script ran, and up to 40 of them were replayed the same way, with the same check against the node's total. These transactions were picked because of the script, so they show what the script costs when it runs, not how much of mainnet it is: there are no shares here, and none of them is counted in the random sample above.

| | |
|---|---|
| Node | https://mainnet.ckb.dev/ (chain `ckb`) |
| Searched back from | block 20851579 |
| ckb-debugger | ckb-debugger 1.1.1 |
| Run | 2026-10-27T19:50:45.376Z to 2026-10-27T20:01:44.427Z, ckb-cycle-tools de000ef |

Cost of the searched script per group. Found: transactions in the searched window in which the script ran; the most recent of them were replayed. Only replays that matched the node's total count toward the costs; the rest are listed under each script.

| Script | Blocks searched | Found | Replayed | Matched | Groups | Min | Median | p90 | Max |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| xUDT | 20351580 to 20851579 | 843 | 40 | 40 | 41 | 17,032 | 20,498 | 20,717 | 23,547 |
| Omnilock (Ethereum displaying) | 20351580 to 20851579 | 628 | 40 | 40 | 39 | 1,432,881 | 1,458,708 | 1,482,697 | 1,500,503 |
| Omnilock (Ethereum) | 20351580 to 20851579 | 628 | 40 | 40 | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 |
| Omnilock, args 0x00 | 17851580 to 20851579 | 0 | 0 | 0 | 0 | | | | |
| Omnilock (Ethereum), args 0x01 | 17851580 to 20851579 | 1 | 1 | 1 | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 |
| Omnilock (Bitcoin), args 0x04 | 20351580 to 20851579 | 427 | 40 | 40 | 40 | 1,428,731 | 1,458,571 | 1,472,092 | 1,491,766 |
| Omnilock, args 0x06 | 17851580 to 20851579 | 1 | 1 | 0 | 0 | | | | |
| Spore | 20351580 to 20851579 | 68 | 40 | 40 | 43 | 76,964 | 103,953 | 272,482 | 296,865 |
| Spore Cluster | 18351580 to 20851579 | 162 | 40 | 40 | 40 | 94,555 | 98,683 | 111,471 | 526,090 |
| ckb-dex lock | 18351580 to 20851579 | 54 | 40 | 38 | 38 | 24,209 | 24,209 | 39,032 | 58,310 |
| Type ID | 18351580 to 20851579 | 3960 | 40 | 40 | 42 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 |
| JoyID | 20751580 to 20851579 | 189 | 40 | 40 | 40 | 6,650,867 | 6,844,452 | 7,064,184 | 7,138,538 |
| RGB++ lock | 18351580 to 20851579 | 1644 | 40 | 40 | 1444 | 860,908 | 1,418,522 | 1,419,245 | 1,420,650 |
| BTC time lock (RGB++) | 17851580 to 20851579 | 23 | 23 | 9 | 9 | 764,058 | 813,924 | 959,098 | 959,098 |
| iCKB logic | 17851580 to 20851579 | 16 | 16 | 8 | 8 | 89,850 | 105,870 | 160,850 | 160,850 |
| iCKB limit order | 18351580 to 20851579 | 58 | 40 | 40 | 40 | 47,990 | 75,304 | 79,679 | 162,596 |
| iCKB owned owner | 17851580 to 20851579 | 9 | 9 | 7 | 7 | 59,145 | 72,704 | 229,155 | 229,155 |
| sUDT | 17851580 to 20851579 | 241 | 40 | 18 | 18 | 2,710 | 2,710 | 32,871 | 32,871 |
| anyone-can-pay | 18351580 to 20851579 | 44 | 40 | 40 | 40 | 33,522 | 34,106 | 1,609,984 | 1,627,021 |
| UniqueType | 17851580 to 20851579 | 3 | 3 | 0 | 0 | | | | |
| COTA | 20351580 to 20851579 | 97 | 40 | 40 | 40 | 105,068 | 1,134,820 | 2,332,914 | 2,333,515 |
| d.id das-lock | 20751580 to 20851579 | 45 | 40 | 40 | 62 | 282,271 | 282,271 | 354,217 | 4,435,773 |
| Nervos DAO | 20751580 to 20851579 | 374 | 40 | 40 | 40 | 9,930 | 13,826 | 14,888 | 14,888 |

### xUDT

Searched for type script `0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95` (data1) in blocks 20351580 to 20851579: 843 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| xUDT | type | 41 | 17,032 | 20,498 | 20,717 | 23,547 | [0x3201634c…a34619](https://explorer.nervos.org/transaction/0x3201634c14787a60248703f7e51d338d675d38c17341307662565e83aca34619) |

Code loaded from [0xc07844ce…558ab7](https://explorer.nervos.org/transaction/0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7) output 0.

Whole transactions: median 2,054,422 cycles, p90 6,878,075, min 1,537,611, max 7,068,209. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID + xUDT | 17 | 6,854,672 |
| secp256k1_blake160 + unknown 0x3547c9aa…060e + unknown 0x393df335…9a88 + unknown 0x7ef6e226…56f7 + unknown 0xc70a8b00…3c98 + xUDT | 15 | 2,030,258 |
| secp256k1_blake160 + xUDT | 3 | 1,670,793 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 1 | 1,586,203 |
| iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 1 | 1,537,611 |
| 3 other combinations | 3 | |

### Omnilock

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type) in blocks 20351580 to 20851579: 628 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Ethereum displaying) | lock | 39 | 1,432,881 | 1,458,708 | 1,482,697 | 1,500,503 | [0x49fdc377…0908ac](https://explorer.nervos.org/transaction/0x49fdc37725a1946cf500b34a6a1734b47afe8f38de078daf2951528b070908ac) |
| Omnilock (Ethereum) | lock | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 | [0xe17b6766…d1d530](https://explorer.nervos.org/transaction/0xe17b6766c514d58542eac2b2d1bdd7f3b18f8b5b330e86748a0d69c49fd1d530) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,569,220 cycles, p90 4,920,995, min 1,447,880, max 13,611,814. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Ethereum displaying) + Spore (DID) | 13 | 1,569,220 |
| Nervos DAO + Omnilock (Ethereum displaying) | 6 | 1,467,510 |
| Omnilock (Ethereum displaying) | 5 | 1,450,242 |
| d.id AccountCell type + d.id das-lock + d.id IncomeCell type + Omnilock (Ethereum displaying) + secp256k1_blake160 + Spore (DID) | 3 | 4,920,995 |
| Omnilock (Ethereum displaying) + unknown 0x0b36e986…2956 | 3 | 3,003,665 |
| 6 other combinations | 10 | |

### Omnilock, args 0x00

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x00 in blocks 17851580 to 20851579: 0 transactions ran it, 0 replayed, 0 matched the node.

No transaction in the window ran this script, so there is nothing to measure.

### Omnilock, args 0x01

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x01 in blocks 17851580 to 20851579: 1 transaction ran it, 1 replayed, 1 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Ethereum) | lock | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 | [0xe17b6766…d1d530](https://explorer.nervos.org/transaction/0xe17b6766c514d58542eac2b2d1bdd7f3b18f8b5b330e86748a0d69c49fd1d530) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,464,122 cycles, p90 1,464,122, min 1,464,122, max 1,464,122. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Ethereum) | 1 | 1,464,122 |

### Omnilock, args 0x04

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x04 in blocks 20351580 to 20851579: 427 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Bitcoin) | lock | 40 | 1,428,731 | 1,458,571 | 1,472,092 | 1,491,766 | [0x1c973e91…c3f2c2](https://explorer.nervos.org/transaction/0x1c973e9132085f5e1d63aca69b48d4f87adcfe3de9a297df8c6fdd51d1c3f2c2) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,472,937 cycles, p90 1,490,763, min 1,428,731, max 1,509,952. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Bitcoin) + xUDT | 29 | 1,477,667 |
| Omnilock (Bitcoin) | 11 | 1,451,674 |

### Omnilock, args 0x06

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x06 in blocks 17851580 to 20851579: 1 transaction ran it, 1 replayed, 0 matched the node.

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xd08befa5…f23ae4](https://explorer.nervos.org/transaction/0xd08befa554eb0975fb4aeeaaafeb8ac93844e89181db197fd41b832bccf23ae4) | 18803955 | not-recorded | - | 3,797,340 | the node reports no cycles for this transaction |

### Spore

Searched for type script `0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5` (data1) in blocks 20351580 to 20851579: 68 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Spore | type | 43 | 76,964 | 103,953 | 272,482 | 296,865 | [0x5cdb12f8…73c5d2](https://explorer.nervos.org/transaction/0x5cdb12f87a018a785b9a60ce1c6f2bbbb5295f478a71c82a988e20a2ca73c5d2) |

Code loaded from [0x96b198fb…b69824](https://explorer.nervos.org/transaction/0x96b198fb5ddbd1eed57ed667068f1f1e55d07907b4c0dbd38675a69ea1b69824) output 0.

Whole transactions: median 6,925,286 cycles, p90 8,872,975, min 1,575,289, max 9,685,106. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID + Spore | 12 | 6,977,916 |
| JoyID + secp256k1_blake160 + Spore + unknown 0x9f0f0ba1…71ab + unknown 0xd96cee56…fe54 | 6 | 8,895,314 |
| secp256k1_blake160 + Spore + Spore Cluster | 6 | 1,927,356 |
| secp256k1_blake160 + Spore + unknown 0xb5d13ffe…d695 | 6 | 1,905,373 |
| ckb-dex lock + JoyID + Spore | 3 | 7,155,579 |
| 4 other combinations | 7 | |

### Spore Cluster

Searched for type script `0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075` (data1) in blocks 18351580 to 20851579: 162 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Spore Cluster | type | 40 | 94,555 | 98,683 | 111,471 | 526,090 | [0xbb76eed2…a20b88](https://explorer.nervos.org/transaction/0xbb76eed228f61e394d35e9d0b8db6313e8cb8ff8ff93ccc3a74f0fc99ca20b88) |

Code loaded from [0xe464b7fb…0dc938](https://explorer.nervos.org/transaction/0xe464b7fb9311c5e2820e61c99afc615d6b98bdefbe318c34868c010cbd0dc938) output 0.

Whole transactions: median 1,942,119 cycles, p90 7,235,314, min 1,080,959, max 8,621,009. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + Spore + Spore Cluster | 29 | 1,936,775 |
| JoyID + Spore + Spore Cluster | 6 | 7,304,845 |
| JoyID + Spore Cluster | 1 | 6,909,580 |
| Omnilock (Bitcoin) + 4 x Spore + Spore Cluster + 2 x unknown 0x6361d4b2…6f24 | 1 | 2,309,284 |
| Omnilock (Bitcoin) + 4 x Spore + Spore Cluster + 3 x unknown 0x6361d4b2…6f24 | 1 | 2,362,154 |
| 2 other combinations | 2 | |

### ckb-dex lock

Searched for lock script `0xab0ede4350a201bd615892044ea9edf12180189572e49a7ff3f78cce179ae09f` (type) in blocks 18351580 to 20851579: 54 transactions ran it, 40 replayed, 38 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| ckb-dex lock | lock | 38 | 24,209 | 24,209 | 39,032 | 58,310 | [0x9e071c7b…a9a0be](https://explorer.nervos.org/transaction/0x9e071c7ba6b662ccda84951ea83e033d274f308ad31d85528d8bf20dc0a9a0be) |

Code loaded from [0x36ad4eb8…01847e](https://explorer.nervos.org/transaction/0x36ad4eb856e744648e3f1faf82095fef1140d26dbb85a87141e81a2b1a01847e) output 0.

Whole transactions: median 6,934,866 cycles, p90 7,137,815, min 1,583,243, max 7,208,039. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| ckb-dex lock + JoyID + Spore | 24 | 6,998,458 |
| ckb-dex lock + Omnilock (Ethereum displaying) + Spore | 6 | 1,596,368 |
| ckb-dex lock + JoyID + xUDT | 4 | 6,842,495 |
| ckb-dex lock + JoyID + Spore (DID) | 3 | 6,896,080 |
| ckb-dex lock + Omnilock (Bitcoin) + Spore | 1 | 1,583,243 |

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0x3afb5c65…9209ff](https://explorer.nervos.org/transaction/0x3afb5c65740b3c8679bee4b0c97b85ddeb15a59d51e7bad4295b8bda899209ff) | 18993633 | not-recorded | - | 6,981,989 | the node reports no cycles for this transaction |
| [0x8181b90a…229310](https://explorer.nervos.org/transaction/0x8181b90a13d44d616f941ac70e693b3b10a8d369a4a6da75aa6f129678229310) | 18988293 | not-recorded | - | 6,981,010 | the node reports no cycles for this transaction |

### Type ID

Searched for type script `0x00000000000000000000000000000000000000000000000000545950455f4944` (type) in blocks 18351580 to 20851579: 3960 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Type ID | type | 42 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 | [0x36ad4eb8…01847e](https://explorer.nervos.org/transaction/0x36ad4eb856e744648e3f1faf82095fef1140d26dbb85a87141e81a2b1a01847e) |

Whole transactions: median 4,586,031 cycles, p90 4,622,767, min 2,630,645, max 6,976,074. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + Type ID + unknown 0x1c04df09…e5ac + unknown 0x45c112df…6b1d + unknown 0xa9267ff5…e981 + unknown 0xede19974…f0ba + unknown 0xff022d55…2733 | 26 | 4,602,534 |
| secp256k1_blake160 + Type ID | 11 | 2,648,055 |
| secp256k1_blake160 + 3 x Type ID | 1 | 4,635,985 |
| secp256k1_blake160 + secp256k1_multisig (legacy) + Type ID | 1 | 6,976,074 |
| secp256k1_blake160 + Type ID + unknown 0xd96cee56…fe54 | 1 | 2,711,944 |

### JoyID

Searched for lock script `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type) in blocks 20751580 to 20851579: 189 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| JoyID | lock | 40 | 6,650,867 | 6,844,452 | 7,064,184 | 7,138,538 | [0x1052f94d…79a254](https://explorer.nervos.org/transaction/0x1052f94d877735e774eabd7a7645354b5e58cb88e8be2ee28a600ca08e79a254) |

Code loaded from [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0.

Whole transactions: median 6,844,452 cycles, p90 8,218,522, min 6,650,867, max 9,349,944. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID | 30 | 6,822,750 |
| COTA + JoyID | 6 | 8,248,183 |
| ckb-dex lock + JoyID + Spore | 2 | 7,155,579 |
| JoyID + Spore | 1 | 7,093,958 |
| JoyID + xUDT | 1 | 6,778,881 |

### RGB++ lock

Searched for lock script `0xbc6c568a1a0d0a09f6844dc9d74ddb4343c32143ff25f727c59edf4fb72d6936` (type) in blocks 18351580 to 20851579: 1644 transactions ran it, 40 replayed, 40 matched the node.

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

Searched for lock script `0x70d64497a075bd651e98ac030455ea200637ee325a12ad08aff03f1a117e5a62` (type) in blocks 17851580 to 20851579: 23 transactions ran it, 23 replayed, 9 matched the node.

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
| [0x5199c665…29166b](https://explorer.nervos.org/transaction/0x5199c6650859cf658913e5a85e870671f903e90f5b5dcf3a710c37f46829166b) | 18053362 | not-recorded | - | 2,465,154 | the node reports no cycles for this transaction |
| [0xceaf888f…18e42b](https://explorer.nervos.org/transaction/0xceaf888fd924a58875a56a21b59559f77664163e667d910dd86440ad7f18e42b) | 17997626 | not-recorded | - | 2,449,112 | the node reports no cycles for this transaction |
| [0x07d66fdd…5eab50](https://explorer.nervos.org/transaction/0x07d66fdd7757c7d25cd018a5a38547793acb6c4353056c3105aac782d75eab50) | 17996945 | not-recorded | - | 2,553,589 | the node reports no cycles for this transaction |
| [0x3bfb3c25…9af0b0](https://explorer.nervos.org/transaction/0x3bfb3c25d9bd41bdfe68f3c4c6b2df07c5f2c20f387bc09e913ea85cf49af0b0) | 17945566 | not-recorded | - | 2,600,362 | the node reports no cycles for this transaction |
| [0x33f36dbc…cb5257](https://explorer.nervos.org/transaction/0x33f36dbcfebfeb348acee428bdb0e0fd97b86137bec24ce77456f9d3bccb5257) | 17897205 | not-recorded | - | 3,307,975 | the node reports no cycles for this transaction |
| [0x0889d66c…ed878f](https://explorer.nervos.org/transaction/0x0889d66cafbaf8854fe24c56b47f80f33c7ca2ab3241d9bfe432a9e470ed878f) | 17888162 | not-recorded | - | 2,525,771 | the node reports no cycles for this transaction |

### iCKB logic

Searched for type script `0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3` (data1) in blocks 17851580 to 20851579: 16 transactions ran it, 16 replayed, 8 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| iCKB logic | type | 8 | 89,850 | 105,870 | 160,850 | 160,850 | [0x814c44c4…5c0dbc](https://explorer.nervos.org/transaction/0x814c44c45e33a496dc30f18131e01bf4b72282be58abd7f0fefff9a95b5c0dbc) |

Code loaded from [0xd7309191…dc8f44](https://explorer.nervos.org/transaction/0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44) output 0.

Whole transactions: median 7,135,255 cycles, p90 7,299,002, min 1,831,419, max 7,299,002. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| 2 x iCKB limit order + iCKB logic + JoyID + xUDT | 3 | 7,135,255 |
| iCKB limit order + iCKB logic + JoyID + Nervos DAO + xUDT | 2 | 7,228,651 |
| iCKB limit order + iCKB logic + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,299,002 |
| iCKB limit order + iCKB logic + Nervos DAO + secp256k1_blake160 + xUDT | 1 | 1,868,817 |
| iCKB limit order + iCKB logic + secp256k1_blake160 + xUDT | 1 | 1,831,419 |

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

Searched for lock script `0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a` (data1) in blocks 18351580 to 20851579: 58 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| iCKB limit order | lock | 40 | 47,990 | 75,304 | 79,679 | 162,596 | [0xa183438c…ff5d63](https://explorer.nervos.org/transaction/0xa183438cdc447b05ed8868c871c0204a709b44819bfc1b6849d8e98d9cff5d63) |

Code loaded from [0xd7309191…dc8f44](https://explorer.nervos.org/transaction/0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44) output 1.

Whole transactions: median 1,770,108 cycles, p90 7,106,075, min 1,586,021, max 8,064,887. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| iCKB limit order + secp256k1_blake160 + xUDT | 16 | 1,738,140 |
| 2 x iCKB limit order + JoyID + xUDT | 13 | 6,950,012 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 3 | 1,586,203 |
| iCKB limit order + 2 x iCKB owned owner + Nervos DAO + secp256k1_blake160 + xUDT | 3 | 1,894,882 |
| 2 x iCKB limit order + iCKB logic + JoyID + xUDT | 2 | 7,106,075 |
| 3 other combinations | 3 | |

### iCKB owned owner

Searched for lock script `0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0` (data1) in blocks 17851580 to 20851579: 9 transactions ran it, 9 replayed, 7 matched the node.

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

Searched for type script `0x5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5` (type) in blocks 17851580 to 20851579: 241 transactions ran it, 40 replayed, 18 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| sUDT | type | 18 | 2,710 | 2,710 | 32,871 | 32,871 | [0x35b7f88e…6b2ed8](https://explorer.nervos.org/transaction/0x35b7f88e9ba4048fd1d2f11025c1156bb7773b486633d5de4beffb118c6b2ed8) |

Code loaded from [0xc7813f6a…9936d5](https://explorer.nervos.org/transaction/0xc7813f6a415144643970c2e88e0bb6ca6a8edc5dd7c1022746f628284a9936d5) output 0.

Whole transactions: median 1,659,985 cycles, p90 3,299,046, min 439,210, max 3,299,135. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Nervos DAO + sUDT + unknown 0x29a81473…d43f + unknown 0x6fb198a4…f47f | 8 | 439,210 |
| Nervos DAO + secp256k1_blake160 + sUDT + unknown 0x6fb198a4…f47f + unknown 0x8baa01f5…74de | 5 | 2,519,591 |
| 2 x secp256k1_blake160 + sUDT | 4 | 3,290,465 |
| secp256k1_blake160 + sUDT | 1 | 1,659,985 |

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0x0ee00d6a…1a2381](https://explorer.nervos.org/transaction/0x0ee00d6aaafa6ee798bacf4a22f417f98478aab23997c3c5a312159bd81a2381) | 18996716 | not-recorded | - | 1,473,852 | the node reports no cycles for this transaction |
| [0x21876d84…8869f6](https://explorer.nervos.org/transaction/0x21876d842651eeaf628442e8c6565bbeceb72597def252722bcad150098869f6) | 18652778 | not-recorded | - | 1,667,000 | the node reports no cycles for this transaction |
| [0x4ce55b5c…d29274](https://explorer.nervos.org/transaction/0x4ce55b5c53a06901b6c863f7f1b4a62c0e713bf481889fa1fea12c6ed7d29274) | 18652753 | not-recorded | - | 1,649,160 | the node reports no cycles for this transaction |
| [0xa1497ff5…7d311c](https://explorer.nervos.org/transaction/0xa1497ff53dd60be012b44ee480f9a3a050eb6135b610e406a6950e14db7d311c) | 18358100 | not-recorded | - | 1,750,777 | the node reports no cycles for this transaction |
| [0x20410dac…3fd74b](https://explorer.nervos.org/transaction/0x20410dac8b630811c111e035c3d49e30de5891f51d02a9f9f8c12a1eb83fd74b) | 18332417 | not-recorded | - | 1,461,421 | the node reports no cycles for this transaction |
| [0x2263948a…d89975](https://explorer.nervos.org/transaction/0x2263948aa97f44990f66bde8fe91fed81d146c685af8f43ba9528c525ad89975) | 18331140 | not-recorded | - | 1,760,811 | the node reports no cycles for this transaction |
| [0x9b70e03f…e81b97](https://explorer.nervos.org/transaction/0x9b70e03f143776e744475ece1abd7bae7bc9dc817b2f628bb2f2fa803de81b97) | 18330902 | not-recorded | - | 5,319,848 | the node reports no cycles for this transaction |
| [0x6f87234d…89f62a](https://explorer.nervos.org/transaction/0x6f87234dc04611c14b96ba4ad42819bc6049827cf23e92f2d73581cfa989f62a) | 18312520 | not-recorded | - | 1,760,460 | the node reports no cycles for this transaction |
| [0xa6c7d0c4…da5700](https://explorer.nervos.org/transaction/0xa6c7d0c4ed95968f866fb047d6c56de2a3c56f9aa3e5fd3895d749a6c5da5700) | 18312484 | not-recorded | - | 1,780,134 | the node reports no cycles for this transaction |
| [0x97daa98f…c5706e](https://explorer.nervos.org/transaction/0x97daa98faeac6b259fdc69b7f160dc0126e9f4eae8fd0eab771bc32883c5706e) | 18312421 | not-recorded | - | 1,782,893 | the node reports no cycles for this transaction |
| [0xc386cbef…2b155b](https://explorer.nervos.org/transaction/0xc386cbefab3bb6dbfb2c809c793526672761bee26e241d9465370f74d02b155b) | 18253687 | not-recorded | - | 9,569,192 | the node reports no cycles for this transaction |
| [0xeeee9c87…e74179](https://explorer.nervos.org/transaction/0xeeee9c870ac919814859835df58c30bf2c3800b2a26b5d87e6a0444257e74179) | 18236325 | not-recorded | - | 1,517,987 | the node reports no cycles for this transaction |
| [0x6ab86da6…2b1c88](https://explorer.nervos.org/transaction/0x6ab86da642e2fcfdf14df052f84dc4b412122267a2e6a081ca21cbb5d42b1c88) | 18234408 | not-recorded | - | 1,752,149 | the node reports no cycles for this transaction |
| [0x7ea8af3b…fb8f07](https://explorer.nervos.org/transaction/0x7ea8af3bb93138da715348bd2501e54d3f9b4eb7018f35450269a710ccfb8f07) | 18231575 | not-recorded | - | 1,780,065 | the node reports no cycles for this transaction |
| [0xc1bbdc52…24227e](https://explorer.nervos.org/transaction/0xc1bbdc529dc3e2b3f633d7956131b4400402aafb318800a20465387f4524227e) | 18231488 | not-recorded | - | 1,767,374 | the node reports no cycles for this transaction |
| [0x06a6896f…b6582a](https://explorer.nervos.org/transaction/0x06a6896f3f89ae5b40546bb6e9660ae87051296ce33f60d827004068e9b6582a) | 18231476 | not-recorded | - | 1,779,133 | the node reports no cycles for this transaction |
| [0x4cc72e97…bb19e4](https://explorer.nervos.org/transaction/0x4cc72e97c0e0711680aefc498b0c944f998e4e72934a2af3a9510a7ab4bb19e4) | 18231457 | not-recorded | - | 1,753,081 | the node reports no cycles for this transaction |
| [0xc6ad2374…a2483b](https://explorer.nervos.org/transaction/0xc6ad2374ba169e66457c705e6d998a779ff7ca19c5bcceb18fdba46fbfa2483b) | 18225134 | not-recorded | - | 9,530,834 | the node reports no cycles for this transaction |
| [0x962c3696…a3df0b](https://explorer.nervos.org/transaction/0x962c369672a553f7d25f4c695bd13600cc8002ac155259297186237aa6a3df0b) | 18224883 | not-recorded | - | 9,262,954 | the node reports no cycles for this transaction |
| [0xa58d1149…0a851e](https://explorer.nervos.org/transaction/0xa58d11497e4e975bcb0f067c12b29bca994d47b58951a9eb2cf749ef9f0a851e) | 18224875 | not-recorded | - | 4,843,470 | the node reports no cycles for this transaction |
| [0xc1fbd617…766ac4](https://explorer.nervos.org/transaction/0xc1fbd617b02558167fd6d580d40b19f741ab94035e6620dedd44ef4244766ac4) | 18224867 | not-recorded | - | 1,777,901 | the node reports no cycles for this transaction |
| [0xb1cbfb5d…dda896](https://explorer.nervos.org/transaction/0xb1cbfb5db4aa25ea1eba3adeda803bd2f7fa28aee1486706a5eebbf58edda896) | 18224864 | not-recorded | - | 8,319,931 | the node reports no cycles for this transaction |

### anyone-can-pay

Searched for lock script `0xd369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354` (type) in blocks 18351580 to 20851579: 44 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| anyone-can-pay | lock | 40 | 33,522 | 34,106 | 1,609,984 | 1,627,021 | [0x71f2e638…8b2e4f](https://explorer.nervos.org/transaction/0x71f2e6385148a413fb8a59e71eefb5dd19f6ed10c1271b9615a5b60b548b2e4f) |

Code loaded from [0x58eb58e2…6d6876](https://explorer.nervos.org/transaction/0x58eb58e2e3dd9852099a19424cf6e63b5238afe92e3085561b8feafced6d6876) output 0.

Whole transactions: median 6,833,357 cycles, p90 6,949,058, min 1,674,600, max 7,078,163. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| anyone-can-pay + JoyID + xUDT | 20 | 6,899,510 |
| anyone-can-pay + secp256k1_blake160 + xUDT | 16 | 3,240,813 |
| anyone-can-pay + JoyID | 4 | 6,992,933 |

### UniqueType

Searched for type script `0x2c8c11c985da60b0a330c61a85507416d6382c130ba67f0c47ab071e00aec628` (data1) in blocks 17851580 to 20851579: 3 transactions ran it, 3 replayed, 0 matched the node.

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xa1a96c2f…a4143c](https://explorer.nervos.org/transaction/0xa1a96c2f2f540b824fb767de0b059a6226327e13545370cea89b1683dba4143c) | 18660178 | not-recorded | - | 2,725,209 | the node reports no cycles for this transaction |
| [0x21737131…e00582](https://explorer.nervos.org/transaction/0x217371316e8abdc73a35cbbce27a9723efc75b58a8126bfba68ae4ea3ae00582) | 18636357 | not-recorded | - | 7,804,984 | the node reports no cycles for this transaction |
| [0x1ff16c40…33a37b](https://explorer.nervos.org/transaction/0x1ff16c40ab8cf8517960da69379d0b22655f13fae970c67cfa41ffc9fc33a37b) | 18635246 | not-recorded | - | 7,935,791 | the node reports no cycles for this transaction |

### COTA

Searched for type script `0x1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df` (type) in blocks 20351580 to 20851579: 97 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| COTA | type | 40 | 105,068 | 1,134,820 | 2,332,914 | 2,333,515 | [0xcdc3a2ba…52c1df](https://explorer.nervos.org/transaction/0xcdc3a2ba07e0bf406fd60a099455babb4a82ad05819a67211e21a34b8b52c1df) |

Code loaded from [0x668921df…6837ab](https://explorer.nervos.org/transaction/0x668921df2836e5ce4b3c41c626aab1ee3ef9bccfa4b527abcf28a61b166837ab) output 1.

Whole transactions: median 8,168,913 cycles, p90 9,309,609, min 2,346,328, max 9,360,631. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| COTA + JoyID | 32 | 8,218,522 |
| COTA + secp256k1_blake160 + unknown 0x90ca618b…9ac7 + unknown 0xd4839251…35f6 | 8 | 2,380,010 |

### d.id das-lock

Searched for lock script `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type) in blocks 20751580 to 20851579: 45 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| d.id das-lock | lock | 62 | 282,271 | 282,271 | 354,217 | 4,435,773 | [0x5a060093…d0bd7a](https://explorer.nervos.org/transaction/0x5a060093499c9e0f409bd81fa4b4fe0569961b11719784f41cb3a5d59ed0bd7a) |

Code loaded from [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0.

Whole transactions: median 1,602,547 cycles, p90 5,070,466, min 865,741, max 5,142,939. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| d.id AccountCell type + d.id BalanceCell type + 2 x d.id das-lock | 21 | 1,612,044 |
| d.id AccountCell type + d.id das-lock | 10 | 940,361 |
| d.id AccountCell type + d.id AccountSaleCell type + d.id BalanceCell type + d.id das-lock | 6 | 1,587,807 |
| d.id AccountCell type + d.id BalanceCell type + 2 x d.id das-lock + unknown 0x303ead37…3078 + unknown 0x63516de8…f4b4 | 1 | 2,009,871 |
| d.id AccountCell type + d.id BalanceCell type + d.id das-lock | 1 | 1,373,598 |
| 1 other combinations | 1 | |

### Nervos DAO

Searched for type script `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type) in blocks 20751580 to 20851579: 374 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Nervos DAO | type | 40 | 9,930 | 13,826 | 14,888 | 14,888 | [0xb56da93e…6b5c23](https://explorer.nervos.org/transaction/0xb56da93ee209502168115ffd61391e4e669bc90015a451d1cc908d1c936b5c23) |

Code loaded from [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2.

Whole transactions: median 1,661,379 cycles, p90 3,308,121, min 1,456,364, max 8,231,364. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Nervos DAO + secp256k1_blake160 | 24 | 1,658,080 |
| Nervos DAO + 2 x secp256k1_blake160 | 10 | 3,290,960 |
| Nervos DAO + Omnilock (Ethereum displaying) | 4 | 1,483,716 |
| Nervos DAO + 5 x secp256k1_blake160 | 1 | 8,231,364 |
| Nervos DAO + PWLock | 1 | 1,728,715 |

## Method and limits

- Each transaction is rebuilt as a ckb-debugger mock transaction from the node (input cells, cell deps with dep groups expanded, header deps), then every script group runs once in the native ckb-debugger, on the CKB-VM version of the transaction's epoch. Type ID is verified natively by the node and charged its fixed 1,000,000 cycles, as the node does.
- The sample is every non-cellbase transaction in a window of recent blocks, so it reflects what was busy on mainnet in that window, not all of mainnet history. A different window will give different shares.
- Names come from CCC's mainnet table of known scripts, plus a short table in scripts/atlas-lib.ts of scripts whose code hash is published elsewhere (Spore and Cluster from @ckb-ccc/spore; d.id, RGB++, iCKB and ckb-dex from their own repositories, each with its source). Scripts in neither show as unknown with their code hash; Omnilock's mode is read from the first byte of its args.
- A targeted sample is the most recent transactions in which one script ran (a lock only counts where it guards an input, since an output's lock does not run), found with the indexer RPC in a window that widens until enough are found. Busy scripts are searched one first args byte at a time, which finds the same transactions in smaller requests.
- The raw per-transaction results are in data.json next to this file.

## Reproduce

```
npm ci
npm run atlas -- --rpc https://mainnet.ckb.dev/ --to 20851152 --blocks 15277 --stride 12 --max-txs 1000
```

The targeted samples, into the same folder:

```
npm run atlas -- --out atlas/2026-10-28 --rpc https://mainnet.ckb.dev/ --to 20851579 --max-txs 40 --max-window 3000000 \
  --script xudt --script omnilock --script omnilock@0x00 --script omnilock@0x01 --script omnilock@0x04 --script omnilock@0x06 --script spore --script cluster --script dex-lock --script type-id --script joyid --script rgbpp-lock --script btc-time-lock --script ickb-logic --script ickb-limit-order --script ickb-owned-owner --script sudt --script acp --script unique-type --script cota --script das-lock --script dao
```

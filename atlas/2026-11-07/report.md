# CKB mainnet cycle atlas: blocks 20932885 to 20946673

What the scripts in recent CKB mainnet transactions cost in cycles, measured per script group by replaying each transaction in ckb-debugger with [ckb-cycle-tools](../../README.md). A transaction counts only when its groups add up exactly to the cycles the node reported for it; anything else is listed under Excluded, not dropped.

## Sample

| | |
|---|---|
| Node | https://mainnet.ckb.dev/ (chain `ckb`) |
| Blocks | 20932885 to 20946673, every 12th block (1150 blocks) |
| Transactions replayed | 1002 (1150 cellbase transactions skipped: they run no scripts) |
| Matched the node exactly | 1002 |
| Excluded | 0 mismatch, 0 not recorded by the node, 0 could not be replayed |
| ckb-debugger | ckb-debugger 1.1.1, CKB-VM version 2 |
| Run | 2026-11-07T04:05:32.680Z to 2026-11-07T05:09:03.644Z, ckb-cycle-tools a460954 |

Per matched transaction: median 1,729,190 cycles, p90 4,607,770, min 1,601,431, max 6,865,540; 2,301,768,817 cycles in all.

## Cost per script group

One row per script (code hash and hash type; Omnilock split by auth mode). Groups: how many times the script ran as a group, which is once per transaction for most scripts. Share: its part of all cycles in the matched transactions. Median and p90 are nearest-rank, so each is a cost that was actually measured. The example is the transaction whose group cost is closest to the median.

| Script | Role | Groups | Min | Median | p90 | Max | Share | Example |
|---|---|--:|--:|--:|--:|--:|--:|---|
| secp256k1_blake160 | lock | 1002 | 1,601,431 | 1,647,946 | 1,665,060 | 5,658,771 | 71.9% | [0xaaa78279…3bb645](https://explorer.nervos.org/transaction/0xaaa7827937f21e309a1dd4f8bb9bc05bc0f85af398f152aabb18d6e7943bb645) |
| unknown 0xa9267ff5…e981 | type | 175 | 1,720,933 | 1,801,237 | 1,836,377 | 1,868,100 | 13.7% | [0xc35c3b9b…9f8d32](https://explorer.nervos.org/transaction/0xc35c3b9bf1f62f8ea5c0cdcf43f6c1b61d9d1a1e2c9fed014fba818c9a9f8d32) |
| Type ID | type | 175 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 | 7.6% | [0xf31034f3…923494](https://explorer.nervos.org/transaction/0xf31034f3754790a57e3bd49f7d64f93f082ee888315a39b384be9ab9ec923494) |
| Bitcoin SPV client (RGB++) | type | 33 | 1,183,669 | 1,366,700 | 1,551,628 | 1,556,321 | 2.0% | [0x7f925253…3c0c79](https://explorer.nervos.org/transaction/0x7f925253bf942ab51b7c72404ce4b189860fed3aecf288ebde9bfc280d3c0c79) |
| d.id time oracle (info) | type | 648 | 45,041 | 45,174 | 45,175 | 45,175 | 1.3% | [0xb85dff93…e87915](https://explorer.nervos.org/transaction/0xb85dff93e9a417b70104c4d7511841e7ebdb655a75e35fcac6ee551821e87915) |
| JoyID | lock | 4 | 6,807,974 | 6,833,689 | 6,862,057 | 6,862,057 | 1.2% | [0xf8945fbc…eb8709](https://explorer.nervos.org/transaction/0xf8945fbc976eddfdcd0ddafabd6b1df9822c03628055f7ec9db6de17f3eb8709) |
| d.id time oracle (index state) | type | 648 | 32,975 | 32,977 | 32,977 | 32,977 | 0.9% | [0xb85dff93…e87915](https://explorer.nervos.org/transaction/0xb85dff93e9a417b70104c4d7511841e7ebdb655a75e35fcac6ee551821e87915) |
| unknown 0x45c112df…6b1d | lock | 175 | 72,371 | 72,371 | 72,371 | 72,371 | 0.6% | [0xf31034f3…923494](https://explorer.nervos.org/transaction/0xf31034f3754790a57e3bd49f7d64f93f082ee888315a39b384be9ab9ec923494) |
| unknown 0xff022d55…2733 | lock | 175 | 58,820 | 58,820 | 58,820 | 58,820 | 0.4% | [0xf31034f3…923494](https://explorer.nervos.org/transaction/0xf31034f3754790a57e3bd49f7d64f93f082ee888315a39b384be9ab9ec923494) |
| unknown 0xede19974…f0ba | lock | 175 | 31,006 | 31,006 | 31,006 | 31,006 | 0.2% | [0xf31034f3…923494](https://explorer.nervos.org/transaction/0xf31034f3754790a57e3bd49f7d64f93f082ee888315a39b384be9ab9ec923494) |
| d.id ProposalCell type | type | 2 | 517,448 | 517,448 | 1,048,183 | 1,048,183 | 0.07% | [0xdcbfa292…003175](https://explorer.nervos.org/transaction/0xdcbfa29254be9328c1c4509ff1a8d24969c84e72092dc1507b2ed96ae8003175) |
| d.id PreAccountCell type | type | 2 | 314,646 | 314,646 | 693,945 | 693,945 | 0.04% | [0x92817dd6…02f3eb](https://explorer.nervos.org/transaction/0x92817dd6625a8b66231ad7dbfcf6593fdb54ac78c3e3df21f0864d6a0202f3eb) |
| unknown 0x1c04df09…e5ac | lock | 175 | 4,426 | 4,426 | 4,426 | 4,426 | 0.03% | [0xf31034f3…923494](https://explorer.nervos.org/transaction/0xf31034f3754790a57e3bd49f7d64f93f082ee888315a39b384be9ab9ec923494) |
| d.id AccountCell type | type | 1 | 534,800 | 534,800 | 534,800 | 534,800 | 0.02% | [0x92817dd6…02f3eb](https://explorer.nervos.org/transaction/0x92817dd6625a8b66231ad7dbfcf6593fdb54ac78c3e3df21f0864d6a0202f3eb) |
| d.id das-lock | lock | 1 | 321,154 | 321,154 | 321,154 | 321,154 | 0.01% | [0x92817dd6…02f3eb](https://explorer.nervos.org/transaction/0x92817dd6625a8b66231ad7dbfcf6593fdb54ac78c3e3df21f0864d6a0202f3eb) |
| d.id IncomeCell type | type | 1 | 303,347 | 303,347 | 303,347 | 303,347 | 0.01% | [0x92817dd6…02f3eb](https://explorer.nervos.org/transaction/0x92817dd6625a8b66231ad7dbfcf6593fdb54ac78c3e3df21f0864d6a0202f3eb) |
| unknown 0xc024b6ef…a758 | type | 1 | 217,709 | 217,709 | 217,709 | 217,709 | <0.01% | [0x58e61273…03c2a3](https://explorer.nervos.org/transaction/0x58e612731ce46fad455753699a2fcf82c18df7111da0dafd50bd0f275d03c2a3) |
| Nervos DAO | type | 11 | 9,930 | 11,981 | 14,084 | 14,888 | <0.01% | [0x38b48e50…5dfb5b](https://explorer.nervos.org/transaction/0x38b48e50f987b6f7509cd72e261e3a81da5f7d3ee80cc62b0bc66e6c0a5dfb5b) |
| unknown 0x303ead37…3078 | lock | 1 | 2,107 | 2,107 | 2,107 | 2,107 | 0.0% | [0x92817dd6…02f3eb](https://explorer.nervos.org/transaction/0x92817dd6625a8b66231ad7dbfcf6593fdb54ac78c3e3df21f0864d6a0202f3eb) |

Code hashes, and the cell each script's code was loaded from:

- secp256k1_blake160: `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 1
- unknown 0xa9267ff5…e981: `0xa9267ff5a16f38aa9382608eb9022883a78e6a40855107bb59f8406cce00e981` (type), code in [0xd7caeb8d…bac425](https://explorer.nervos.org/transaction/0xd7caeb8d8fd6a3f266c58d06fda72b29043c09dae83ab859bdabc72db1bac425) output 0
- Type ID: `0x00000000000000000000000000000000000000000000000000545950455f4944` (type)
- Bitcoin SPV client (RGB++): `0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d` (type), code in [0x1dc9a535…d8a2b8](https://explorer.nervos.org/transaction/0x1dc9a53526bb7a9a4974aa6de7636014279bff996321c9acc5180912e7d8a2b8) output 0
- d.id time oracle (info): `0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79` (type), code in [0x3ba4c4b6…c905a5](https://explorer.nervos.org/transaction/0x3ba4c4b6cb70fd332d0159fa1c2ce021b361b7ccfe1acf2c44ad4902b1c905a5) output 0
- JoyID: `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type), code in [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0
- d.id time oracle (index state): `0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43` (type), code in [0xae3197c3…dc61b3](https://explorer.nervos.org/transaction/0xae3197c306c0d0b36722773cff7dafcc8e312154826f876cec4bd94d24dc61b3) output 0
- unknown 0x45c112df…6b1d: `0x45c112df97daece27c4afa02b24b15f64403bdfd45ab2e0e88c9fb2a24796b1d` (type), code in [0x105c7f3b…b5b90b](https://explorer.nervos.org/transaction/0x105c7f3b9a917537df6277198bab6bba9b3e3b5a8030a314e4cf499045b5b90b) output 0
- unknown 0xff022d55…2733: `0xff022d5512d3d5fd9614cc6ead110925d7a39e8916b6b1c8d5967846e4d32733` (type), code in [0xfe15ef73…e790a9](https://explorer.nervos.org/transaction/0xfe15ef73f0dd95e840d41a9d998e0f19c09ff544857320dbcc4f6e58a6e790a9) output 0
- unknown 0xede19974…f0ba: `0xede199745fbd9e9f339f1dd2e92a586020d111432bfb81a6c2b12ddc9856f0ba` (type), code in [0x59bf75aa…c8eff7](https://explorer.nervos.org/transaction/0x59bf75aa93292dc5f106533b3248143cacb22ab58e1ec59f51bbe005cdc8eff7) output 0
- d.id ProposalCell type: `0x6127a41ad0549e8574a25b4d87a7414f1e20579306c943c53ffe7d03f3859bbe` (type), code in [0x27b53071…3ec86c](https://explorer.nervos.org/transaction/0x27b53071c85e05c76b093436b593ad60935b8448b91d2985958bb5263c3ec86c) output 0
- d.id PreAccountCell type: `0x18ab87147e8e81000ab1b9f319a5784d4c7b6c98a9cec97d738a5c11f69e7254` (type), code in [0x2f558950…7ab7e0](https://explorer.nervos.org/transaction/0x2f558950a12c75aee2233b958a0a3d43fae88d33f630735afa977bdbc87ab7e0) output 0
- unknown 0x1c04df09…e5ac: `0x1c04df09d9adede5bfc40ff1a39a3a17fc8e29f15c56f16b7e48680c600ee5ac` (type), code in [0x39f1867c…e9fd36](https://explorer.nervos.org/transaction/0x39f1867c4d68d0b4bd52b7fd559a73e348385fa8832102b54aa6fe1e7de9fd36) output 0
- d.id AccountCell type: `0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918` (type), code in [0x2455f39f…cddaba](https://explorer.nervos.org/transaction/0x2455f39ff2a655e3b02f58266b1a7b7d9efc95f2d724410aff1052717acddaba) output 0
- d.id das-lock: `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type), code in [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0
- d.id IncomeCell type: `0x6c1d69a358954fc471a2ffa82a98aed5a4912e6002a5e761524f2304ab53bf39` (type), code in [0x0266b5a1…dfd8e8](https://explorer.nervos.org/transaction/0x0266b5a13edddd62f6954a6ee40b94eda76d7d5b9466ee9c5059817958dfd8e8) output 0
- unknown 0xc024b6ef…a758: `0xc024b6efde8d49af665b3245223a8aa889e35ede15bc510392a7fea2dec0a758` (type), code in [0x95db61ea…37e870](https://explorer.nervos.org/transaction/0x95db61ea109f9ebf1cf51c43a02f747ddb2acf89da60b047eb2ad16f4937e870) output 0
- Nervos DAO: `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2
- unknown 0x303ead37…3078: `0x303ead37be5eebfcf3504847155538cb623a26f237609df24bd296750c123078` (type), code in [0x406cc023…56ca8a](https://explorer.nervos.org/transaction/0x406cc023b770bad3c47db0de8ca5215004150e22c7d58b6daf3d41aba256ca8a) output 0

## What ran together

Matched transactions by the scripts that ran in them ("2 x" is one script running as two groups, e.g. inputs with two different owners).

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| d.id time oracle (index state) + d.id time oracle (info) + secp256k1_blake160 | 648 | 1,727,539 |
| secp256k1_blake160 + Type ID + unknown 0x1c04df09…e5ac + unknown 0x45c112df…6b1d + unknown 0xa9267ff5…e981 + unknown 0xede19974…f0ba + unknown 0xff022d55…2733 | 175 | 4,610,920 |
| secp256k1_blake160 | 128 | 1,646,899 |
| Bitcoin SPV client (RGB++) + secp256k1_blake160 | 33 | 3,032,961 |
| Nervos DAO + secp256k1_blake160 | 7 | 1,642,510 |
| JoyID | 3 | 6,833,689 |
| Nervos DAO + 2 x secp256k1_blake160 | 3 | 3,293,697 |
| 2 x secp256k1_blake160 | 1 | 3,324,815 |
| d.id AccountCell type + d.id das-lock + d.id IncomeCell type + d.id PreAccountCell type + d.id ProposalCell type + secp256k1_blake160 + unknown 0x303ead37…3078 | 1 | 4,292,792 |
| d.id PreAccountCell type + secp256k1_blake160 + unknown 0xc024b6ef…a758 | 1 | 2,597,571 |
| 2 other combinations | 2 | |

## Excluded

None: every sampled transaction matched the node's total exactly.

## Targeted samples

A second, separate sample. The random sample above saw too few transactions of some well-known scripts to say what they cost, so for each script below the node's indexer (`get_transactions`) was asked for the most recent mainnet transactions in which that script ran, and up to 40 of them were replayed the same way, with the same check against the node's total. These transactions were picked because of the script, so they show what the script costs when it runs, not how much of mainnet it is: there are no shares here, and none of them is counted in the random sample above.

| | |
|---|---|
| Node | https://mainnet.ckb.dev/ (chain `ckb`) |
| Searched back from | block 20947093 |
| ckb-debugger | ckb-debugger 1.1.1 |
| Run | 2026-11-07T05:09:21.439Z to 2026-11-07T05:45:11.507Z, ckb-cycle-tools a460954 |

Cost of the searched script per group. Found: transactions in the searched window in which the script ran; the most recent of them were replayed. Only replays that matched the node's total count toward the costs; the rest are listed under each script.

| Script | Blocks searched | Found | Replayed | Matched | Groups | Min | Median | p90 | Max |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| xUDT | 20447094 to 20947093 | 794 | 40 | 40 | 41 | 17,032 | 20,564 | 20,717 | 23,547 |
| Omnilock (Ethereum displaying) | 20447094 to 20947093 | 581 | 40 | 40 | 37 | 1,432,881 | 1,460,165 | 1,476,761 | 1,488,334 |
| Omnilock (Bitcoin) | 20447094 to 20947093 | 581 | 40 | 40 | 2 | 1,454,560 | 1,454,560 | 1,465,978 | 1,465,978 |
| Omnilock (Ethereum) | 20447094 to 20947093 | 581 | 40 | 40 | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 |
| Omnilock, args 0x00 | 17947094 to 20947093 | 0 | 0 | 0 | 0 | | | | |
| Omnilock (Ethereum), args 0x01 | 17947094 to 20947093 | 1 | 1 | 1 | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 |
| Omnilock (Bitcoin), args 0x04 | 20447094 to 20947093 | 421 | 40 | 40 | 40 | 1,428,731 | 1,458,571 | 1,472,092 | 1,491,766 |
| Omnilock, args 0x06 | 17947094 to 20947093 | 1 | 1 | 0 | 0 | | | | |
| Spore | 20447094 to 20947093 | 68 | 40 | 40 | 40 | 74,719 | 105,299 | 272,482 | 275,707 |
| Spore Cluster | 18447094 to 20947093 | 159 | 40 | 40 | 40 | 90,444 | 98,683 | 122,630 | 526,090 |
| ckb-dex lock | 18447094 to 20947093 | 50 | 40 | 39 | 39 | 24,209 | 24,267 | 39,032 | 58,310 |
| Type ID | 20927094 to 20947093 | 2677 | 40 | 40 | 40 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 |
| JoyID | 20927094 to 20947093 | 57 | 40 | 40 | 40 | 6,673,440 | 6,815,869 | 6,879,521 | 6,932,828 |
| RGB++ lock | 18447094 to 20947093 | 1643 | 40 | 40 | 1444 | 860,908 | 1,418,522 | 1,419,245 | 1,420,650 |
| BTC time lock (RGB++) | 17947094 to 20947093 | 20 | 20 | 9 | 9 | 764,058 | 813,924 | 959,098 | 959,098 |
| iCKB logic | 17947094 to 20947093 | 16 | 16 | 8 | 8 | 89,850 | 105,870 | 160,850 | 160,850 |
| iCKB limit order | 18447094 to 20947093 | 60 | 40 | 40 | 40 | 47,990 | 75,304 | 79,679 | 162,596 |
| iCKB owned owner | 17947094 to 20947093 | 9 | 9 | 7 | 7 | 59,145 | 72,704 | 229,155 | 229,155 |
| sUDT | 17947094 to 20947093 | 155 | 40 | 20 | 20 | 2,710 | 5,540 | 32,871 | 32,871 |
| anyone-can-pay | 18447094 to 20947093 | 44 | 40 | 40 | 40 | 33,522 | 34,106 | 1,609,984 | 1,627,021 |
| UniqueType | 17947094 to 20947093 | 3 | 3 | 0 | 0 | | | | |
| COTA | 20847094 to 20947093 | 61 | 40 | 40 | 49 | 105,068 | 2,332,001 | 2,332,001 | 2,332,930 |
| d.id das-lock | 20847094 to 20947093 | 67 | 40 | 40 | 61 | 282,271 | 282,271 | 3,862,283 | 4,905,432 |
| Nervos DAO | 20927094 to 20947093 | 77 | 40 | 40 | 40 | 9,930 | 11,974 | 13,826 | 1,118,658 |

### xUDT

Searched for type script `0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95` (data1) in blocks 20447094 to 20947093: 794 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| xUDT | type | 41 | 17,032 | 20,564 | 20,717 | 23,547 | [0xe8b7e42a…62e0bb](https://explorer.nervos.org/transaction/0xe8b7e42a3d8e791df087544dab77ca59dcfc6f0b370e724e410fa8361e62e0bb) |

Code loaded from [0xc07844ce…558ab7](https://explorer.nervos.org/transaction/0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab7) output 0.

Whole transactions: median 2,051,799 cycles, p90 6,878,075, min 1,537,611, max 6,931,848. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID + xUDT | 16 | 6,851,229 |
| secp256k1_blake160 + unknown 0x3547c9aa…060e + unknown 0x393df335…9a88 + unknown 0x7ef6e226…56f7 + unknown 0xc70a8b00…3c98 + xUDT | 14 | 2,030,258 |
| secp256k1_blake160 + xUDT | 3 | 1,677,720 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 2 | 1,586,203 |
| iCKB limit order + secp256k1_blake160 + xUDT | 2 | 1,721,817 |
| 3 other combinations | 3 | |

### Omnilock

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type) in blocks 20447094 to 20947093: 581 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Ethereum displaying) | lock | 37 | 1,432,881 | 1,460,165 | 1,476,761 | 1,488,334 | [0x2da6a54a…b4c103](https://explorer.nervos.org/transaction/0x2da6a54ade8375d3f72b92e04fd639b0130d309444bf072f85735a3e4eb4c103) |
| Omnilock (Bitcoin) | lock | 2 | 1,454,560 | 1,454,560 | 1,465,978 | 1,465,978 | [0x8dd48b31…372959](https://explorer.nervos.org/transaction/0x8dd48b31fcd5fdf5c0303c2c60815f3987490b7a9968c77f8ab32ae63e372959) |
| Omnilock (Ethereum) | lock | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 | [0xe17b6766…d1d530](https://explorer.nervos.org/transaction/0xe17b6766c514d58542eac2b2d1bdd7f3b18f8b5b330e86748a0d69c49fd1d530) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,488,334 cycles, p90 3,026,725, min 1,441,552, max 13,611,814. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Nervos DAO + Omnilock (Ethereum displaying) | 13 | 1,474,044 |
| Omnilock (Ethereum displaying) | 5 | 1,447,880 |
| Omnilock (Ethereum displaying) + Spore (DID) | 5 | 1,567,176 |
| Omnilock (Ethereum displaying) + unknown 0x0b36e986…2956 | 3 | 3,003,665 |
| Omnilock (Ethereum displaying) + unknown 0x0b36e986…2956 + unknown 0x5dd229e2…3248 | 3 | 2,771,745 |
| 7 other combinations | 11 | |

### Omnilock, args 0x00

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x00 in blocks 17947094 to 20947093: 0 transactions ran it, 0 replayed, 0 matched the node.

No transaction in the window ran this script, so there is nothing to measure.

### Omnilock, args 0x01

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x01 in blocks 17947094 to 20947093: 1 transaction ran it, 1 replayed, 1 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Omnilock (Ethereum) | lock | 1 | 1,464,122 | 1,464,122 | 1,464,122 | 1,464,122 | [0xe17b6766…d1d530](https://explorer.nervos.org/transaction/0xe17b6766c514d58542eac2b2d1bdd7f3b18f8b5b330e86748a0d69c49fd1d530) |

Code loaded from [0xc76edf46…72c842](https://explorer.nervos.org/transaction/0xc76edf469816aa22f416503c38d0b533d2a018e253e379f134c3985b3472c842) output 0.

Whole transactions: median 1,464,122 cycles, p90 1,464,122, min 1,464,122, max 1,464,122. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Omnilock (Ethereum) | 1 | 1,464,122 |

### Omnilock, args 0x04

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x04 in blocks 20447094 to 20947093: 421 transactions ran it, 40 replayed, 40 matched the node.

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

Searched for lock script `0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26` (type), args starting 0x06 in blocks 17947094 to 20947093: 1 transaction ran it, 1 replayed, 0 matched the node.

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xd08befa5…f23ae4](https://explorer.nervos.org/transaction/0xd08befa554eb0975fb4aeeaaafeb8ac93844e89181db197fd41b832bccf23ae4) | 18803955 | not-recorded | - | 3,797,340 | the node reports no cycles for this transaction |

### Spore

Searched for type script `0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5` (data1) in blocks 20447094 to 20947093: 68 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Spore | type | 40 | 74,719 | 105,299 | 272,482 | 275,707 | [0x4bec9eca…c812ad](https://explorer.nervos.org/transaction/0x4bec9ecabded9ace10d7525ef5988f48693809c64afb412a82ff7b592ec812ad) |

Code loaded from [0x96b198fb…b69824](https://explorer.nervos.org/transaction/0x96b198fb5ddbd1eed57ed667068f1f1e55d07907b4c0dbd38675a69ea1b69824) output 0.

Whole transactions: median 6,872,855 cycles, p90 8,816,911, min 1,575,289, max 8,921,403. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID + Spore | 10 | 6,975,147 |
| secp256k1_blake160 + Spore + Spore Cluster | 6 | 1,927,356 |
| secp256k1_blake160 + Spore + unknown 0xb5d13ffe…d695 | 6 | 1,905,373 |
| JoyID + secp256k1_blake160 + Spore + unknown 0x9f0f0ba1…71ab + unknown 0xd96cee56…fe54 | 5 | 8,895,314 |
| 2 x secp256k1_blake160 + Spore + Spore Cluster | 4 | 3,693,658 |
| 5 other combinations | 9 | |

### Spore Cluster

Searched for type script `0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075` (data1) in blocks 18447094 to 20947093: 159 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Spore Cluster | type | 40 | 90,444 | 98,683 | 122,630 | 526,090 | [0xbb76eed2…a20b88](https://explorer.nervos.org/transaction/0xbb76eed228f61e394d35e9d0b8db6313e8cb8ff8ff93ccc3a74f0fc99ca20b88) |

Code loaded from [0xe464b7fb…0dc938](https://explorer.nervos.org/transaction/0xe464b7fb9311c5e2820e61c99afc615d6b98bdefbe318c34868c010cbd0dc938) output 0.

Whole transactions: median 1,942,204 cycles, p90 3,718,356, min 1,080,959, max 8,621,009. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + Spore + Spore Cluster | 28 | 1,936,775 |
| 2 x secp256k1_blake160 + Spore + Spore Cluster | 4 | 3,693,658 |
| JoyID + Spore + Spore Cluster | 4 | 7,304,845 |
| Omnilock (Bitcoin) + 4 x Spore + Spore Cluster + 2 x unknown 0x6361d4b2…6f24 | 1 | 2,309,284 |
| Omnilock (Bitcoin) + 4 x Spore + Spore Cluster + 3 x unknown 0x6361d4b2…6f24 | 1 | 2,362,154 |
| 2 other combinations | 2 | |

### ckb-dex lock

Searched for lock script `0xab0ede4350a201bd615892044ea9edf12180189572e49a7ff3f78cce179ae09f` (type) in blocks 18447094 to 20947093: 50 transactions ran it, 40 replayed, 39 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| ckb-dex lock | lock | 39 | 24,209 | 24,267 | 39,032 | 58,310 | [0x6abecb0e…48ab3a](https://explorer.nervos.org/transaction/0x6abecb0e9973a4849afc82765c3f0923b3b99f92b073445ae5e972ffc548ab3a) |

Code loaded from [0x36ad4eb8…01847e](https://explorer.nervos.org/transaction/0x36ad4eb856e744648e3f1faf82095fef1140d26dbb85a87141e81a2b1a01847e) output 0.

Whole transactions: median 6,934,866 cycles, p90 7,137,815, min 1,583,243, max 7,208,039. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| ckb-dex lock + JoyID + Spore | 24 | 6,998,458 |
| ckb-dex lock + Omnilock (Ethereum displaying) + Spore | 6 | 1,596,368 |
| ckb-dex lock + JoyID + xUDT | 4 | 6,842,495 |
| ckb-dex lock + JoyID + Spore (DID) | 3 | 6,896,080 |
| ckb-dex lock + Omnilock (Bitcoin) + Spore | 1 | 1,583,243 |
| 1 other combinations | 1 | |

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0x3afb5c65…9209ff](https://explorer.nervos.org/transaction/0x3afb5c65740b3c8679bee4b0c97b85ddeb15a59d51e7bad4295b8bda899209ff) | 18993633 | not-recorded | - | 6,981,989 | the node reports no cycles for this transaction |

### Type ID

Searched for type script `0x00000000000000000000000000000000000000000000000000545950455f4944` (type) in blocks 20927094 to 20947093: 2677 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Type ID | type | 40 | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 | [0x8a0c55ac…32ca19](https://explorer.nervos.org/transaction/0x8a0c55accfe40ddbd31f53cd06a7ee4ba97682aa66a0fe6351addded4e32ca19) |

Whole transactions: median 4,638,344 cycles, p90 4,678,925, min 4,517,634, max 4,688,827. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + Type ID + unknown 0x1c04df09…e5ac + unknown 0x45c112df…6b1d + unknown 0xa9267ff5…e981 + unknown 0xede19974…f0ba + unknown 0xff022d55…2733 | 40 | 4,638,344 |

### JoyID

Searched for lock script `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type) in blocks 20927094 to 20947093: 57 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| JoyID | lock | 40 | 6,673,440 | 6,815,869 | 6,879,521 | 6,932,828 | [0x56c95a0e…b940a3](https://explorer.nervos.org/transaction/0x56c95a0e65bd96160aa587b7b9362b791e31f725ec5dd42322d6685125b940a3) |

Code loaded from [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0.

Whole transactions: median 6,815,869 cycles, p90 6,879,521, min 6,673,440, max 6,932,828. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| JoyID | 37 | 6,815,869 |
| JoyID + Nervos DAO | 3 | 6,865,437 |

### RGB++ lock

Searched for lock script `0xbc6c568a1a0d0a09f6844dc9d74ddb4343c32143ff25f727c59edf4fb72d6936` (type) in blocks 18447094 to 20947093: 1643 transactions ran it, 40 replayed, 40 matched the node.

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

Searched for lock script `0x70d64497a075bd651e98ac030455ea200637ee325a12ad08aff03f1a117e5a62` (type) in blocks 17947094 to 20947093: 20 transactions ran it, 20 replayed, 9 matched the node.

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

### iCKB logic

Searched for type script `0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3` (data1) in blocks 17947094 to 20947093: 16 transactions ran it, 16 replayed, 8 matched the node.

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

Searched for lock script `0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a` (data1) in blocks 18447094 to 20947093: 60 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| iCKB limit order | lock | 40 | 47,990 | 75,304 | 79,679 | 162,596 | [0xa183438c…ff5d63](https://explorer.nervos.org/transaction/0xa183438cdc447b05ed8868c871c0204a709b44819bfc1b6849d8e98d9cff5d63) |

Code loaded from [0xd7309191…dc8f44](https://explorer.nervos.org/transaction/0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f44) output 1.

Whole transactions: median 1,752,636 cycles, p90 7,103,276, min 1,586,021, max 8,064,887. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| iCKB limit order + secp256k1_blake160 + xUDT | 16 | 1,738,140 |
| 2 x iCKB limit order + JoyID + xUDT | 13 | 6,950,012 |
| 2 x iCKB limit order + Omnilock (Ethereum displaying) + xUDT | 4 | 1,586,203 |
| iCKB limit order + 2 x iCKB owned owner + Nervos DAO + secp256k1_blake160 + xUDT | 3 | 1,894,882 |
| 2 x iCKB limit order + 2 x iCKB owned owner + JoyID + Nervos DAO + xUDT | 1 | 7,168,979 |
| 3 other combinations | 3 | |

### iCKB owned owner

Searched for lock script `0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0` (data1) in blocks 17947094 to 20947093: 9 transactions ran it, 9 replayed, 7 matched the node.

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

Searched for type script `0x5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5` (type) in blocks 17947094 to 20947093: 155 transactions ran it, 40 replayed, 20 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| sUDT | type | 20 | 2,710 | 5,540 | 32,871 | 32,871 | [0x3cdb102e…f26eb1](https://explorer.nervos.org/transaction/0x3cdb102e8090514fa8c503a167329010415b65abbcb3cd7a6f1915b52ff26eb1) |

Code loaded from [0xc7813f6a…9936d5](https://explorer.nervos.org/transaction/0xc7813f6a415144643970c2e88e0bb6ca6a8edc5dd7c1022746f628284a9936d5) output 0.

Whole transactions: median 2,058,353 cycles, p90 3,299,135, min 439,210, max 15,166,747. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Nervos DAO + sUDT + unknown 0x29a81473…d43f + unknown 0x6fb198a4…f47f | 8 | 439,210 |
| Nervos DAO + secp256k1_blake160 + sUDT + unknown 0x6fb198a4…f47f + unknown 0x8baa01f5…74de | 5 | 2,519,591 |
| 2 x secp256k1_blake160 + sUDT | 4 | 3,290,465 |
| secp256k1_blake160 + sUDT + Type ID + unknown 0x1c04df09…e5ac + unknown 0x45c112df…6b1d + unknown 0xa9267ff5…e981 + unknown 0xede19974…f0ba + unknown 0xff022d55…2733 | 2 | 4,821,905 |
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

### anyone-can-pay

Searched for lock script `0xd369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354` (type) in blocks 18447094 to 20947093: 44 transactions ran it, 40 replayed, 40 matched the node.

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

Searched for type script `0x2c8c11c985da60b0a330c61a85507416d6382c130ba67f0c47ab071e00aec628` (data1) in blocks 17947094 to 20947093: 3 transactions ran it, 3 replayed, 0 matched the node.

Excluded:

| Transaction | Block | Verdict | Node | Measured | Reason |
|---|--:|---|--:|--:|---|
| [0xa1a96c2f…a4143c](https://explorer.nervos.org/transaction/0xa1a96c2f2f540b824fb767de0b059a6226327e13545370cea89b1683dba4143c) | 18660178 | not-recorded | - | 2,725,209 | the node reports no cycles for this transaction |
| [0x21737131…e00582](https://explorer.nervos.org/transaction/0x217371316e8abdc73a35cbbce27a9723efc75b58a8126bfba68ae4ea3ae00582) | 18636357 | not-recorded | - | 7,804,984 | the node reports no cycles for this transaction |
| [0x1ff16c40…33a37b](https://explorer.nervos.org/transaction/0x1ff16c40ab8cf8517960da69379d0b22655f13fae970c67cfa41ffc9fc33a37b) | 18635246 | not-recorded | - | 7,935,791 | the node reports no cycles for this transaction |

### COTA

Searched for type script `0x1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df` (type) in blocks 20847094 to 20947093: 61 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| COTA | type | 49 | 105,068 | 2,332,001 | 2,332,001 | 2,332,930 | [0xd9fe5ece…d153f7](https://explorer.nervos.org/transaction/0xd9fe5ece559476ff7eec1f578dc0d53bb8108c9b37026977b94f9b3379d153f7) |

Code loaded from [0x668921df…6837ab](https://explorer.nervos.org/transaction/0x668921df2836e5ce4b3c41c626aab1ee3ef9bccfa4b527abcf28a61b166837ab) output 1.

Whole transactions: median 9,296,462 cycles, p90 9,391,322, min 2,326,492, max 9,438,512. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| COTA + JoyID | 25 | 9,341,607 |
| 2 x COTA + secp256k1_blake160 + unknown 0x90ca618b…9ac7 + unknown 0xd4839251…35f6 | 9 | 2,889,624 |
| COTA + secp256k1_blake160 + unknown 0x90ca618b…9ac7 + unknown 0xd4839251…35f6 | 6 | 2,348,506 |

### d.id das-lock

Searched for lock script `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type) in blocks 20847094 to 20947093: 67 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| d.id das-lock | lock | 61 | 282,271 | 282,271 | 3,862,283 | 4,905,432 | [0x8534ddd4…befe9e](https://explorer.nervos.org/transaction/0x8534ddd45f9b214d42d7863f5fb3c5e9f119d409a63bec7ab8f60e8f55befe9e) |

Code loaded from [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0.

Whole transactions: median 1,708,845 cycles, p90 5,206,292, min 865,741, max 7,396,897. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| d.id AccountCell type + d.id BalanceCell type + 2 x d.id das-lock | 20 | 1,650,417 |
| d.id BalanceCell type + d.id das-lock | 7 | 3,813,583 |
| d.id AccountCell type + d.id das-lock | 6 | 5,206,292 |
| d.id AccountCell type + d.id das-lock + d.id IncomeCell type + secp256k1_blake160 | 3 | 3,246,870 |
| d.id AccountCell type + d.id das-lock + d.id IncomeCell type + d.id PreAccountCell type + d.id ProposalCell type + secp256k1_blake160 + unknown 0x303ead37…3078 | 2 | 4,292,792 |
| 2 other combinations | 2 | |

### Nervos DAO

Searched for type script `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type) in blocks 20927094 to 20947093: 77 transactions ran it, 40 replayed, 40 matched the node.

| Script | Role | Groups | Min | Median | p90 | Max | Example |
|---|---|--:|--:|--:|--:|--:|---|
| Nervos DAO | type | 40 | 9,930 | 11,974 | 13,826 | 1,118,658 | [0x9653adea…9251ac](https://explorer.nervos.org/transaction/0x9653adeab2f627827be1dfc389af31e9b37585e0823f230eb1781e54419251ac) |

Code loaded from [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2.

Whole transactions: median 1,669,209 cycles, p90 3,832,418, min 1,465,748, max 6,865,540. What ran with it:

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| Nervos DAO + secp256k1_blake160 | 21 | 1,659,117 |
| Nervos DAO + 2 x secp256k1_blake160 | 12 | 3,288,412 |
| JoyID + Nervos DAO | 3 | 6,865,437 |
| Nervos DAO + Omnilock (Ethereum displaying) | 3 | 1,474,044 |
| Nervos DAO + 4 x secp256k1_blake160 | 1 | 6,541,662 |

## Method and limits

- Each transaction is rebuilt as a ckb-debugger mock transaction from the node (input cells, cell deps with dep groups expanded, header deps), then every script group runs once in the native ckb-debugger, on the CKB-VM version of the transaction's epoch. Type ID is verified natively by the node and charged its fixed 1,000,000 cycles, as the node does.
- The sample is every non-cellbase transaction in a window of recent blocks, so it reflects what was busy on mainnet in that window, not all of mainnet history. A different window will give different shares.
- Names come from CCC's mainnet table of known scripts, plus a short table in scripts/atlas-lib.ts of scripts whose code hash is published elsewhere (Spore and Cluster from @ckb-ccc/spore; d.id, RGB++, iCKB and ckb-dex from their own repositories, each with its source). Scripts in neither show as unknown with their code hash; Omnilock's mode is read from the first byte of its args.
- A targeted sample is the most recent transactions in which one script ran (a lock only counts where it guards an input, since an output's lock does not run), found with the indexer RPC in a window that widens until enough are found. Busy scripts are searched one first args byte at a time, which finds the same transactions in smaller requests.
- The raw per-transaction results are in data.json next to this file.

## Reproduce

```
npm ci
npm run atlas -- --rpc https://mainnet.ckb.dev/ --to 20946673 --blocks 13789 --stride 12 --max-txs 1002
```

The targeted samples, into the same folder:

```
npm run atlas -- --out atlas/2026-11-07 --rpc https://mainnet.ckb.dev/ --to 20947093 --max-txs 40 --max-window 3000000 \
  --script xudt --script omnilock --script omnilock@0x00 --script omnilock@0x01 --script omnilock@0x04 --script omnilock@0x06 --script spore --script cluster --script dex-lock --script type-id --script joyid --script rgbpp-lock --script btc-time-lock --script ickb-logic --script ickb-limit-order --script ickb-owned-owner --script sudt --script acp --script unique-type --script cota --script das-lock --script dao
```

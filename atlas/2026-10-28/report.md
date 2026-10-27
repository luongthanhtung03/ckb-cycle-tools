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
| unknown 0xa76e227d…741d | type | 43 | 1,091,750 | 1,369,197 | 1,464,612 | 1,644,286 | 3.1% | [0x3e550def…7de025](https://explorer.nervos.org/transaction/0x3e550def34726ecbf7d4522d2cb7b5f5ba9b08b42ab41962552ba192817de025) |
| unknown 0x9e537bf5…1a79 | type | 694 | 45,041 | 45,174 | 45,175 | 45,175 | 1.6% | [0xca5c6a8f…7f1992](https://explorer.nervos.org/transaction/0xca5c6a8f682a3fb93dd16251e1b0cd9bc3b47b8461d8919637af02032c7f1992) |
| unknown 0x3a468d53…7b43 | type | 694 | 32,975 | 32,977 | 32,977 | 32,977 | 1.2% | [0xb57da046…cb6c18](https://explorer.nervos.org/transaction/0xb57da046cb5b3122b99224e62652040ac74b0b8d63c94372afc8bdefe3cb6c18) |
| JoyID | lock | 1 | 6,823,163 | 6,823,163 | 6,823,163 | 6,823,163 | 0.4% | [0xb84acdcb…6b9fc4](https://explorer.nervos.org/transaction/0xb84acdcb169564aea46c2623544bef728bed094fc8079c1ffb54d6bf746b9fc4) |
| unknown 0x4f170a04…0918 | type | 1 | 586,648 | 586,648 | 586,648 | 586,648 | 0.03% | [0x24fc5c8d…17d00f](https://explorer.nervos.org/transaction/0x24fc5c8d9928eb75726e39b3374aa0300f0d81c20bc5c147f2cfbe85eb17d00f) |
| unknown 0x9376c3b5…2137 | lock | 1 | 289,458 | 289,458 | 289,458 | 289,458 | 0.01% | [0x24fc5c8d…17d00f](https://explorer.nervos.org/transaction/0x24fc5c8d9928eb75726e39b3374aa0300f0d81c20bc5c147f2cfbe85eb17d00f) |
| Nervos DAO | type | 3 | 13,116 | 13,826 | 14,888 | 14,888 | <0.01% | [0xaebfaecd…a353e2](https://explorer.nervos.org/transaction/0xaebfaecd502136c6d567dcd22d1d01ad8fd08c61285410882c00fd4cdba353e2) |

Code hashes, and the cell each script's code was loaded from:

- secp256k1_blake160: `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 1
- unknown 0xa76e227d…741d: `0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d` (type), code in [0x1dc9a535…d8a2b8](https://explorer.nervos.org/transaction/0x1dc9a53526bb7a9a4974aa6de7636014279bff996321c9acc5180912e7d8a2b8) output 0
- unknown 0x9e537bf5…1a79: `0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79` (type), code in [0x3ba4c4b6…c905a5](https://explorer.nervos.org/transaction/0x3ba4c4b6cb70fd332d0159fa1c2ce021b361b7ccfe1acf2c44ad4902b1c905a5) output 0
- unknown 0x3a468d53…7b43: `0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43` (type), code in [0xae3197c3…dc61b3](https://explorer.nervos.org/transaction/0xae3197c306c0d0b36722773cff7dafcc8e312154826f876cec4bd94d24dc61b3) output 0
- JoyID: `0xd00c84f0ec8fd441c38bc3f87a371f547190f2fcff88e642bc5bf54b9e318323` (type), code in [0x673e1843…1355f9](https://explorer.nervos.org/transaction/0x673e1843035ce9c249efc36b62865e7a7c9f6e2ca6fc9c66fd108307e81355f9) output 0
- unknown 0x4f170a04…0918: `0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918` (type), code in [0x2455f39f…cddaba](https://explorer.nervos.org/transaction/0x2455f39ff2a655e3b02f58266b1a7b7d9efc95f2d724410aff1052717acddaba) output 0
- unknown 0x9376c3b5…2137: `0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137` (type), code in [0x7e1e87d8…3ceb0b](https://explorer.nervos.org/transaction/0x7e1e87d8a74a5dc9eae19c9e83aaefe8cbfebad7e26048d16bd25eb2283ceb0b) output 0
- Nervos DAO: `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e` (type), code in [0xe2fb1998…73ff5c](https://explorer.nervos.org/transaction/0xe2fb199810d49a4d8beec56718ba2593b665db9d52299a0f9e6e75416d73ff5c) output 2

## What ran together

Matched transactions by the scripts that ran in them ("2 x" is one script running as two groups, e.g. inputs with two different owners).

| Scripts | Transactions | Median cycles |
|---|--:|--:|
| secp256k1_blake160 + unknown 0x3a468d53…7b43 + unknown 0x9e537bf5…1a79 | 694 | 1,726,243 |
| secp256k1_blake160 | 251 | 1,641,528 |
| secp256k1_blake160 + unknown 0xa76e227d…741d | 43 | 3,041,047 |
| 2 x secp256k1_blake160 | 2 | 3,293,122 |
| 9 x secp256k1_blake160 | 2 | 14,720,839 |
| Nervos DAO + 2 x secp256k1_blake160 | 2 | 3,290,960 |
| 5 x secp256k1_blake160 | 1 | 8,219,754 |
| 68 x secp256k1_blake160 | 1 | 111,979,599 |
| 7 x secp256k1_blake160 | 1 | 11,568,395 |
| JoyID | 1 | 6,823,163 |
| 2 other combinations | 2 | |

## Excluded

None: every sampled transaction matched the node's total exactly.

## Method and limits

- Each transaction is rebuilt as a ckb-debugger mock transaction from the node (input cells, cell deps with dep groups expanded, header deps), then every script group runs once in the native ckb-debugger, on the CKB-VM version of the transaction's epoch. Type ID is verified natively by the node and charged its fixed 1,000,000 cycles, as the node does.
- The sample is every non-cellbase transaction in a window of recent blocks, so it reflects what was busy on mainnet in that window, not all of mainnet history. A different window will give different shares.
- Names come from CCC's mainnet table of known scripts, plus Spore and Cluster from @ckb-ccc/spore. Scripts it does not know show as unknown with their code hash; Omnilock's mode is read from the first byte of its args.
- The raw per-transaction results are in data.json next to this file.

## Reproduce

```
npm ci
npm run atlas -- --rpc https://mainnet.ckb.dev/ --to 20851152 --blocks 15277 --stride 12 --max-txs 1000
```

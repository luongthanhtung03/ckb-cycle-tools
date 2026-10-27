import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aggregate,
  aggregateTargeted,
  combinationOf,
  EXTRA_MAINNET_SCRIPTS,
  nameGroup,
  omnilockMode,
  percentile,
  relabel,
  renderMarkdown,
  resolveTarget,
  selectRecent,
  TARGETS,
  targetSpec,
  verdictOf,
  type AtlasMeta,
  type IndexerTx,
  type TxRecord,
} from "../scripts/atlas-lib.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/atlas-records.json", import.meta.url), "utf8")) as {
  meta: AtlasMeta;
  transactions: TxRecord[];
};

const SECP = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";
const OMNI = "0x9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26";
// What knownScriptNames(ClientPublicMainnet) returns, for the scripts used here.
const known = new Map([
  [`${SECP}:type`, "Secp256k1Blake160"],
  [`${OMNI}:type`, "OmniLock"],
  ["0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e:type", "NervosDao"],
  ["0x641a89ad2f77721b803cd50d01351c1f308444072d5fa20088567196c0574c68:type", "NostrLock"],
]);
const group = (codeHash: string, hashType = "type", args = "0x", role = "lock") => ({ role, codeHash, hashType, args });

describe("nameGroup", () => {
  it("uses the familiar names for CCC's known scripts", () => {
    expect(nameGroup(group(SECP), known)).toBe("secp256k1_blake160");
    expect(nameGroup(group("0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e", "type", "0x", "type"), known)).toBe("Nervos DAO");
    // A known script without a display name keeps CCC's.
    expect(nameGroup(group("0x641a89ad2f77721b803cd50d01351c1f308444072d5fa20088567196c0574c68"), known)).toBe("NostrLock");
  });

  it("matches code hash and hash type together", () => {
    // The same code hash under another hash type is another script.
    expect(nameGroup(group(SECP, "data1"), known)).toBe("unknown 0x9bd7e06f…cce8");
  });

  it("knows Spore and Cluster, which CCC core does not list", () => {
    expect(nameGroup(group("0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5", "data1"), known)).toBe("Spore");
    expect(nameGroup(group("0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075", "data1"), known)).toBe("Spore Cluster");
  });

  it("splits Omnilock by auth mode", () => {
    const eth = "0x01" + "ab".repeat(20) + "00";
    expect(nameGroup(group(OMNI, "type", eth), known)).toBe("Omnilock (Ethereum)");
    expect(nameGroup(group(OMNI, "type", "0x"), known)).toBe("Omnilock");
  });

  it("recognises ckb-js-vm by its binary, and names the rest by code hash", () => {
    const other = "0x" + "12".repeat(31) + "34";
    expect(nameGroup(group(other), known, "0xbeb3f510a608fbe97654da3dddb35b0214f3dcec6e252141720e9c9c32a6a461")).toBe("CKB-JS-VM");
    expect(nameGroup(group(other), known, "0x" + "00".repeat(32))).toBe("unknown 0x12121212…1234");
  });
});

describe("omnilockMode", () => {
  const args = (auth: string, flags = "00") => "0x" + auth + "cd".repeat(20) + flags;
  it("reads the auth flag and the anyone-can-pay bit", () => {
    expect(omnilockMode(args("00"))).toBe("CKB secp256k1");
    expect(omnilockMode(args("12"))).toBe("Ethereum displaying");
    expect(omnilockMode(args("06"))).toBe("CKB multisig");
    expect(omnilockMode(args("fc"))).toBe("owner lock");
    expect(omnilockMode(args("01", "02"))).toBe("Ethereum, ACP");
    expect(omnilockMode(args("77"))).toBe("auth 0x77");
  });
  it("accepts args without the flags byte, and refuses args too short to hold an auth", () => {
    expect(omnilockMode("0x01" + "cd".repeat(20))).toBe("Ethereum");
    expect(omnilockMode("0x01cd")).toBeUndefined();
  });
});

describe("percentile", () => {
  const v = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n];
  it("is nearest-rank: always an observed value", () => {
    expect(percentile(v, 50)).toBe(5n);
    expect(percentile(v, 90)).toBe(9n);
    expect(percentile(v, 100)).toBe(10n);
    expect(percentile([7n], 90)).toBe(7n);
    expect(percentile([1n, 2n, 3n], 50)).toBe(2n);
  });
  it("refuses an empty sample", () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe("verdictOf", () => {
  it("matches only when the node's total equals the sum and every group accepted", () => {
    expect(verdictOf(30n, [{ cycles: 10n, result: 0 }, { cycles: 20n, result: 0 }])).toEqual({ verdict: "match" });
    expect(verdictOf(31n, [{ cycles: 10n, result: 0 }, { cycles: 20n, result: 0 }])).toEqual({
      verdict: "mismatch",
      reason: "measured 30 vs node 31 (-1)",
    });
    expect(verdictOf(undefined, [{ cycles: 10n, result: 0 }]).verdict).toBe("not-recorded");
    expect(verdictOf(10n, [{ cycles: 10n, result: -1, error: "cycles exceeded" }])).toEqual({
      verdict: "mismatch",
      reason: "a group rejected on replay: cycles exceeded",
    });
  });
});

describe("aggregate", () => {
  const atlas = aggregate(fixture.meta, fixture.transactions);

  it("counts every record, and aggregates only the matches", () => {
    expect(atlas.summary).toEqual({ sampled: 5, matched: 3, mismatched: 1, notRecorded: 0, errors: 1 });
    expect(atlas.excluded.map((e) => [e.verdict, e.hash.slice(0, 4)])).toEqual([
      ["mismatch", "0x44"],
      ["error", "0x55"],
    ]);
    // The mismatch's 4,990,000 cycles are not in the secp256k1 row.
    const secp = atlas.scripts.find((r) => r.label === "secp256k1_blake160")!;
    expect(secp.groups).toBe(3);
    expect(secp.max).toBe("1650000");
  });

  it("gives min, median, p90, max, total and share per script", () => {
    const secp = atlas.scripts.find((r) => r.label === "secp256k1_blake160")!;
    expect(secp).toMatchObject({ min: "1600000", median: "1600000", p90: "1650000", max: "1650000", total: "4850000" });
    // 4,850,000 of 7,650,000 matched cycles.
    expect(secp.share).toBeCloseTo(4_850_000 / 7_650_000, 5);
    const total = atlas.scripts.reduce((s, r) => s + r.share, 0);
    expect(total).toBeCloseTo(1, 4);
    expect(atlas.txCycles).toEqual({ count: 3, min: "1650000", median: "1700000", p90: "4300000", max: "4300000", total: "7650000" });
  });

  it("sorts by total cycles and keeps each Omnilock mode as its own row", () => {
    expect(atlas.scripts.map((r) => r.label)).toEqual(["secp256k1_blake160", "Omnilock (Ethereum)", "xUDT"]);
  });

  it("picks the first transaction nearest the median as the example, and keeps the code cell", () => {
    const secp = atlas.scripts.find((r) => r.label === "secp256k1_blake160")!;
    expect(secp.exampleTx.slice(0, 4)).toBe("0x11");
    expect(secp.codeCell).toBe("0x71a7ba8fc96349fea0ed3a5c47992e3b4084b031a42264a018e0072e8172e46c:0");
  });

  it("groups matched transactions by the scripts that ran together", () => {
    expect(atlas.combinations).toEqual([
      { scripts: "Omnilock (Ethereum) + secp256k1_blake160", transactions: 1, medianCycles: "4300000" },
      { scripts: "secp256k1_blake160", transactions: 1, medianCycles: "1650000" },
      { scripts: "secp256k1_blake160 + xUDT", transactions: 1, medianCycles: "1700000" },
    ]);
    const twoOwners = { ...fixture.transactions[1], groups: [fixture.transactions[1].groups[0], fixture.transactions[1].groups[0]] };
    expect(combinationOf(twoOwners)).toBe("2 x secp256k1_blake160");
  });

  it("is empty but well formed with nothing matched", () => {
    const empty = aggregate(fixture.meta, fixture.transactions.filter((t) => t.verdict !== "match"));
    expect(empty.scripts).toEqual([]);
    expect(empty.txCycles.count).toBe(0);
    expect(empty.excluded).toHaveLength(2);
  });
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(aggregate(fixture.meta, fixture.transactions), { reproduce: "npm run atlas -- --to 102" });

  it("records where the numbers came from", () => {
    expect(md).toContain("https://mainnet.ckb.dev/");
    expect(md).toContain("100 to 102");
    expect(md).toContain("ckb-debugger 1.1.1");
    expect(md).toContain("npm run atlas -- --to 102");
  });

  it("has one row per script and lists every exclusion with its reason", () => {
    expect(md).toContain("| secp256k1_blake160 | lock | 3 | 1,600,000 | 1,600,000 | 1,650,000 | 1,650,000 | 63.4% |");
    expect(md).toContain("measured 4990000 vs node 5000000 (-10000)");
    expect(md).toContain("ECONNRESET");
  });

  it("shows a tiny share as under 0.01%, not as zero", () => {
    const tiny = aggregate(fixture.meta, [
      { ...fixture.transactions[0], nodeCycles: "100000000", measuredCycles: "100000000", groups: [
        { ...fixture.transactions[0].groups[0], cycles: "99999000" },
        { ...fixture.transactions[0].groups[1], cycles: "1000" },
      ] },
    ]);
    expect(renderMarkdown(tiny)).toMatch(/\| xUDT \| type \|.*\| <0\.01% \|/);
  });

  it("is plain text: no emoji or pictographs", () => {
    expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("scripts identified after the first run", () => {
  it("names the d.id time oracle, the RGB++ SPV client and d.id's account scripts by code hash and hash type", () => {
    const t = (h: string, ht = "type") => nameGroup(group(h, ht, "0x01", "type"), known);
    expect(t("0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43")).toBe("d.id time oracle (index state)");
    expect(t("0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79")).toBe("d.id time oracle (info)");
    expect(t("0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d")).toBe("Bitcoin SPV client (RGB++)");
    expect(t("0x4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918")).toBe("d.id AccountCell type");
    expect(t("0x9376c3b5811942960a846691e16e477cf43d7c7fa654067c9948dfcd09a32137")).toBe("d.id das-lock");
    expect(t("0xbc6c568a1a0d0a09f6844dc9d74ddb4343c32143ff25f727c59edf4fb72d6936")).toBe("RGB++ lock");
    // Same code hash, another hash type: not the same script.
    expect(t("0x3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43", "data1")).toMatch(/^unknown /);
  });

  it("relabels only groups recorded as unknown, and keeps every number", () => {
    const rec: TxRecord = {
      ...fixture.transactions[0],
      groups: [
        fixture.transactions[0].groups[0],
        { role: "type", codeHash: "0x9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79", hashType: "type", label: "unknown 0x9e537bf5…1a79", cycles: "45174", result: 0 },
        { role: "type", codeHash: "0x" + "ee".repeat(32), hashType: "type", label: "unknown 0xeeeeeeee…eeee", cycles: "7", result: 0 },
      ],
    };
    const [out] = relabel([rec]);
    expect(out.groups.map((g) => g.label)).toEqual(["secp256k1_blake160", "d.id time oracle (info)", "unknown 0xeeeeeeee…eeee"]);
    expect(out.groups.map((g) => g.cycles)).toEqual(["1600000", "45174", "7"]);
    expect(rec.groups[1].label).toBe("unknown 0x9e537bf5…1a79");
  });

  it("gives every naming-table entry a full lowercase code hash and a hash type", () => {
    for (const key of Object.keys(EXTRA_MAINNET_SCRIPTS)) expect(key).toMatch(/^0x[0-9a-f]{64}:(type|data|data1|data2)$/);
  });
});

describe("resolveTarget", () => {
  it("knows common scripts by name, in any case", () => {
    expect(resolveTarget("xUDT")).toEqual({ name: "xUDT", codeHash: TARGETS.xudt.codeHash, hashType: "data1", role: "type" });
    expect(resolveTarget("omnilock").role).toBe("lock");
  });

  it("narrows by an args prefix, from the spec or the defaults", () => {
    expect(resolveTarget("omnilock@0x01")).toMatchObject({ name: "Omnilock, args 0x01", args: "0x01" });
    expect(resolveTarget("omnilock", { args: "0x12" }).args).toBe("0x12");
    expect(resolveTarget("omnilock@0x").args).toBeUndefined();
    expect(() => resolveTarget("omnilock@0x1")).toThrow(/whole bytes/);
  });

  it("takes a raw code hash, with hash type and role in the spec or as defaults", () => {
    const h = "0x" + "AB".repeat(32);
    expect(resolveTarget(h)).toMatchObject({ codeHash: h.toLowerCase(), hashType: "type", role: "type" });
    expect(resolveTarget(`${h}:data2:lock@0xff`)).toMatchObject({ hashType: "data2", role: "lock", args: "0xff" });
    expect(resolveTarget(h, { hashType: "data1", role: "lock" })).toMatchObject({ hashType: "data1", role: "lock" });
    // A raw hash in the naming table gets its name.
    expect(resolveTarget("0xa76e227da81b97d23deabf0d8964aa41c042f4bcf2db2b8bd873fe8521de741d").name).toBe("Bitcoin SPV client (RGB++)");
    expect(() => resolveTarget(`${h}:data9`)).toThrow(/hash type/);
    expect(() => resolveTarget(h, { role: "both" })).toThrow(/role/);
  });

  it("refuses an unknown name and lists the known ones", () => {
    expect(() => resolveTarget("nope")).toThrow(/xudt, sudt, omnilock/);
  });

  it("round-trips through targetSpec, which the report's reproduce command uses", () => {
    for (const spec of ["spore", "omnilock@0x01", `0x${"cd".repeat(32)}:data1:lock@0x00`]) {
      const t = resolveTarget(spec);
      expect(resolveTarget(targetSpec(t))).toEqual(t);
    }
  });
});

describe("selectRecent", () => {
  const tx = (hash: string, block: number, index: number, ...cells: [string, string][]): IndexerTx => ({
    tx_hash: hash,
    block_number: "0x" + block.toString(16),
    tx_index: "0x" + index.toString(16),
    cells,
  });
  const objects = [
    tx("0xa", 100, 1, ["output", "0x0"]),
    tx("0xb", 300, 2, ["input", "0x0"]),
    tx("0xc", 300, 5, ["output", "0x1"]),
    tx("0xd", 200, 1, ["input", "0x2"], ["output", "0x0"]),
    // The same transaction from a second args bucket: merged, not counted twice.
    tx("0xa", 100, 1, ["input", "0x3"]),
  ];

  it("keeps a lock target only where it guards an input", () => {
    expect(selectRecent(objects, "lock", 10).map((t) => t.hash)).toEqual(["0xb", "0xd", "0xa"]);
  });

  it("keeps every transaction for a type target, newest first, and takes n", () => {
    expect(selectRecent(objects, "type", 10).map((t) => t.hash)).toEqual(["0xc", "0xb", "0xd", "0xa"]);
    expect(selectRecent(objects, "type", 2)).toEqual([
      { hash: "0xc", block: 300 },
      { hash: "0xb", block: 300 },
    ]);
  });
});

describe("targeted samples", () => {
  const target = resolveTarget("omnilock");
  const sample = aggregateTargeted(target, { fromBlock: 1, toBlock: 102, found: 9 }, fixture.transactions);

  it("aggregates like the random sample, but has no shares", () => {
    expect(sample.summary).toEqual({ sampled: 5, matched: 3, mismatched: 1, notRecorded: 0, errors: 1 });
    for (const r of sample.scripts) expect(r).not.toHaveProperty("share");
    expect(sample.targetRows.map((r) => r.label)).toEqual(["Omnilock (Ethereum)"]);
    expect(sample.excluded).toHaveLength(2);
  });

  it("renders as its own section, leaves the random sample's numbers alone, and lists its exclusions", () => {
    const random = aggregate(fixture.meta, fixture.transactions);
    const before = renderMarkdown(random);
    const md = renderMarkdown(
      {
        ...random,
        targeted: {
          meta: { rpcUrl: "https://mainnet.ckb.dev/", chain: "ckb", debugger: "ckb-debugger 1.1.1", toBlock: 102, maxTxs: 40, startedAt: "a", finishedAt: "b" },
          samples: [sample],
        },
      },
      { reproduce: "npm run atlas", reproduceTargeted: "npm run atlas -- --script omnilock" },
    );
    const randomPart = (s: string) => s.slice(0, s.indexOf("## Excluded"));
    expect(randomPart(md)).toBe(randomPart(before));
    const targeted = md.slice(md.indexOf("## Targeted samples"), md.indexOf("## Method and limits"));
    expect(targeted).toContain("| Omnilock: Omnilock (Ethereum) | 1 to 102 | 9 | 5 | 3 | 1 | 2,700,000 |");
    expect(targeted).toContain("### Omnilock");
    expect(targeted).toContain("measured 4990000 vs node 5000000 (-10000)");
    expect(targeted).not.toMatch(/%/);
    expect(md).toContain("npm run atlas -- --script omnilock");
    expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("says so when no transaction ran the script", () => {
    const empty = aggregateTargeted(resolveTarget("ickb-logic"), { fromBlock: 1, toBlock: 2, found: 0 }, []);
    const md = renderMarkdown({ ...aggregate(fixture.meta, []), targeted: { meta: { rpcUrl: "u", chain: "ckb", debugger: "d", toBlock: 2, maxTxs: 40, startedAt: "a", finishedAt: "b" }, samples: [empty] } });
    expect(md).toContain("| iCKB logic | 1 to 2 | 0 | 0 | 0 | 0 | | | | |");
    expect(md).toContain("No transaction in the window ran this script");
  });
});

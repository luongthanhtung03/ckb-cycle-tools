import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aggregate,
  combinationOf,
  nameGroup,
  omnilockMode,
  percentile,
  renderMarkdown,
  verdictOf,
  type AtlasMeta,
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

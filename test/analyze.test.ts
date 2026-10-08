import { describe, expect, it } from "vitest";
import { groupScripts } from "../src/analyze.js";

const script = (codeByte: string, args = "0x") => ({
  codeHash: "0x" + codeByte.repeat(32),
  hashType: "type" as const,
  args,
});

const alice = script("aa", "0x01");
const bob = script("aa", "0x02");
const token = script("cc", "0xff");

describe("groupScripts", () => {
  it("runs one lock group per distinct input lock", () => {
    const groups = groupScripts([{ lock: alice }, { lock: alice }, { lock: bob }], []);
    expect(groups.map((g) => [g.role, g.args, g.inputs])).toEqual([
      ["lock", "0x01", [0, 1]],
      ["lock", "0x02", [2]],
    ]);
  });

  it("never runs output locks", () => {
    const groups = groupScripts([{ lock: alice }], [{ lock: bob }, { lock: bob }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].args).toBe("0x01");
  });

  it("groups a type script across inputs and outputs", () => {
    const groups = groupScripts(
      [{ lock: alice, type: token }],
      [{ lock: bob, type: token }, { lock: alice }, { lock: alice, type: token }],
    );
    const type = groups.find((g) => g.role === "type")!;
    expect(type.inputs).toEqual([0]);
    expect(type.outputs).toEqual([0, 2]);
  });

  it("runs a type script that appears only in outputs (e.g. a mint)", () => {
    const groups = groupScripts([{ lock: alice }], [{ lock: alice, type: token }]);
    expect(groups.map((g) => g.role)).toEqual(["lock", "type"]);
  });

  it("keeps a lock and a type with the same script apart", () => {
    const groups = groupScripts([{ lock: token, type: token }], []);
    expect(groups.map((g) => g.role)).toEqual(["lock", "type"]);
    expect(groups[0].scriptHash).toBe(groups[1].scriptHash);
  });

  it("returns nothing for a transaction with no inputs and no typed outputs", () => {
    expect(groupScripts([], [{ lock: alice }])).toEqual([]);
  });
});

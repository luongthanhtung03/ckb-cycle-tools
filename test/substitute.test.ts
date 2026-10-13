import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import type { MockTransaction, RpcScript } from "../src/mock.js";
import { substituteBinaries } from "../src/substitute.js";

const H = (c: string) => "0x" + c.repeat(64);
const OLD = "0xc0de01";
const NEW = "0xc0de02";
const oldHash = ccc.hashCkb(OLD);
const newHash = ccc.hashCkb(NEW);
const TYPE_ID = { code_hash: H("0"), hash_type: "type", args: H("7") };
const typeHash = ccc.Script.from({ codeHash: TYPE_ID.code_hash, hashType: "type", args: TYPE_ID.args }).hash();
const plainLock: RpcScript = { code_hash: H("1"), hash_type: "type", args: "0x" };

/** One input locked by `lock`, one output locked by `lock`, the binary as a code dep. */
function mockWith(lock: RpcScript, depType: RpcScript | null = null): MockTransaction {
  const outPoint = { tx_hash: H("d"), index: "0x0" };
  return {
    mock_info: {
      inputs: [
        {
          input: { since: "0x0", previous_output: { tx_hash: H("a"), index: "0x0" } },
          output: { capacity: "0x0", lock: { ...lock }, type: null },
          data: "0x",
          header: null,
        },
      ],
      cell_deps: [
        { cell_dep: { out_point: outPoint, dep_type: "code" }, output: { capacity: "0x0", lock: plainLock, type: depType }, data: OLD, header: null },
        { cell_dep: { out_point: { tx_hash: H("e"), index: "0x0" }, dep_type: "code" }, output: { capacity: "0x0", lock: plainLock, type: null }, data: "0x99", header: null },
      ],
      header_deps: [],
    },
    tx: {
      version: "0x0",
      cell_deps: [{ out_point: outPoint, dep_type: "code" }],
      header_deps: [],
      inputs: [{ since: "0x0", previous_output: { tx_hash: H("a"), index: "0x0" } }],
      outputs: [{ capacity: "0x0", lock: { ...lock }, type: null }],
      outputs_data: ["0x"],
      witnesses: [],
    },
  };
}

describe("substituteBinaries", () => {
  it("swaps the binary of a type-referenced dep and leaves every script as it was", () => {
    const mock = mockWith({ code_hash: typeHash, hash_type: "type", args: "0x01" }, TYPE_ID);
    const { mock: out, applied } = substituteBinaries(mock, [{ name: "mine", data: NEW, codeHash: typeHash }]);
    expect(out.mock_info.cell_deps[0].data).toBe(NEW);
    expect(out.mock_info.inputs[0].output.lock.code_hash).toBe(typeHash);
    expect(out.tx).toEqual(mock.tx);
    expect(applied[0]).toMatchObject({ name: "mine", rewritten: 0, oldDataHash: oldHash, newDataHash: newHash });
    expect(applied[0].scriptKeys).toContain(`${typeHash}:type`);
  });

  it("does not modify the mock it was given", () => {
    const mock = mockWith({ code_hash: typeHash, hash_type: "type", args: "0x01" }, TYPE_ID);
    substituteBinaries(mock, [{ data: NEW, codeHash: typeHash }]);
    expect(mock.mock_info.cell_deps[0].data).toBe(OLD);
  });

  it("matches by out point, whatever the cell holds", () => {
    const mock = mockWith({ code_hash: typeHash, hash_type: "type", args: "0x" }, TYPE_ID);
    const { mock: out } = substituteBinaries(mock, [{ data: NEW, outPoint: { tx_hash: H("D"), index: "0x00" } }]);
    expect(out.mock_info.cell_deps[0].data).toBe(NEW);
    expect(out.mock_info.cell_deps[1].data).toBe("0x99");
  });

  it("rewrites data-hash scripts to the new binary's hash, and warns what that breaks", () => {
    const mock = mockWith({ code_hash: oldHash, hash_type: "data2", args: "0x" + oldHash.slice(2) });
    const { mock: out, applied } = substituteBinaries(mock, [{ data: ccc.bytesFrom(NEW), codeHash: oldHash }]);
    expect(out.mock_info.inputs[0].output.lock.code_hash).toBe(newHash);
    expect(out.tx.outputs[0].lock.code_hash).toBe(newHash);
    // The lock keeps its hash type and its args.
    expect(out.tx.outputs[0].lock).toMatchObject({ hash_type: "data2", args: "0x" + oldHash.slice(2) });
    expect(applied[0].rewritten).toBe(2);
    expect(applied[0].scriptKeys).toEqual(expect.arrayContaining([`${newHash}:data`, `${newHash}:data1`, `${newHash}:data2`]));
    expect(applied[0].warnings.join("\n")).toMatch(/transaction hash/);
    expect(applied[0].warnings.join("\n")).toMatch(/args/);
  });

  it("leaves a type-hash script alone even when it is the data hash that matched", () => {
    const mock = mockWith({ code_hash: oldHash, hash_type: "type", args: "0x" });
    const { mock: out, applied } = substituteBinaries(mock, [{ data: NEW, codeHash: oldHash }]);
    expect(out.tx.outputs[0].lock.code_hash).toBe(oldHash);
    expect(applied[0].rewritten).toBe(0);
  });

  it("changes nothing else when the binary is the same", () => {
    const mock = mockWith({ code_hash: oldHash, hash_type: "data1", args: "0x" });
    const { mock: out, applied } = substituteBinaries(mock, [{ data: OLD, codeHash: oldHash }]);
    expect(out).toEqual(mock);
    expect(applied[0]).toMatchObject({ rewritten: 0, warnings: [] });
  });

  it("refuses a substitution that matches nothing, unless told to skip it", () => {
    const mock = mockWith(plainLock);
    expect(() => substituteBinaries(mock, [{ name: "typo", data: NEW, codeHash: H("f") }])).toThrow(/typo: no code cell dep/);
    expect(substituteBinaries(mock, [{ data: NEW, codeHash: H("f") }], { skipUnmatched: true }).applied).toEqual([]);
  });

  it("never touches a dep group's cell", () => {
    const mock = mockWith(plainLock);
    mock.mock_info.cell_deps[0].cell_dep.dep_type = "dep_group";
    expect(() => substituteBinaries(mock, [{ data: NEW, codeHash: oldHash }])).toThrow(/no code cell dep/);
  });

  it("wants an out point or a code hash, not both", () => {
    const mock = mockWith(plainLock);
    expect(() => substituteBinaries(mock, [{ data: NEW }])).toThrow(/not both/);
    expect(() =>
      substituteBinaries(mock, [{ data: NEW, codeHash: oldHash, outPoint: { tx_hash: H("d"), index: "0x0" } }]),
    ).toThrow(/not both/);
  });
});

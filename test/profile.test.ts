import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOutPointVec } from "../src/mock.js";
import { parseDebuggerOutput, readTransactionJson, selectorFor } from "../src/profile.js";

describe("parseDebuggerOutput", () => {
  it("reads the result, cycles and script logs", () => {
    const out = [
      "Script log: [DEBUG] counter: 1 input(s) -> 1 output(s)",
      "Script log: [DEBUG] counter incremented 2 -> 3",
      "Run result: 0",
      "All cycles: 14022840(13.4M)",
    ].join("\n");
    expect(parseDebuggerOutput(out)).toEqual({
      result: 0,
      cycles: 14_022_840n,
      logs: ["[DEBUG] counter: 1 input(s) -> 1 output(s)", "[DEBUG] counter incremented 2 -> 3"],
    });
  });

  it("keeps a negative exit code from a rejecting script", () => {
    expect(parseDebuggerOutput("Run result: -31\nAll cycles: 1200(1.2K)").result).toBe(-31);
  });

  it("refuses output it does not understand instead of guessing", () => {
    expect(() => parseDebuggerOutput("thread 'main' panicked")).toThrow(/unexpected ckb-debugger output/);
  });
});

describe("selectorFor", () => {
  const base = { scriptHash: "0x" as const, codeHash: "0x" as const, hashType: "type" as const, args: "0x" as const };
  it("runs a lock group from its first input", () => {
    expect(selectorFor({ ...base, role: "lock", inputs: [2, 5], outputs: [] })).toBe("input.2.lock");
  });
  it("runs a type group from an input when it has one", () => {
    expect(selectorFor({ ...base, role: "type", inputs: [1], outputs: [0] })).toBe("input.1.type");
  });
  it("runs an output-only type group (a mint) from its first output", () => {
    expect(selectorFor({ ...base, role: "type", inputs: [], outputs: [3] })).toBe("output.3.type");
  });
});

describe("parseOutPointVec", () => {
  it("decodes a dep group's molecule out point vector", () => {
    const hash = "ab".repeat(32);
    const data = "0x" + "02000000" + hash + "00000000" + hash + "01000000";
    expect(parseOutPointVec(data)).toEqual([
      { tx_hash: "0x" + hash, index: "0x0" },
      { tx_hash: "0x" + hash, index: "0x1" },
    ]);
  });

  it("rejects data whose length does not match its count", () => {
    expect(() => parseOutPointVec("0x02000000" + "00".repeat(36))).toThrow(/wrong length/);
  });
});

describe("readTransactionJson", () => {
  const rpcTx = JSON.parse(readFileSync("test/fixtures/session-lock-overspend.json", "utf8"));

  it("takes the node's RPC shape as it is", () => {
    expect(readTransactionJson(JSON.stringify(rpcTx))).toEqual(rpcTx);
  });

  it("unwraps a get_transaction result", () => {
    expect(readTransactionJson(JSON.stringify({ transaction: rpcTx, tx_status: {} }))).toEqual(rpcTx);
  });

  it("converts a CCC transaction saved with ccc.stringify to the same RPC shape", () => {
    const cccTx = cccA.JsonRpcTransformers.transactionTo(rpcTx);
    const back = readTransactionJson(ccc.stringify(cccTx));
    expect(back.outputs).toEqual(rpcTx.outputs);
    expect(back.inputs).toEqual(rpcTx.inputs);
    expect(back.witnesses).toEqual(rpcTx.witnesses);
  });

  it("refuses JSON that is not a transaction", () => {
    expect(() => readTransactionJson('{"hello":1}')).toThrow(/not a CKB transaction/);
  });
});

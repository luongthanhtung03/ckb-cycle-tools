import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mockFromTransaction, parseOutPointVec, type Rpc } from "../src/mock.js";
import { parseDebuggerOutput, parseNames, readTransactionJson, selectorFor } from "../src/profile.js";

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

describe("mockFromTransaction", () => {
  const H = (c: string) => "0x" + c.repeat(64);
  const cellTx = (block: string | null) => ({
    transaction: {
      outputs: [{ capacity: "0x0", lock: { code_hash: H("1"), hash_type: "type", args: "0x" }, type: null }],
      outputs_data: ["0x"],
    },
    cycles: null,
    tx_status: { status: block ? "committed" : "pending", block_hash: block },
  });
  const rpc: Rpc = async <T>(method: string, params: unknown[]) => {
    if (method === "get_header") return { hash: params[0] } as T;
    return cellTx(params[0] === H("a") ? H("b") : null) as T;
  };
  const tx = (prev: string) => ({
    version: "0x0",
    cell_deps: [{ out_point: { tx_hash: H("a"), index: "0x0" }, dep_type: "code" as const }],
    header_deps: [H("b")],
    inputs: [{ since: "0x0", previous_output: { tx_hash: prev, index: "0x0" } }],
    outputs: [],
    outputs_data: [],
    witnesses: [],
  });

  it("gives each input and dep the block it was created in, so load_header(Input) works", async () => {
    const mock = await mockFromTransaction(rpc, tx(H("a")));
    expect(mock.mock_info.inputs[0].header).toBe(H("b"));
    expect(mock.mock_info.cell_deps[0].header).toBe(H("b"));
    expect(mock.mock_info.header_deps).toEqual([{ hash: H("b") }]);
  });

  it("leaves the header empty for a cell not yet in a block", async () => {
    const mock = await mockFromTransaction(rpc, tx(H("c")));
    expect(mock.mock_info.inputs[0].header).toBeNull();
  });
});

describe("parseNames (--name)", () => {
  const h = "0x" + "AB".repeat(32);
  const lower = h.toLowerCase();

  it("names one hash type when given", () => {
    expect(parseNames([`${h}:type=campaign-lock`])).toEqual({ [`${lower}:type`]: "campaign-lock" });
  });

  it("names every hash type when none is given", () => {
    const names = parseNames([`${h}=campaign-lock`]);
    expect(Object.keys(names).sort()).toEqual(["data", "data1", "data2", "type"].map((t) => `${lower}:${t}`));
  });

  it("keeps an = inside the label", () => {
    expect(parseNames([`${h}:data2=a=b`])).toEqual({ [`${lower}:data2`]: "a=b" });
  });

  it.each(["campaign-lock", `${h}`, `${h}:weird=x`, `0x12=x`])("rejects %s", (flag) => {
    expect(() => parseNames([flag])).toThrow(/--name expects/);
  });
});

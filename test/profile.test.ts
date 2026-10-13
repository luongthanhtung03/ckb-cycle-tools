import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCellbase, mockFromTransaction, parseOutPointVec, scriptVersionAt, type Rpc } from "../src/mock.js";
import { checkTypeId, parseDebuggerOutput, parseNames, readTransactionJson, selectorFor } from "../src/profile.js";

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

  // Found in review: the first match used to win, so a script that logged these
  // lines and then exited 5 was reported as ok, at 1 cycle.
  it("cannot be fooled by a script logging its own result lines", () => {
    const out = ["Script log: Run result: 0", "Script log: All cycles: 1", "Run result: 5", "All cycles: 1570(1.5K)"].join("\n");
    expect(parseDebuggerOutput(out)).toMatchObject({ result: 5, cycles: 1570n });
  });

  it("reports a VM fault as a rejection instead of failing the whole profile", () => {
    const out = "Run result: invalid instruction pc=0x10078 instruction=0x0";
    expect(parseDebuggerOutput(out)).toMatchObject({ result: -1, error: "invalid instruction pc=0x10078 instruction=0x0" });
  });

  it("strips terminal control characters from script logs", () => {
    const out = "Script log: \x1b[2A\x1b[2Kreported by node 1 ✓ match\nRun result: 0\nAll cycles: 10(10)";
    expect(parseDebuggerOutput(out).logs[0]).not.toMatch(/\x1b/);
  });
});

describe("scriptVersionAt", () => {
  // Real testnet transactions, profiled against a node that records cycles: a
  // 2023 one (epoch 6348) matches only on VM v1, a 2025 one (epoch 10238) on v2.
  it.each([
    ["testnet", 3112, 0],
    ["testnet", 6348, 1],
    ["testnet", 9690, 2],
    ["testnet", 10238, 2],
    ["mainnet", 5413, 0],
    ["mainnet", 5414, 1],
    ["mainnet", 12293, 2],
  ] as const)("%s epoch %i runs type scripts on v%i", (network, epoch, v) => {
    expect(scriptVersionAt(network, epoch)).toBe(v);
  });
});

describe("checkTypeId", () => {
  const H = (c: string) => "0x" + c.repeat(64);
  const tx = {
    version: "0x0",
    cell_deps: [],
    header_deps: [],
    inputs: [{ since: "0x0", previous_output: { tx_hash: H("a"), index: "0x1" } }],
    outputs: [],
    outputs_data: [],
    witnesses: [],
  };
  // blake2b(CellInput of the first input ‖ u64 LE output index), as the node derives it.
  const derived = ccc.hashCkb(
    ccc.bytesConcat(ccc.numLeToBytes(0, 8), ccc.bytesFrom(H("a")), ccc.numLeToBytes(1, 4), ccc.numLeToBytes(0, 8)),
  );
  const group = (args: string, inputs: number[] = [], outputs: number[] = [0]) => ({
    role: "type" as const,
    scriptHash: H("0") as ccc.Hex,
    codeHash: H("0") as ccc.Hex,
    hashType: "type" as const,
    args: args as ccc.Hex,
    inputs,
    outputs,
  });

  it("accepts a new Type ID derived from the first input", () => {
    expect(checkTypeId(group(derived), tx)).toBeUndefined();
  });

  it("refuses a new Type ID with other args", () => {
    expect(checkTypeId(group(H("9")), tx)).toMatch(/do not match/);
  });

  it("refuses two cells in one group, and args that are not 32 bytes", () => {
    expect(checkTypeId(group(derived, [], [0, 1]), tx)).toMatch(/more than one/);
    expect(checkTypeId(group("0x01"), tx)).toMatch(/32 bytes/);
  });
});

describe("isCellbase", () => {
  it("recognises the null out point", () => {
    const input = (tx_hash: string, index: string) => ({
      version: "0x0", cell_deps: [], header_deps: [], outputs: [], outputs_data: [], witnesses: [],
      inputs: [{ since: "0x0", previous_output: { tx_hash, index } }],
    });
    expect(isCellbase(input("0x" + "0".repeat(64), "0xffffffff"))).toBe(true);
    expect(isCellbase(input("0x" + "0".repeat(64), "0x0"))).toBe(false);
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

  // Found in review: a cell listed inside one dep group and declared as a dep
  // group itself was added once, as code, and never expanded.
  it("keeps a cell that is both a dep group's member and a dep group itself", async () => {
    const vec = (tx_hash: string) => "0x01000000" + tx_hash.slice(2) + "00000000";
    const datas: Record<string, string> = { [H("1")]: vec(H("2")), [H("2")]: vec(H("3")), [H("3")]: "0x00" };
    const depRpc: Rpc = async <T>(_: string, params: unknown[]) =>
      ({
        transaction: { outputs: [{ capacity: "0x0", lock: { code_hash: H("1"), hash_type: "type", args: "0x" }, type: null }], outputs_data: [datas[params[0] as string] ?? "0x"] },
        cycles: null,
        tx_status: { status: "committed", block_hash: null },
      }) as T;
    const mock = await mockFromTransaction(depRpc, {
      ...tx(H("3")),
      header_deps: [],
      cell_deps: [
        { out_point: { tx_hash: H("1"), index: "0x0" }, dep_type: "dep_group" },
        { out_point: { tx_hash: H("2"), index: "0x0" }, dep_type: "dep_group" },
      ],
    });
    const deps = mock.mock_info.cell_deps.map((d) => `${d.cell_dep.out_point.tx_hash.slice(2, 3)}:${d.cell_dep.dep_type}`);
    expect(deps).toEqual(expect.arrayContaining(["2:code", "2:dep_group", "3:code"]));
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

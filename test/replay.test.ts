import { readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import type { MockTransaction } from "../src/mock.js";
import {
  checkMockTransaction,
  debuggerArgs,
  groupsOf,
  nodeOrder,
  nodeStop,
  nodeVerdict,
  replayGroups,
  sumLines,
  TYPE_ID_CODE_HASH,
  type Profile,
  type ReplayPlan,
} from "../src/replay.js";

const H = (c: string) => "0x" + c.repeat(64);
const lock = { code_hash: H("1"), hash_type: "type", args: "0x" };
const counter = { code_hash: H("2"), hash_type: "data2", args: "0x" };
const input = (tx_hash: string, index = "0x0") => ({ since: "0x0", previous_output: { tx_hash, index } });
const cell = (type: typeof counter | null = null) => ({ capacity: "0x0", lock, type });

function mockOf(inputs: ReturnType<typeof cell>[], outputs: ReturnType<typeof cell>[]): MockTransaction {
  return {
    mock_info: {
      inputs: inputs.map((output, i) => ({ input: input(H("a"), `0x${i}`), output, data: "0x", header: null })),
      cell_deps: [],
      header_deps: [],
    },
    tx: {
      version: "0x0",
      cell_deps: [],
      header_deps: [],
      inputs: inputs.map((_, i) => input(H("a"), `0x${i}`)),
      outputs,
      outputs_data: outputs.map(() => "0x"),
      witnesses: [],
    },
  };
}

const plan = (mock: MockTransaction, extra: Partial<ReplayPlan> = {}): ReplayPlan => ({
  hash: H("f"),
  status: "committed",
  mock,
  groups: groupsOf(mock),
  scriptVersion: 1,
  network: "testnet",
  rpcUrl: "(test)",
  ...extra,
});

describe("checkMockTransaction", () => {
  it("accepts a plain mock, and refuses template directives and non-hex fields anywhere", () => {
    const ok = mockOf([cell(counter)], [cell()]);
    expect(() => checkMockTransaction(ok)).not.toThrow();
    const bad = (edit: (m: MockTransaction) => void) => {
      const m = structuredClone(ok);
      edit(m);
      return () => groupsOf(m);
    };
    expect(bad((m) => (m.mock_info.inputs[0].data = "{{ data /etc/passwd }}"))).toThrow(/mock_info\.inputs\[0\]\.data contains "\{\{"/);
    expect(bad((m) => (m.tx.outputs_data[0] = "0x{{ hash ../key }}"))).toThrow(/\{\{/);
    expect(bad((m) => ((m.tx as unknown as Record<string, unknown>)["{{ def_type x }}"] = "0x"))).toThrow(/\{\{/);
    expect(bad((m) => (m.tx.version = "0xzz"))).toThrow(/tx\.version is not 0x-prefixed hex/);
    expect(bad((m) => (m.tx.outputs[0].lock.hash_type = "data9 "))).toThrow(/is not a hash_type/);
  });
});

describe("groupsOf", () => {
  it("groups input locks, and type scripts across inputs and outputs", () => {
    const groups = groupsOf(mockOf([cell(counter), cell()], [cell(counter), cell()]));
    expect(groups.map((g) => [g.role, g.inputs, g.outputs])).toEqual([
      ["lock", [0, 1], []],
      ["type", [0], [0]],
    ]);
  });

  it("runs nothing for a cellbase", () => {
    const mock = mockOf([], [cell()]);
    mock.tx.inputs = [input(H("0"), "0xffffffff")];
    expect(groupsOf(mock)).toEqual([]);
  });
});

describe("replayGroups", () => {
  it("runs each group once, from its first cell, on the plan's VM version", async () => {
    const calls: string[][] = [];
    const outputs = ["Run result: 0\nAll cycles: 1000(1K)", "Script log: hi\nRun result: 0\nAll cycles: 20(20)"];
    const seen: string[] = [];
    const p = await replayGroups(
      plan(mockOf([cell(counter)], [cell(counter)]), { nodeCycles: 1020n }),
      async (args) => {
        calls.push(args);
        return outputs[calls.length - 1];
      },
      { txFile: "/tx.json", debugger: "ckb-debugger x", onGroup: (i, s) => seen.push(`${i}:${s}`) },
    );
    expect(calls).toEqual([debuggerArgs("/tx.json", "input.0.lock", 1), debuggerArgs("/tx.json", "input.0.type", 1)]);
    expect(calls[0]).toEqual(["--tx-file", "/tx.json", "--script", "input.0.lock", "--script-version", "1"]);
    expect(seen).toEqual(["0:input.0.lock", "1:input.0.type"]);
    expect(p.groups.map((g) => [g.selector, g.cycles, g.logs])).toEqual([
      ["input.0.lock", 1000n, []],
      ["input.0.type", 20n, ["hi"]],
    ]);
    expect(p).toMatchObject({ measuredCycles: 1020n, nodeCycles: 1020n, env: { debugger: "ckb-debugger x", scriptVersion: 1 } });
    expect(nodeVerdict(p)).toBe("match");
  });

  it("checks each run's result lines against its exit code", async () => {
    const runs = [
      { stdout: "Script log: x\nRun result: 0\nAll cycles: 1(1)\n", stderr: "", exitCode: 254 },
      { stdout: "Run result: 0\nAll cycles: 20(20)\n", stderr: "", exitCode: 0 },
    ];
    let i = 0;
    const p = await replayGroups(plan(mockOf([cell(counter)], [cell(counter)])), async () => runs[i++], {
      txFile: "/tx.json",
      debugger: "x",
    });
    expect(p.groups.map((g) => [g.result, g.error === undefined])).toEqual([
      [-1, false],
      [0, true],
    ]);
  });

  it("charges Type ID its fixed cost and checks it, without running the debugger", async () => {
    const typeId = { code_hash: TYPE_ID_CODE_HASH, hash_type: "type", args: H("9") };
    const mock = mockOf([cell()], [{ capacity: "0x0", lock, type: typeId }]);
    let runs = 0;
    const p = await replayGroups(plan(mock), async () => (runs++, "Run result: 0\nAll cycles: 5(5)"), {
      txFile: "/tx.json",
      debugger: "x",
    });
    expect(runs).toBe(1);
    expect(p.groups[1]).toMatchObject({ name: "TypeId (built in)", cycles: 1_000_000n, result: -1 });
    expect(p.groups[1].error).toMatch(/do not match/);
  });
});

describe("nodeVerdict", () => {
  const p = (nodeCycles: bigint | undefined, status = "committed") =>
    ({ status, measuredCycles: 10n, ...(nodeCycles !== undefined && { nodeCycles }) }) as Profile;
  it.each([
    [10n, "committed", "match"],
    [11n, "committed", "mismatch"],
    [undefined, "committed", "not recorded"],
    [undefined, "not on chain", undefined],
  ] as const)("node %s, %s → %s", (n, status, verdict) => {
    expect(nodeVerdict(p(n, status))).toBe(verdict);
  });
});

// The browser imports these; a Node built-in or Buffer anywhere in them breaks the page.
// Review #46, point 7a: each group runs on its own here, but the node verifies
// groups in its own order and stops at the first failing one (ckb-script
// TransactionScriptsVerifier::verify; order from TxData::new / TxInfo::groups:
// lock groups, then type groups, each a BTreeMap keyed by script hash).
describe("node order and where the node stops", () => {
  const lockOf = (args: string) => ({ code_hash: H("1"), hash_type: "type", args });
  const at = (l: ReturnType<typeof lockOf>, type: typeof counter | null = null) => ({ capacity: "0x0", lock: l, type });
  const hashOf = (l: ReturnType<typeof lockOf>) =>
    ccc.Script.from({ codeHash: l.code_hash, hashType: l.hash_type as ccc.HashType, args: l.args }).hash();
  // Two locks, named by which hash is smaller, so the test holds whichever it is.
  const [low, high] = [lockOf("0x01"), lockOf("0x02")].sort((a, b) => (hashOf(a) < hashOf(b) ? -1 : 1));

  it("puts every lock group before every type group, each by script hash", () => {
    // First appearance: high lock, counter type, low lock.
    const groups = groupsOf(mockOf([at(high, counter), at(low)], []));
    expect(groups.map((g) => g.role)).toEqual(["lock", "type", "lock"]);
    expect(nodeOrder(groups).map((g) => [g.role, g.scriptHash])).toEqual([
      ["lock", hashOf(low)],
      ["lock", hashOf(high)],
      ["type", groups[1].scriptHash],
    ]);
  });

  /** Replays `mock` with a debugger that answers each selector with `codes` (default 0), 100 cycles each. */
  const replay = (mock: MockTransaction, codes: Record<string, number>) =>
    replayGroups(
      plan(mock),
      async (args) => {
        const code = codes[args[args.indexOf("--script") + 1]] ?? 0;
        return { stdout: `Run result: ${code}\nAll cycles: 100(0.0M)\n`, stderr: "", exitCode: code === 0 ? 0 : 254 };
      },
      { txFile: "/tx.json", debugger: "x" },
    );

  it("marks the first failing group in the node's order, and the groups the node never runs", async () => {
    // Shown first, the type rejects; but the node runs both locks before any type,
    // and the low lock (input.1) rejects too: the node stops there.
    const p = await replay(mockOf([at(high, counter), at(low)], []), { "input.0.type": 5, "input.1.lock": 7 });
    expect(p.nodeStopsAt).toBe("input.1.lock");
    expect(p.groups.map((g) => [g.selector, g.nodeReaches])).toEqual([
      ["input.0.lock", false],
      ["input.0.type", false],
      ["input.1.lock", true],
    ]);
    // Every group still ran here, and the sum still counts them all.
    expect(p.measuredCycles).toBe(300n);
  });

  it("counts a VM stop as a failure, and reaches every group up to it", async () => {
    const p = await replayGroups(
      plan(mockOf([at(low, counter), at(high)], [])),
      async (args) =>
        args.includes("input.0.type")
          ? { stdout: "Run result: Invalid instruction\n", stderr: "", exitCode: 254 }
          : { stdout: "Run result: 0\nAll cycles: 100(0.0M)\n", stderr: "", exitCode: 0 },
      { txFile: "/tx.json", debugger: "x" },
    );
    expect(p.nodeStopsAt).toBe("input.0.type");
    expect(p.groups.every((g) => g.nodeReaches === true)).toBe(true);
  });

  it("adds nothing when every group accepts", async () => {
    const p = await replay(mockOf([at(high, counter), at(low)], []), {});
    expect(p.nodeStopsAt).toBeUndefined();
    expect(p.groups.some((g) => "nodeReaches" in g)).toBe(false);
    expect(nodeStop(p.groups)).toBeUndefined();
    expect(sumLines(p)).toEqual(["measured (sum of groups)  300"]);
  });

  it("labels a rejected transaction's sum as each group on its own, not what the node spent", async () => {
    const p = await replay(mockOf([at(high, counter), at(low)], []), { "input.0.type": 5, "input.1.lock": 7 });
    p.groups[2].name = "my-lock";
    const text = sumLines(p).join("\n");
    expect(text).not.toContain("measured (sum of groups)");
    expect(text).toMatch(/^sum of groups, each run on its own {2}300\n/);
    expect(text).toContain("not what the node spends: it stops at the first failing group, input.1.lock (my-lock),");
    expect(text).toContain("reports no cycles for a rejected tx");
    expect(text).toContain("the node never runs: input.0.lock, input.0.type");
  });
});

describe("browser-safe modules", () => {
  const safe = ["analyze", "mock", "replay", "wasm"];
  it.each(safe)("src/%s.ts uses no Node built-ins and imports only browser-safe modules", (name) => {
    // Code only: comments may mention what the module avoids.
    const src = readFileSync(`src/${name}.ts`, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/from "node:|require\(|\bBuffer\b|\bprocess\./);
    for (const [, rel] of src.matchAll(/from "\.\/(\w+)\.js"/g)) expect(safe).toContain(rel);
  });
});

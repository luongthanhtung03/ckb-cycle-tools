import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  flameTree,
  foldedTotal,
  formatFolded,
  frameName,
  functionCosts,
  parseFolded,
  profiledCycles,
  renderFlameSvg,
  splitStack,
} from "../src/flame.js";

// ckb-debugger 1.1.1 --enable-flamegraph on input.0.lock of a subscription charge
// on testnet (0x50ae6df4…), run with an unstripped build of the session lock.
const RAW = readFileSync("test/fixtures/session-lock-charge.flamegraph.txt", "utf8");

describe("frameName", () => {
  it("drops the source path, Windows or Unix, and keeps the function", () => {
    expect(frameName(String.raw` E:\src\ckb-session-kit\contracts\session-lock\src\main.rs:session_lock::lock_hash`)).toBe(
      "session_lock::lock_hash",
    );
    expect(frameName("/rustc/b940084d/library/compiler-builtins/src/mem/impls.rs:memset")).toBe("memset");
  });

  it("keeps the address of a frame without symbols", () => {
    expect(frameName("??:func_0x114e4")).toBe("func_0x114e4");
  });
});

describe("splitStack", () => {
  it("does not split inside a Rust type: [u8; 32] is one name", () => {
    expect(splitStack("main;session_lock::each::<[u8; 32], f>;lock_hash")).toEqual([
      "main",
      "session_lock::each::<[u8; 32], f>",
      "lock_hash",
    ]);
  });
});

describe("parseFolded on real ckb-debugger output", () => {
  const folded = parseFolded(RAW);

  it("merges the repeated stacks and keeps every cycle", () => {
    const raw = RAW.split(/\r?\n/).filter(Boolean);
    expect(folded.size).toBeLessThan(raw.length);
    expect(foldedTotal(folded)).toBe(19_187n); // what ckb-debugger printed as "All cycles"
  });

  it("names the session lock's own functions", () => {
    const costs = functionCosts(folded);
    expect(costs[0]).toMatchObject({ name: "session_lock::lock_hash", self: 4_490n, total: 5_972n });
    const main = costs.find((c) => c.name === "__ckb_std_main");
    expect(main?.total).toBe(18_678n);
    expect(costs.find((c) => c.name.startsWith("session_lock::each::<[u8; 32]"))).toBeDefined();
  });

  it("writes merged folded text that parses back to the same stacks", () => {
    expect(parseFolded(formatFolded(folded))).toEqual(folded);
  });
});

describe("flameTree and renderFlameSvg", () => {
  const folded = parseFolded("a;b 30\na;c 10\nd 60\n");

  it("sums every stack through a node, heaviest child first", () => {
    const t = flameTree(folded);
    expect(t.value).toBe(100n);
    expect(t.children.map((c) => [c.name, c.value])).toEqual([
      ["d", 60n],
      ["a", 40n],
    ]);
    expect(t.children[1].children.map((c) => c.name)).toEqual(["b", "c"]);
  });

  it("counts a recursive function's total once per stack", () => {
    expect(functionCosts(parseFolded("f;f;f 10")).find((c) => c.name === "f")).toEqual({ name: "f", self: 10n, total: 10n });
  });

  it("draws one frame per node, with escaped names and the cycles in each tooltip", () => {
    const svg = renderFlameSvg(flameTree(parseFolded("main;each::<[u8; 32], F> 75\nmain 25")), { title: "a<b>" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("a&lt;b&gt;");
    expect(svg).toContain("each::&lt;[u8; 32], F&gt; — 75 cycles (75.0%)");
    expect(svg.match(/<rect x=/g)).toHaveLength(3); // all, main, each
  });
});

describe("profiledCycles", () => {
  it("reads the All cycles line of a flamegraph run", () => {
    expect(profiledCycles("Run result: 0\nAll cycles: 19187(18.7K)\n")).toBe(19_187n);
    expect(profiledCycles("Run result: 0\n")).toBeUndefined();
  });
});

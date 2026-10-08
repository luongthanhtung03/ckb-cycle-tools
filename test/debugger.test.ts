import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DebuggerNotFoundError, resolveDebugger } from "../src/debugger.js";

const only = (...paths: string[]) => (p: string) => paths.includes(p);

describe("resolveDebugger", () => {
  it("prefers CKB_DEBUGGER_PATH when it exists", () => {
    const path = "/opt/ckb/ckb-debugger";
    expect(
      resolveDebugger({
        env: { CKB_DEBUGGER_PATH: path, PATH: "/usr/bin" },
        platform: "linux",
        exists: only(path, join("/usr/bin", "ckb-debugger")),
      }),
    ).toBe(path);
  });

  it("refuses a CKB_DEBUGGER_PATH that does not exist instead of falling back", () => {
    expect(() =>
      resolveDebugger({
        env: { CKB_DEBUGGER_PATH: "/missing", PATH: "/usr/bin" },
        platform: "linux",
        exists: only(join("/usr/bin", "ckb-debugger")),
      }),
    ).toThrow(DebuggerNotFoundError);
  });

  it("finds the binary on PATH", () => {
    const hit = join("/home/me/.ckb-tools", "ckb-debugger");
    expect(
      resolveDebugger({
        env: { PATH: "/usr/bin:/home/me/.ckb-tools" },
        platform: "linux",
        exists: only(hit),
      }),
    ).toBe(hit);
  });

  it("on Windows, ignores the offckb .cmd shim and finds the real .exe", () => {
    const npmDir = "C:\\Users\\me\\AppData\\Roaming\\npm";
    const local = "C:\\Users\\me\\AppData\\Local";
    const exe = join(local, "offckb-nodejs", "Data", "tools", "ckb-debugger.exe");
    expect(
      resolveDebugger({
        env: { Path: npmDir, LOCALAPPDATA: local },
        platform: "win32",
        // Only the shim is on PATH — exactly the Week 1 situation.
        exists: only(join(npmDir, "ckb-debugger.cmd"), exe),
      }),
    ).toBe(exe);
  });

  it("lists every place it looked when nothing is found", () => {
    try {
      resolveDebugger({ env: { PATH: "/a:/b" }, platform: "linux", exists: () => false });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DebuggerNotFoundError);
      expect((e as DebuggerNotFoundError).searched).toEqual([
        join("/a", "ckb-debugger"),
        join("/b", "ckb-debugger"),
      ]);
    }
  });
});

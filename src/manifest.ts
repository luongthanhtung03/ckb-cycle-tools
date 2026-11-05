/**
 * What a report's numbers were measured with, so two reports can be checked for
 * comparability (review #46, point 4): the tool, the debugger binary, the
 * commit, the toolchain, and per scenario the CKB-VM version, a hash of its
 * inputs and the binaries swapped into it. Node only (hashes files, runs git);
 * the shape is in diff.ts, which compares it.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ScenarioConfig } from "./report.js";

export const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** The sha256 and size of a file, read as a stream (a debugger binary is tens of MB). */
export function fileDigest(path: string): Promise<{ sha256: string; size: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let size = 0;
    createReadStream(path)
      .on("data", (chunk) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        size += bytes.length;
        hash.update(bytes);
      })
      .on("error", reject)
      .on("end", () => resolve({ sha256: hash.digest("hex"), size }));
  });
}

/** This package's name and version, from its package.json ("unknown" if it cannot be read). */
export async function toolIdentity(): Promise<{ name: string; version: string }> {
  try {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    return { name: String(pkg.name ?? "ckb-cycle-tools"), version: String(pkg.version ?? "unknown") };
  } catch {
    return { name: "ckb-cycle-tools", version: "unknown" };
  }
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * The commit checked out at `dir`, or undefined: not a git checkout, no git, or
 * anything else. Never fails the report. Only a commit id is kept, whatever git printed.
 */
export function gitCommit(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        { cwd: dir, timeout: 10_000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } },
        (err, stdout) => {
          const out = String(stdout ?? "").trim().toLowerCase();
          resolve(!err && COMMIT.test(out) ? out : undefined);
        },
      );
    } catch {
      resolve(undefined);
    }
  });
}

/** JSON with object keys sorted at every level: the same value always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The part of a scenario's cycles.json entry that decides what runs: its form
 * (and transaction hash), the binaries it names, its CKB-VM version, and for a
 * transaction fetched from a node, the network. Not its name (the key it is
 * matched by), the path of its file (whose bytes are hashed instead: a moved
 * file with the same bytes is the same input), nor `functions` (which records
 * names, not cycles).
 */
export function scenarioInputs(s: ScenarioConfig, network: string | undefined): Record<string, unknown> {
  const kind = s.mock !== undefined ? "mock" : s.file !== undefined ? "file" : "tx";
  return {
    kind,
    ...(s.tx !== undefined && { tx: s.tx.toLowerCase() }),
    ...(s.binaries !== undefined && { binaries: [...s.binaries].sort() }),
    ...(s.scriptVersion !== undefined && { scriptVersion: s.scriptVersion }),
    ...(kind !== "mock" && { network: network ?? null }),
  };
}

/**
 * sha256 over a scenario's inputs: the canonical entry (scenarioInputs), then
 * the bytes of its mock or transaction file exactly as read, if it has one.
 */
export function inputsHash(entry: Record<string, unknown>, file?: Uint8Array): string {
  const h = createHash("sha256");
  h.update("ckb-cycles inputs v1\n");
  h.update(canonicalJson(entry));
  h.update("\n");
  if (file) h.update(file);
  return h.digest("hex");
}

/** The longest toolchain description a report keeps. */
export const TOOLCHAIN_MAX = 4096;

/** A toolchain description as a report keeps it: trimmed, clipped; undefined when empty. */
export function toolchainOf(s: string | undefined): string | undefined {
  const t = (s ?? "").trim();
  return t ? (t.length > TOOLCHAIN_MAX ? `${t.slice(0, TOOLCHAIN_MAX - 1)}…` : t) : undefined;
}

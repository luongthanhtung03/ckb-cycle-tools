import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** The `run:` script of one step of action/action.yml, dedented. */
function stepScript(name: string): string {
  const lines = readFileSync("action/action.yml", "utf8").split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const run = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  const body: string[] = [];
  for (const l of lines.slice(run + 1)) {
    if (l.trim() && !l.startsWith("        ")) break;
    body.push(l.slice(8));
  }
  return body.join("\n");
}

const bash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";
let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/**
 * Runs the sticky-comment step with a fake `gh` (and `sleep`) on PATH: `ids` is
 * what the comment listing prints ("FAIL" makes the listing fail), and PATCH fails
 * `patchFails` times.
 * Returns the gh calls made and the step's output.
 */
function postComment(ids: string, patchFails: number) {
  dir = mkdtempSync(join(tmpdir(), "ckb-action-"));
  const fake = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  fake(
    "gh",
    [
      'echo "$*" >> "$FAKE_DIR/calls"',
      'case "$*" in',
      "  'api user'*) exit 1 ;;",
      '  *--paginate*) [ "$FAKE_IDS" != FAIL ] || exit 1; printf "%s" "$FAKE_IDS" ;;',
      '  *PATCH*) n=$(cat "$FAKE_DIR/patched" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_DIR/patched"; [ "$n" -ge "$FAKE_PATCH_FAILS" ] ;;',
      "esac",
    ].join("\n"),
  );
  fake("sleep", "true");
  writeFileSync(join(dir, "comment.md"), "<!-- ckb-cycles-report -->\n");
  writeFileSync(join(dir, "calls"), "");
  // As GitHub runs a `shell: bash` step.
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", stepScript("Post the sticky comment")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      FAKE_DIR: dir,
      FAKE_IDS: ids,
      FAKE_PATCH_FAILS: String(patchFails),
      GITHUB_REPOSITORY: "o/r",
      PR: "7",
      BODY: join(dir, "comment.md"),
      GH_TOKEN: "x",
    },
  });
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  return { status: r.status, out: r.stdout, verbs: calls.map((c) => /-X (\w+)/.exec(c)?.[1]).filter(Boolean) };
}

// Each case starts bash a few times, which takes seconds on a Windows runner.
describe.skipIf(!bash)("action.yml: the sticky comment", { timeout: 60_000 }, () => {
  it("posts a new comment when there is none", () => {
    expect(postComment("", 0)).toMatchObject({ status: 0, verbs: ["POST"] });
  });

  it("updates the existing comment, and never posts a second one when the update fails", () => {
    expect(postComment("11\n12", 0)).toMatchObject({ status: 0, verbs: ["PATCH"] });
    expect(postComment("11", 1)).toMatchObject({ status: 0, verbs: ["PATCH", "PATCH"] });
    const failed = postComment("11", 9);
    expect(failed.verbs).toEqual(["PATCH", "PATCH", "PATCH"]);
    expect(failed.out).toContain("::warning::could not update the cycle report comment 11");
  });

  it("posts nothing when the comments cannot be listed", () => {
    const r = postComment("FAIL", 0);
    expect(r).toMatchObject({ status: 0, verbs: [] });
    expect(r.out).toContain("::warning::could not list the pull request's comments");
  });
});

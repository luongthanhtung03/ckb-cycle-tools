"use client";

import { ccc } from "@ckb-ccc/core";
import { analyzeTransaction, type ScriptGroup, type TxAnalysis } from "ckb-cycle-tools/analyze";
import type { Profile, ProfiledGroup } from "ckb-cycle-tools/replay";
import { Fragment, useEffect, useMemo, useState } from "react";
import { loadDebugger } from "./debugger";
import { Flame } from "./Flame";
import { Prompt, Terminal } from "./Terminal";

const explorerTx = (h: string) => `https://testnet.explorer.nervos.org/transaction/${h}`;
const short = (h: string, n = 8) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
const fmt = (n: bigint) => n.toLocaleString("en-US");

// Baseline for comparison: a 1-input, 2-output secp256k1 transfer on testnet
// (the first example below), as measured by the node.
const BASELINE = 1_657_727n;

// Real testnet transactions from my CKBuilder work, so the page has something to
// show before anyone pastes a hash.
const EXAMPLES = [
  { label: "transfer", hash: "0x52a1b3ba45a28614c30ddc52f0795c164141abbebd1558e6c69fb0ac45fada50" },
  { label: "counter (ckb-js-vm)", hash: "0x64f695a23416d9a7b2d34bb7025140c90991b82e9f1dea98e103bc13a72b77ac" },
  { label: "deploy (type id)", hash: "0xa21da18ff3f142127cf63d6e705d64c14577fb99a9a0cbf74f47fb70b6ad66cf" },
];

const isHash = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

// Names people give their own scripts, kept in this browser only. Keyed by
// code hash alone: one name follows a script whichever hash_type points at it.
const NAMES_KEY = "ckb-cycle-tools:names";
function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveNames(names: Record<string, string>) {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // Storage blocked: names last until the page closes.
  }
}

export default function Analyzer() {
  const client = useMemo(() => new ccc.ClientPublicTestnet(), []);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TxAnalysis>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (raw: string) => {
    const hash = raw.trim();
    setInput(hash);
    setError(undefined);
    setResult(undefined);
    if (!isHash(hash)) {
      setError("invalid hash: expected 0x followed by 64 hex characters");
      return;
    }
    // Shareable: the URL always reflects the transaction on screen.
    window.history.replaceState(null, "", `?tx=${hash}`);
    setBusy(true);
    try {
      setResult(await analyzeTransaction(client, hash));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const tx = new URLSearchParams(window.location.search).get("tx");
    if (tx) run(tx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="wrap">
      <Terminal client={client} title="ckb-cycle-tools — tx inspector">
        <h1>
          <span className="dim">[</span> ckb-cycle-tools <span className="dim">v0.1 ]</span>{" "}
          <span className="dim">:: cycle inspector :: testnet</span>
        </h1>
        <p className="lede">
          Paste a CKB testnet transaction hash: see every script that ran when it was verified, and
          what it cost in cycles.
        </p>
        <p className="note">
          # CKB runs each script once per script group: input locks grouped by lock, type scripts
          grouped across inputs and outputs. Output locks never run. The node reports one total;
          the cycles of each group come from replaying it in ckb-debugger, which is the CLI. Click
          a script for its full code hash, or to name it. ·{" "}
          <a href="https://github.com/luongthanhtung03/ckb-cycle-tools">source</a>
        </p>

        <form
          className="block"
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
        >
          <Prompt path="~">cycles inspect {input.trim() ? short(input.trim()) : "<tx-hash>"}</Prompt>
          <label>
            tx hash
            <div className="field">
              <input placeholder="0x…" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
            </div>
          </label>
          <div className="row">
            <button type="submit" disabled={busy}>
              {busy ? "inspecting…" : "run ⏎"}
            </button>
            <span className="hint">
              examples:{" "}
              {EXAMPLES.map((ex, i) => (
                <span key={ex.hash}>
                  {i > 0 && " · "}
                  <button type="button" className="link" onClick={() => run(ex.hash)} disabled={busy}>
                    {ex.label}
                  </button>
                </span>
              ))}
            </span>
          </div>
        </form>

        {(busy || error || result) && (
          <section className="block">
            {busy && (
              <p className="hint">
                fetching tx and resolving input cells… <span className="cursor" />
              </p>
            )}
            {error && <p className="bad">error: {error}</p>}
            {result && <Result a={result} />}
          </section>
        )}

        <Flame />
      </Terminal>
      <footer>
        <span>MIT · built during CKBuilder</span>
        <a href="https://github.com/luongthanhtung03/ckb-cycle-tools">github.com/luongthanhtung03/ckb-cycle-tools</a>
      </footer>
    </main>
  );
}

/** A 30-cell text bar; anything at or above `max` fills it. */
function Bar({ value, max }: { value: bigint; max: bigint }) {
  const width = 30;
  const filled = Math.max(1, Math.min(width, Math.round((Number(value) / Number(max)) * width)));
  return (
    <span className="bar">
      {"█".repeat(filled)}
      <span className="empty">{"░".repeat(width - filled)}</span>
    </span>
  );
}

function Result({ a }: { a: TxAnalysis }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>();
  useEffect(() => setNames(loadNames()), []);
  const rename = (codeHash: string, raw: string) => {
    // Letters, digits, . _ - only: the name goes into a command people paste into a shell.
    const name = raw.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
    const next = { ...names };
    if (name) next[codeHash] = name;
    else delete next[codeHash];
    setNames(next);
    saveNames(next);
  };
  const label = (g: ScriptGroup) => names[g.codeHash] ?? g.name ?? short(g.codeHash, 6);
  // Same names in the CLI, for the scripts in this transaction.
  const nameFlags = [...new Set(a.groups.map((g) => g.codeHash))]
    .filter((h) => names[h] && /^[\w.-]+$/.test(names[h]))
    .map((h) => ` --name ${h}=${names[h]}`)
    .join("");
  const ratio = a.cycles === undefined ? undefined : Number(a.cycles) / Number(BASELINE);
  return (
    <>
      <h2>result</h2>
      <p className="cmdline">
        tx <a href={explorerTx(a.hash)}>{a.hash}</a>
      </p>

      <div className="stat">
        <span className="stat-value">{a.cycles === undefined ? "—" : fmt(a.cycles)}</span>
        <span className="stat-label">cycles</span>
      </div>
      {a.cycles !== undefined && ratio !== undefined && (
        <p className="cmdline">
          <Bar value={a.cycles} max={BASELINE * 10n} />{" "}
          <span className={ratio > 2 ? "warn" : "ok"}>{ratio.toFixed(1)}×</span>{" "}
          <span className="dim">a 1-input secp256k1 transfer ({fmt(BASELINE)})</span>
        </p>
      )}

      <dl>
        <dt>status</dt>
        <dd className={a.status === "committed" ? "ok" : "warn"}>{a.status}</dd>
        {a.blockNumber !== undefined && (
          <>
            <dt>block</dt>
            <dd>#{fmt(a.blockNumber)}</dd>
          </>
        )}
        <dt>cells</dt>
        <dd>
          {a.inputCount} in → {a.outputCount} out
        </dd>
        <dt>groups</dt>
        <dd>{a.groups.length} script group{a.groups.length === 1 ? "" : "s"} executed</dd>
      </dl>

      {a.cellbase && <p className="hint"># cellbase (block reward) transaction: no input scripts run.</p>}
      {a.cycles === undefined && (
        <p className="hint"># the node reports cycles once the transaction is verified; try again shortly.</p>
      )}

      {a.groups.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>role</th>
                <th>script</th>
                <th>hash_type</th>
                <th>args</th>
                <th>in</th>
                <th>out</th>
              </tr>
            </thead>
            <tbody>
              {a.groups.map((g) => {
                const key = `${g.role}:${g.scriptHash}`;
                return (
                  <Fragment key={key}>
                    <tr>
                      <td className={`tag-${g.role}`}>{g.role}</td>
                      <td title={g.codeHash}>
                        <button type="button" className="link" onClick={() => setOpen(open === key ? undefined : key)}>
                          {label(g)}
                        </button>
                      </td>
                      <td className="dim">{g.hashType}</td>
                      <td title={g.args}>{g.args === "0x" ? "-" : short(g.args, 6)}</td>
                      <td>{g.inputs.length ? g.inputs.join(",") : "-"}</td>
                      <td>{g.outputs.length ? g.outputs.join(",") : "-"}</td>
                    </tr>
                    {open === key && (
                      <tr className="detail">
                        <td colSpan={6}>
                          <div className="mono">code_hash <span className="sel">{g.codeHash}</span></div>
                          {g.args !== "0x" && <div className="mono dim">args <span className="sel">{g.args}</span></div>}
                          <label className="row">
                            name
                            <span className="field">
                              <input
                                defaultValue={names[g.codeHash] ?? ""}
                                placeholder={g.name ?? "e.g. campaign-lock"}
                                onBlur={(e) => rename(g.codeHash, e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                                spellCheck={false}
                              />
                            </span>
                          </label>
                          <span className="hint">saved in this browser, for every transaction</span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {a.groups.length > 0 && <Cycles key={a.hash} hash={a.hash} label={label} />}
      {a.groups.length > 0 && (
        <p className="hint mono">
          # the same replay with the native ckb-debugger: the CLI (from a clone of the repo)
          <br />
          npm run cycles -- {a.hash}
          {nameFlags}
        </p>
      )}
    </>
  );
}

// Some public nodes report 0x0 cycles for older blocks (before Meepo); this one
// keeps them, so the page can still compare.
const SECOND_NODE = "https://testnet.ckbapp.dev/";

async function nodeCyclesAt(url: string, hash: string): Promise<bigint | undefined> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "get_transaction", params: [hash] }),
  });
  const cycles = (await res.json())?.result?.cycles;
  return cycles && BigInt(cycles) > 0n ? BigInt(cycles) : undefined;
}

type Verdict = ReturnType<typeof import("ckb-cycle-tools/replay").nodeVerdict>;

const mb = (n: number) => (n / 1e6).toFixed(1);

/**
 * Per-group cycles in the page: ckb-debugger's WebAssembly build replays every
 * group of the transaction, the same way the CLI does with the native binary.
 * Nothing is downloaded until the button is pressed.
 */
function Cycles({ hash, label }: { hash: string; label: (g: ScriptGroup) => string }) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [download, setDownload] = useState<string>();
  const [profile, setProfile] = useState<Profile>();
  const [verdict, setVerdict] = useState<Verdict>();
  const [nodeFrom, setNodeFrom] = useState<string>();
  const [error, setError] = useState<string>();
  const [openLogs, setOpenLogs] = useState<string>();
  const say = (line: string) => setLines((l) => [...l, line]);

  const go = async () => {
    setBusy(true);
    setLines([]);
    setDownload(undefined);
    setProfile(undefined);
    setNodeFrom(undefined);
    setError(undefined);
    try {
      say("loading ckb-debugger (WebAssembly)…");
      // The shim and the debugger stay in the worker; the page only loads the replay logic.
      const [dbg, replay] = await Promise.all([
        loadDebugger((loaded, total) => setDownload(total ? `${mb(loaded)} / ${mb(total)} MB` : `${mb(loaded)} MB`)),
        import("ckb-cycle-tools/replay"),
      ]);
      setDownload(undefined);
      say(`${dbg.version} ready`);
      say("fetching the transaction, its input cells and cell deps…");
      const plan = await replay.planReplay(hash);
      if (plan.nodeCycles === undefined && plan.status === "committed") {
        const cycles = await nodeCyclesAt(SECOND_NODE, hash).catch(() => undefined);
        if (cycles !== undefined) {
          plan.nodeCycles = cycles;
          setNodeFrom(SECOND_NODE);
        }
      }
      const n = plan.groups.length;
      say(`${n} group${n === 1 ? "" : "s"} to run on CKB-VM v${plan.scriptVersion}`);
      const tx = new TextEncoder().encode(JSON.stringify(plan.mock));
      const p = await replay.replayGroups(plan, dbg.runner(tx), {
        txFile: dbg.txFile,
        debugger: `${dbg.version} (wasm)`,
        onGroup: (i, selector) => say(`[${i + 1}/${n}] ${selector}`),
      });
      say("done");
      setProfile(p);
      setVerdict(replay.nodeVerdict(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="block">
      <Prompt path="~">cycles profile {short(hash)}</Prompt>
      <div className="row">
        <button type="button" onClick={go} disabled={busy}>
          {busy ? "running…" : profile ? "run again" : "per-group cycles"}
        </button>
        {!profile && !busy && (
          <span className="hint">replays each group in ckb-debugger, in this browser (downloads ~4 MB once)</span>
        )}
      </div>

      {(lines.length > 0 || download) && (
        <ul className="log">
          {lines.map((l, i) => (
            <li key={i}>
              <span className="dim">&gt;</span> {l}
            </li>
          ))}
          {download && (
            <li>
              <span className="dim">&gt;</span> ckb-debugger.wasm {download}
            </li>
          )}
          {busy && (
            <li>
              <span className="cursor" />
            </li>
          )}
        </ul>
      )}
      {error && <p className="bad">error: {error}</p>}

      {profile && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>role</th>
                  <th>script</th>
                  <th>result</th>
                  <th>cycles</th>
                  <th>share</th>
                </tr>
              </thead>
              <tbody>
                {profile.groups.map((g) => (
                  <GroupRow
                    key={g.selector}
                    g={g}
                    total={profile.measuredCycles}
                    label={label(g)}
                    open={openLogs === g.selector}
                    toggle={() => setOpenLogs(openLogs === g.selector ? undefined : g.selector)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <dl className="block">
            <dt>measured</dt>
            <dd>{fmt(profile.measuredCycles)}</dd>
            <dt>node</dt>
            <dd>
              {profile.nodeCycles === undefined ? "—" : fmt(profile.nodeCycles)}
              {nodeFrom && <span className="dim"> (from {nodeFrom})</span>}
            </dd>
            <dt>vs node</dt>
            <dd>
              {verdict === "match" && <span className="ok">✓ match</span>}
              {verdict === "mismatch" && <span className="bad">✗ mismatch</span>}
              {verdict === "not recorded" && <span className="warn">not recorded by the node</span>}
              {verdict === undefined && <span className="dim">no node total yet ({profile.status})</span>}
            </dd>
            <dt>debugger</dt>
            <dd>
              {profile.env.debugger}, CKB-VM v{profile.env.scriptVersion}
            </dd>
          </dl>
        </>
      )}
    </div>
  );
}

function GroupRow({
  g,
  total,
  label,
  open,
  toggle,
}: {
  g: ProfiledGroup;
  total: bigint;
  label: string;
  open: boolean;
  toggle: () => void;
}) {
  const pct = total > 0n ? (Number(g.cycles) / Number(total)) * 100 : 0;
  return (
    <>
      <tr>
        <td className={`tag-${g.role}`}>{g.role}</td>
        <td title={`${g.selector} · ${g.codeHash}`}>{label}</td>
        <td className={g.result === 0 ? "ok" : "bad"} title={g.error}>
          {g.result === 0 ? "ok" : g.error ? "vm error" : `exit ${g.result}`}
          {g.logs.length > 0 && (
            <>
              {" "}
              <button type="button" className="link" onClick={toggle}>
                logs ({g.logs.length})
              </button>
            </>
          )}
        </td>
        <td>{fmt(g.cycles)}</td>
        <td>
          <Bar value={g.cycles} max={total > 0n ? total : 1n} /> <span className="dim">{pct.toFixed(1)}%</span>
        </td>
      </tr>
      {(open || g.error) && (
        <tr className="detail">
          <td colSpan={5}>
            {g.error && <div className="mono bad">{g.error}</div>}
            {open &&
              g.logs.map((l, i) => (
                <div key={i} className="mono">
                  <span className="dim">log</span> {l}
                </div>
              ))}
          </td>
        </tr>
      )}
    </>
  );
}

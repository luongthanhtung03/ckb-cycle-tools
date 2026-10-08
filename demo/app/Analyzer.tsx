"use client";

import { ccc } from "@ckb-ccc/core";
import { analyzeTransaction, type TxAnalysis } from "ckb-cycle-tools/analyze";
import { useEffect, useMemo, useState } from "react";
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
          grouped across inputs and outputs. Output locks never run. Per-group cycles need
          ckb-debugger: that is the CLI, next milestone. ·{" "}
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
              {a.groups.map((g) => (
                <tr key={`${g.role}:${g.scriptHash}`}>
                  <td className={`tag-${g.role}`}>{g.role}</td>
                  <td title={g.codeHash}>{g.name ?? short(g.codeHash, 6)}</td>
                  <td className="dim">{g.hashType}</td>
                  <td title={g.args}>{g.args === "0x" ? "-" : short(g.args, 6)}</td>
                  <td>{g.inputs.length ? g.inputs.join(",") : "-"}</td>
                  <td>{g.outputs.length ? g.outputs.join(",") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

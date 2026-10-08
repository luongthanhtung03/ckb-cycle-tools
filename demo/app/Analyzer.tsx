"use client";

import { ccc } from "@ckb-ccc/core";
import { analyzeTransaction, type TxAnalysis } from "ckb-cycle-tools/analyze";
import { useEffect, useMemo, useState } from "react";

const explorerTx = (h: string) => `https://testnet.explorer.nervos.org/transaction/${h}`;
const short = (h: string, n = 10) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
const fmt = (n: bigint) => n.toLocaleString("en-US");

// Real testnet transactions from my CKBuilder work, so the page has something to
// show before anyone pastes a hash.
const EXAMPLES = [
  {
    label: "Plain CKB transfer",
    hash: "0x52a1b3ba45a28614c30ddc52f0795c164141abbebd1558e6c69fb0ac45fada50",
  },
  {
    label: "Counter Type Script (ckb-js-vm)",
    hash: "0x64f695a23416d9a7b2d34bb7025140c90991b82e9f1dea98e103bc13a72b77ac",
  },
  {
    label: "Script deployment with Type ID",
    hash: "0xa21da18ff3f142127cf63d6e705d64c14577fb99a9a0cbf74f47fb70b6ad66cf",
  },
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
      setError("A transaction hash is 0x followed by 64 hex characters.");
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
      <header>
        <h1>CKB Cycle Tools</h1>
        <p className="lede">
          Paste a CKB <strong>testnet</strong> transaction hash to see which scripts ran when it was
          verified, and what it cost in cycles.
        </p>
        <p className="note">
          CKB runs each script once per <em>script group</em>: input locks grouped by lock, type
          scripts grouped across inputs and outputs. Output locks never run. A per-script cycle
          breakdown needs ckb-debugger — that is the CLI, next milestone.{" "}
          <a href="https://github.com/luongthanhtung03/ckb-cycle-tools">Source on GitHub</a>
        </p>
      </header>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
      >
        <label>
          Transaction hash
          <input
            className="mono"
            placeholder="0x…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Analysing…" : "Analyse"}
        </button>
        <p className="hint">
          Or try:{" "}
          {EXAMPLES.map((ex, i) => (
            <span key={ex.hash}>
              {i > 0 && " · "}
              <button type="button" className="link" onClick={() => run(ex.hash)} disabled={busy}>
                {ex.label}
              </button>
            </span>
          ))}
        </p>
      </form>

      {error && (
        <section className="card">
          <p className="bad">{error}</p>
        </section>
      )}

      {result && <Result a={result} />}
    </main>
  );
}

function Result({ a }: { a: TxAnalysis }) {
  return (
    <section className="card">
      <h2>
        <a href={explorerTx(a.hash)} className="mono">
          {short(a.hash)}
        </a>
      </h2>

      <div className="stat">
        <span className="stat-value">{a.cycles === undefined ? "—" : fmt(a.cycles)}</span>
        <span className="stat-label">cycles to verify</span>
      </div>

      <dl>
        <dt>Status</dt>
        <dd className={a.status === "committed" ? "ok" : undefined}>{a.status}</dd>
        {a.blockNumber !== undefined && (
          <>
            <dt>Block</dt>
            <dd>{fmt(a.blockNumber)}</dd>
          </>
        )}
        <dt>Cells</dt>
        <dd>
          {a.inputCount} in → {a.outputCount} out
        </dd>
        <dt>Script groups run</dt>
        <dd>{a.groups.length}</dd>
      </dl>

      {a.cellbase && <p className="hint">A cellbase (block reward) transaction: no input scripts run.</p>}
      {a.cycles === undefined && (
        <p className="hint">The node reports cycles only once a transaction is verified; try again shortly.</p>
      )}

      {a.groups.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Script</th>
                <th>Args</th>
                <th>Inputs</th>
                <th>Outputs</th>
              </tr>
            </thead>
            <tbody>
              {a.groups.map((g) => (
                <tr key={`${g.role}:${g.scriptHash}`}>
                  <td>
                    <span className={`tag tag-${g.role}`}>{g.role}</span>
                  </td>
                  <td>
                    {g.name ?? <span className="mono" title={g.codeHash}>{short(g.codeHash, 6)}</span>}
                    <div className="sub">{g.hashType}</div>
                  </td>
                  <td className="mono" title={g.args}>
                    {g.args === "0x" ? "—" : short(g.args, 6)}
                  </td>
                  <td>{g.inputs.length ? g.inputs.join(", ") : "—"}</td>
                  <td>{g.outputs.length ? g.outputs.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

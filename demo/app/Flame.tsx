"use client";

import { flameTree, foldedTotal, functionCosts, parseFolded, renderFlameSvg, type Folded } from "ckb-cycle-tools/flame";
import { useState } from "react";
import { Prompt } from "./Terminal";

const fmt = (n: bigint) => n.toLocaleString("en-US");
/** A folded profile is a few kilobytes; anything far larger is not one. */
const MAX_BYTES = 4 << 20;

/**
 * A flamegraph drawn from a `.folded` file that `ckb-cycles flame` wrote. The
 * WebAssembly ckb-debugger in this page can profile but not name functions, so
 * the profile is made by the CLI (with an unstripped build) and only drawn here,
 * by the same code. Nothing leaves the browser.
 */
export function Flame() {
  const [profile, setProfile] = useState<{ name: string; folded: Folded }>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  const load = (name: string, text: string) => {
    const folded = parseFolded(text);
    if (!folded.size) {
      setProfile(undefined);
      setError(`${name}: no folded stacks in it (lines of "frame;frame;… cycles")`);
      return;
    }
    setError(undefined);
    setProfile({ name, folded });
  };
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`${file.name}: ${Math.round(file.size / 1024)} KB, too large for a folded profile`);
      return;
    }
    load(file.name, await file.text());
  };
  const loadExample = async () => {
    const res = await fetch("/examples/session-lock-charge.folded");
    load("session lock, a subscription charge", await res.text());
  };

  const costs = profile && functionCosts(profile.folded);
  const svg = profile && renderFlameSvg(flameTree(profile.folded, "all"), { title: profile.name, width: 1000 });

  return (
    <section
      className={`block${dragging ? " drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        loadFile(e.dataTransfer.files[0]);
      }}
    >
      <h2>inside a script</h2>
      <Prompt path="~">cycles flame {profile ? profile.name : "<file.folded>"}</Prompt>
      <p className="hint">
        # where inside a script the cycles go. Make the profile with the CLI:{" "}
        <code>npx -p ckb-cycle-tools ckb-cycles flame &lt;tx-hash&gt; --bin &lt;code-hash&gt;=&lt;unstripped elf&gt;</code>, then drop
        its <code>.folded</code> file here. Drawn in this browser; nothing is uploaded.
      </p>
      <div className="row">
        <label className="button">
          choose .folded file
          <input type="file" accept=".folded,.txt" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="link" onClick={loadExample}>
          example: the session lock in a subscription charge
        </button>
      </div>
      {error && <p className="bad">error: {error}</p>}
      {profile && costs && svg && (
        <>
          <p className="hint">
            {fmt(foldedTotal(profile.folded))} cycles profiled · {costs.length} functions · hover a frame for its cycles
          </p>
          {/* The SVG is built by renderFlameSvg, which escapes every name from the file. */}
          <div className="flame" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>self</th>
                <th>total</th>
                <th>function</th>
              </tr>
            </thead>
            <tbody>
              {costs.slice(0, 12).map((c) => (
                <tr key={c.name}>
                  <td>{fmt(c.self)}</td>
                  <td>{fmt(c.total)}</td>
                  <td className="mono">{c.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {costs.length === 1 && (
            <p className="hint"># one frame: the binary had no symbols. Profile an unstripped build with --bin.</p>
          )}
        </>
      )}
    </section>
  );
}

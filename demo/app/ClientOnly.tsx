"use client";

import dynamic from "next/dynamic";

// Talks to the public testnet node straight from the browser; nothing to render
// on the server.
const Analyzer = dynamic(() => import("./Analyzer"), {
  ssr: false,
  loading: () => <main className="wrap">Loading…</main>,
});

export default function ClientOnly() {
  return <Analyzer />;
}

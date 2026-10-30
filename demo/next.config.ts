import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The demo imports the library's compiled output (../dist), exactly as an outside
// app would use the package. The root build runs first, so every deploy shows the
// library at that commit. The workspace root is the repository root.
const root = fileURLToPath(new URL("..", import.meta.url));

const config: NextConfig = {
  turbopack: {
    root,
    resolveAlias: {
      "ckb-cycle-tools/analyze": "../dist/analyze.js",
      "ckb-cycle-tools/flame": "../dist/flame.js",
      "ckb-cycle-tools/replay": "../dist/replay.js",
      "ckb-cycle-tools/wasm": "../dist/wasm.js",
    },
  },
  outputFileTracingRoot: root,
  experimental: { externalDir: true },
  poweredByHeader: false,
  // No other site may frame the inspector (clickjacking). The CSP stops at
  // frame-ancestors: a script-src would also have to allow the ckb-debugger
  // WebAssembly worker ('wasm-unsafe-eval') and Next's inline scripts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;

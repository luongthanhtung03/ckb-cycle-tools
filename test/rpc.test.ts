/**
 * The node side, against a local JSON-RPC server (no network): timeouts,
 * the request limit, clear errors, and the hardfork epochs taken from the node
 * that was asked rather than from a network flag.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildMockTransaction, httpRpc, nodeConsensus, scriptVersionAt, type Rpc } from "../src/mock.js";
import { planReplay } from "../src/replay.js";

const H = (c: string) => "0x" + c.repeat(64);

let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

/** A JSON-RPC server that answers with `handle(method, params)`; `null` means never answer. */
async function serve(handle: (method: string, params: unknown[]) => unknown | Promise<unknown>): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const { id, method, params } = JSON.parse(body);
      const result = await handle(method, params);
      if (result === null) return;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id, jsonrpc: "2.0", result }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`;
}

const consensus = (id: string, v1: number, v2: number) => ({
  id,
  hardfork_features: [
    { rfc: "0028", epoch_number: "0x" + v1.toString(16) },
    { rfc: "0032", epoch_number: "0x" + v1.toString(16) },
    { rfc: "0049", epoch_number: "0x" + v2.toString(16) },
  ],
});

describe("httpRpc", () => {
  it("gives up on a node that never answers, and says which one", async () => {
    const url = await serve(() => null);
    await expect(httpRpc(url, { timeoutMs: 200 })("get_tip_header", [])).rejects.toThrow(
      `get_tip_header: no answer from ${url} within 0.2 s`,
    );
  });

  it("names the URL and the reason when the node cannot be reached", async () => {
    const url = await serve(() => 1);
    server!.close();
    server!.closeAllConnections();
    await new Promise((r) => setTimeout(r, 50));
    await expect(httpRpc(url)("get_tip_header", [])).rejects.toThrow(new RegExp(`cannot reach ${url} \\(ECONNREFUSED\\)`));
  });

  it("keeps at most `concurrency` requests in flight", async () => {
    let active = 0;
    let peak = 0;
    const url = await serve(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return "0x0";
    });
    const rpc = httpRpc(url, { concurrency: 4 });
    await Promise.all(Array.from({ length: 30 }, () => rpc("get_tip_block_number", [])));
    expect(peak).toBe(4);
  });

  it("says when the answer is not JSON-RPC", async () => {
    server = createServer((_, res) => res.end("<html>"));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    await expect(httpRpc(url)("get_consensus", [])).rejects.toThrow(`get_consensus: ${url} did not answer with JSON-RPC`);
  });
});

describe("nodeConsensus", () => {
  it("reads the chain and the CKB-VM v1 (RFC 0032) and v2 (RFC 0049) epochs", async () => {
    const rpc: Rpc = async <T>() => consensus("ckb", 5414, 12293) as T;
    expect(await nodeConsensus(rpc)).toEqual({ chain: "ckb", network: "mainnet", vmEpochs: [5414, 12293] });
  });

  it("treats a hardfork the node has not scheduled as never active", async () => {
    const c = consensus("ckb_dev", 0, 0);
    c.hardfork_features[2].epoch_number = null as unknown as string;
    const { network, vmEpochs } = await nodeConsensus(async <T>() => c as T);
    expect(network).toBe("ckb_dev");
    expect(scriptVersionAt(vmEpochs, 1_000_000)).toBe(1);
  });
});

describe("buildMockTransaction", () => {
  it("says a transaction was rejected, with the node's reason, instead of 'not found'", async () => {
    const rpc: Rpc = async <T>() =>
      ({ transaction: null, cycles: null, tx_status: { status: "rejected", reason: "Resolve failed Dead(...)" } }) as T;
    await expect(buildMockTransaction(rpc, H("a"))).rejects.toThrow(/transaction rejected by the node: .* \(Resolve failed Dead/);
  });
});

describe("planReplay", () => {
  // Found in review: --rpc <mainnet node> without --mainnet used testnet's epochs,
  // and a mainnet tx from epoch 11000 (v1 there, v2 on testnet) was replayed on v2.
  const lock = { code_hash: H("1"), hash_type: "data1", args: "0x" };
  const tx = {
    version: "0x0",
    cell_deps: [],
    header_deps: [],
    inputs: [{ since: "0x0", previous_output: { tx_hash: H("c"), index: "0x0" } }],
    outputs: [],
    outputs_data: [],
    witnesses: [],
  };
  const node = (chain: ReturnType<typeof consensus> | undefined) =>
    serve((method, params) => {
      if (method === "get_consensus") return chain ?? null;
      if (method === "get_header") return { epoch: "0x" + (11000).toString(16) };
      if (params[0] === H("c")) {
        return { transaction: { outputs: [{ capacity: "0x0", lock, type: null }], outputs_data: ["0x"] }, cycles: null, tx_status: { status: "committed", block_hash: H("e") } };
      }
      return { transaction: tx, cycles: "0x0", tx_status: { status: "committed", block_hash: H("b") } };
    });

  it("takes the CKB-VM version from the hardfork epochs of the node it asked", async () => {
    const url = await node(consensus("ckb", 5414, 12293));
    const plan = await planReplay(H("a"), { rpcUrl: url });
    expect(plan).toMatchObject({ scriptVersion: 1, network: "mainnet" });
  });

  it("stops when the node serves another chain than the flag says", async () => {
    const url = await node(consensus("ckb", 5414, 12293));
    await expect(planReplay(H("a"), { rpcUrl: url, network: "testnet" })).rejects.toThrow(/serves mainnet .* not testnet/);
  });

  it("stops rather than guess when a node given by URL cannot say", async () => {
    const url = await node(undefined);
    await expect(planReplay(H("a"), { rpcUrl: url, timeoutMs: 300 })).rejects.toThrow(/cannot read the hardfork epochs/);
  });
});

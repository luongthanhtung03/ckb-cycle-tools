import { ccc } from "@ckb-ccc/core";
import { analyzeTransaction } from "../dist/analyze.js";
const c = new ccc.ClientPublicTestnet();
for (const h of process.argv.slice(2)) {
  const a = await analyzeTransaction(c, h);
  console.log(h.slice(0, 10), a.status, a.cycles, `in=${a.inputCount} out=${a.outputCount} cellbase=${a.cellbase}`);
  for (const g of a.groups) console.log("  ", g.role, g.name ?? g.codeHash.slice(0, 12), "in", g.inputs, "out", g.outputs);
}
process.exit(0);

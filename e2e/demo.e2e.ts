import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";

// A counter update on testnet: a secp256k1 lock and a ckb-js-vm type script. The
// same transaction CI's testnet-profile job replays with the native debugger.
const TX = "0x64f695a23416d9a7b2d34bb7025140c90991b82e9f1dea98e103bc13a72b77ac";
const NODE_CYCLES = "15,675,038";

test("/ loads and reads testnet", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("cycle inspector");
  // The live tip in the title bar: the page reached the testnet RPC.
  await expect(page.getByText(/^testnet #[\d,]+$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^run/ })).toBeVisible();
});

test("?tx= shows the node's cycles and the script groups", async ({ page }) => {
  const res = await page.goto(`/?tx=${TX}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByText(`tx ${TX}`)).toBeVisible();
  await expect(page.getByText(NODE_CYCLES, { exact: true })).toBeVisible();
  await expect(page.getByText("2 script groups executed")).toBeVisible();
  const groups = page.locator("table", { has: page.locator("th", { hasText: "hash_type" }) }).locator("tbody > tr");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator("td").first()).toHaveText("lock");
  await expect(groups.nth(0)).toContainText("Secp256k1Blake160");
  await expect(groups.nth(1).locator("td").first()).toHaveText("type");
});

test("per-group cycles: ckb-debugger (WASM) replays each group, and they add up to the node's", async ({ page }) => {
  await page.goto(`/?tx=${TX}`);
  await page.getByRole("button", { name: "per-group cycles" }).click();
  // Downloads ~4 MB of WebAssembly once, then fetches the cells and runs each group.
  await expect(page.getByRole("button", { name: "run again" })).toBeVisible({ timeout: 150_000 });
  const profile = page.locator("table", { has: page.locator("th", { hasText: "share" }) });
  const rows = profile.locator("tbody > tr:not(.detail):not(.spawn)");
  await expect(rows).toHaveCount(2);
  let sum = 0;
  for (const row of await rows.all()) {
    await expect(row.locator("td").nth(2)).toHaveText(/^ok/);
    const cycles = Number((await row.locator("td").nth(3).innerText()).replaceAll(",", ""));
    expect(cycles).toBeGreaterThan(0);
    sum += cycles;
  }
  expect(sum.toLocaleString("en-US")).toBe(NODE_CYCLES);
  const measured = page.locator("dt", { hasText: "measured" }).locator("+ dd");
  await expect(measured).toHaveText(NODE_CYCLES);
  await expect(page.locator("dt", { hasText: "vs node" }).locator("+ dd")).toHaveText("✓ match");
  await expect(page.locator("dt", { hasText: "debugger" }).locator("+ dd")).toContainText("(wasm)");
});

test("the built-in flamegraph example draws an SVG", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^example: / }).click();
  const svg = page.locator(".flame svg");
  await expect(svg).toBeVisible();
  expect(await svg.locator("rect").count()).toBeGreaterThan(1);
  await expect(page.getByText(/[\d,]+ cycles profiled · \d+ functions/)).toBeVisible();
});

// A Crowns race on testnet: the race's type script spawns a second script (vm 1) through
// ckb-script-ipc. The CLI's `flame` splits it the same way, with native ckb-debugger 1.1.2.
const SPAWN_TX = "0x2502c0b4ed1205cf33c80294c5bfcf60da80063af4e0cbf0665bce8971997c4d";

test("a group whose script spawns another is split by script, inside the group's total", async ({ page }) => {
  await page.goto(`/?tx=${SPAWN_TX}`);
  await page.getByRole("button", { name: "per-group cycles" }).click();
  await expect(page.getByRole("button", { name: "run again" })).toBeVisible({ timeout: 170_000 });
  await expect(page.locator("dt", { hasText: "vs node" }).locator("+ dd")).toHaveText("✓ match");
  await expect(page.locator("dt", { hasText: "measured" }).locator("+ dd")).toHaveText("125,466,425");
  await expect(page.locator("dt", { hasText: "debugger" }).locator("+ dd")).toContainText("ckb-debugger 1.1.2 (wasm)");
  const profile = page.locator("table", { has: page.locator("th", { hasText: "share" }) });
  const group = profile.locator("tbody > tr:not(.detail):not(.spawn)").nth(1);
  await expect(group.locator("td").nth(3)).toHaveText("123,718,667");
  const spawn = profile.locator("tbody > tr.spawn");
  await expect(spawn).toHaveCount(2);
  await expect(spawn.nth(0)).toContainText("vm 0 spawning script");
  await expect(spawn.nth(0).locator("td").nth(3)).toHaveText("7,993,759");
  await expect(spawn.nth(1)).toContainText("vm 1");
  await expect(spawn.nth(1)).toContainText("(cell_dep[1][0..102672])");
  await expect(spawn.nth(1).locator("td").nth(1)).toHaveAttribute("title", /0x151d91491f9ddf21728ed1ac5bf879bdfbd176ed11b1ef23b4f72be369116b6c/);
  await expect(spawn.nth(1).locator("td").nth(2)).toHaveText("exit -1");
  await expect(spawn.nth(1).locator("td").nth(3)).toHaveText("115,556,444");
  await expect(profile.getByText("spawned 1 other script: its cycles are in the 123,718,667")).toBeVisible();
  await expect(profile.getByText(/# vm 1: the group verified, so this is the spawned script.s own exit code, not a failure/)).toBeVisible();
});

test("with a ckb-debugger older than 1.1.2, the page says so and replays no spawned script", async ({ page }) => {
  // ckb-testtool's build (0.200.1), what the page ran before: served in place of the page's own.
  const old = readFileSync(fileURLToPath(new URL("../node_modules/ckb-testtool/src/wasm/ckb-debugger.wasm", import.meta.url)));
  await page.route("**/ckb-debugger.wasm", (route) => route.fulfill({ body: old, contentType: "application/wasm" }));
  await page.goto(`/?tx=${SPAWN_TX}`);
  await page.getByRole("button", { name: "per-group cycles" }).click();
  await expect(page.getByRole("button", { name: "run again" })).toBeVisible({ timeout: 170_000 });
  await expect(page.locator("dt", { hasText: "measured" }).locator("+ dd")).toHaveText("125,466,425");
  await expect(page.locator("dt", { hasText: "vs node" }).locator("+ dd")).toHaveText("✓ match");
  await expect(page.getByText("# spawned scripts: ckb-debugger 0.200.1 cannot profile a spawned script on its own (ckb-debugger 1.1.2 or later can)")).toBeVisible();
  await expect(page.locator("tr.spawn")).toHaveCount(0);
  await expect(page.getByText("checking each group for spawned scripts", { exact: false })).toHaveCount(0);
});

test("inspecting another tx mid-replay cancels the old replay; the new one runs on its own", async ({ page }) => {
  await page.goto(`/?tx=${SPAWN_TX}`);
  await page.getByRole("button", { name: "per-group cycles" }).click();
  // The old replay is in its spawn check (the Crowns group's profiled runs take seconds) when the page moves on.
  await expect(page.getByText("checking each group for spawned scripts", { exact: false })).toBeVisible({ timeout: 170_000 });
  await page.getByRole("button", { name: "counter (ckb-js-vm)" }).click();
  await expect(page.getByText(`tx ${TX}`)).toBeVisible();
  await page.getByRole("button", { name: "per-group cycles" }).click();
  await expect(page.getByRole("button", { name: "run again" })).toBeVisible({ timeout: 170_000 });
  await expect(page.locator("dt", { hasText: "measured" }).locator("+ dd")).toHaveText(NODE_CYCLES);
  await expect(page.locator("dt", { hasText: "vs node" }).locator("+ dd")).toHaveText("✓ match");
  // Nothing from the cancelled replay reached this page.
  await expect(page.locator("tr.spawn")).toHaveCount(0);
  await expect(page.getByText("not checked", { exact: false })).toHaveCount(0);
  await expect(page.getByText(SPAWN_TX.slice(0, 10), { exact: false })).toHaveCount(0);
});

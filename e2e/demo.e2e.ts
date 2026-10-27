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
  const rows = profile.locator("tbody > tr:not(.detail)");
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

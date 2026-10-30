#!/usr/bin/env bash
# End to end on a real ckb-script-templates project: generate a workspace with
# two contracts, wire in integrations/ckb-testtool, add the README's
# `cycles-config` target, then scan, report, change one contract and diff.
#
# Needs: cargo with the riscv64imac-unknown-none-elf target, clang 18+ and
# llvm-objcopy (the template's find_clang), make, git, perl, cargo-generate,
# node 20+, and ckb-debugger on PATH (or CKB_DEBUGGER_PATH). Run `npm ci` in
# this repo first; the script builds dist/ itself.
#
#   scripts/templates-e2e.sh [work-dir]
#
# The project is generated in work-dir (default: a new temporary directory),
# never inside this repo. TEMPLATE_REF pins the template commit it was last
# run against; TEMPLATE_REF=main tries the current one.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$(mktemp -d)}"
TEMPLATE_URL="${TEMPLATE_URL:-https://github.com/nervosnetwork/ckb-script-templates}"
TEMPLATE_REF="${TEMPLATE_REF:-f90b1e2c52de1e60dc6aca437de8f43d7aed9c14}"
export USER="${USER:-ckb}" # cargo-generate asks for it

mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
case "$WORK/" in "$REPO"/*) echo "work dir $WORK is inside the repo; pick another" >&2; exit 2 ;; esac

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

step "ckb-cycles from this checkout"
(cd "$REPO" && npm run build --silent)
CKB_CYCLES="node $REPO/dist/cli.js"

step "ckb-script-templates at $TEMPLATE_REF"
TPL="$WORK/ckb-script-templates"
rm -rf "$TPL" "$WORK/demo"
git clone --quiet "$TEMPLATE_URL" "$TPL"
git -C "$TPL" checkout --quiet "$TEMPLATE_REF"
git -C "$TPL" log --oneline -1

step "workspace + contracts alpha (contract) and beta (contract-without-simulator)"
cargo generate --path "$TPL" workspace --name demo --destination "$WORK" --silent
cd "$WORK/demo"
make generate TEMPLATE_TYPE=--path TEMPLATE_REPO="$TPL" CRATE=alpha
make generate TEMPLATE_TYPE=--path TEMPLATE_REPO="$TPL" CRATE=beta TEMPLATE=contract-without-simulator

step "the generated tests, unchanged"
make build
cargo test -p tests -- --nocapture 2>&1 | tee "$WORK/test-plain.log"
grep -q "test result: ok. 2 passed" "$WORK/test-plain.log" || fail "the generated tests do not pass"

step "wire in ckb-cycles-testtool (README step 1) and the Makefile target (step 2)"
printf 'ckb-cycles-testtool = { path = "%s" }\n' "$REPO/integrations/ckb-testtool" >> tests/Cargo.toml
perl -0pi -e 's/context\s*\.verify_tx\(&tx,/ckb_cycles_testtool::verify_tx(&context, &tx,/g' tests/src/tests.rs
test "$(grep -c 'ckb_cycles_testtool::verify_tx' tests/src/tests.rs)" = 2 || fail "expected two verify_tx calls to replace"
cat >> Makefile <<'MAKE'

# ckb-cycles: cycle reports from the tests (ckb-cycle-tools README)
CKB_CYCLES ?= npx -y -p ckb-cycle-tools ckb-cycles
CYCLES_MOCKS := target/ckb-cycles

cycles-config: build
	rm -rf $(CYCLES_MOCKS)
	CKB_CYCLES_MOCKS="$(abspath $(CYCLES_MOCKS))" cargo test -p tests -- --nocapture
	$(CKB_CYCLES) scan $(CYCLES_MOCKS) --binaries $(BUILD_DIR) --functions -o cycles.json

cycles: cycles-config
	$(CKB_CYCLES) report cycles.json
MAKE

step "without CKB_CYCLES_MOCKS nothing is written"
cargo test -p tests >/dev/null 2>&1
test ! -e target/ckb-cycles || fail "mocks written without CKB_CYCLES_MOCKS"

step "make cycles-config (base)"
make cycles-config CKB_CYCLES="$CKB_CYCLES" 2>&1 | tee "$WORK/cycles-base.log"
test "$(ls target/ckb-cycles | wc -l)" -eq 2 || fail "expected 2 mocks: $(ls target/ckb-cycles)"
$CKB_CYCLES report cycles.json --json "$WORK/base.json"
rm -rf "$WORK/base-checkout" && mkdir -p "$WORK/base-checkout/build"
cp -r build/release "$WORK/base-checkout/build/"

step "a deliberate change: alpha runs a 1000-step loop"
perl -0pi -e 's/(debug!\("This is a sample contract!"\);\n)/$1    let mut acc: u64 = 0;\n    for i in 0..1000u64 {\n        acc = core::hint::black_box(acc.wrapping_mul(31).wrapping_add(i));\n    }\n    if acc == 1 {\n        return 1;\n    }\n/' contracts/alpha/src/main.rs
grep -q black_box contracts/alpha/src/main.rs || fail "the change did not apply"

step "make cycles-config (head), report, report with the base's binaries, diff"
make cycles-config CKB_CYCLES="$CKB_CYCLES" 2>&1 | tee "$WORK/cycles-head.log"
$CKB_CYCLES report cycles.json --json "$WORK/head.json"
$CKB_CYCLES report cycles.json --binaries-from "$WORK/base-checkout" --json "$WORK/base-swapped.json"
$CKB_CYCLES diff "$WORK/base-swapped.json" "$WORK/head.json" | tee "$WORK/diff.txt"
$CKB_CYCLES diff "$WORK/base-swapped.json" "$WORK/head.json" --markdown > "$WORK/diff.md"
set +e
$CKB_CYCLES diff "$WORK/base-swapped.json" "$WORK/head.json" --fail-above 5 >/dev/null
code=$?
set -e
test "$code" = 1 || fail "diff --fail-above 5 exited $code, expected 1"

step "checks"
node - "$WORK" <<'JS'
const fs = require("node:fs");
const dir = process.argv[2];
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
// What ckb-testtool itself counted, per test, from the tests' own output.
const testtool = (log) => [...fs.readFileSync(`${dir}/${log}`, "utf8").matchAll(/consume cycles: (\d+)/g)].map((m) => Number(m[1])).sort();
const cyclesOf = (r) => Object.fromEntries(r.scenarios.map((s) => [s.name, s.groups.reduce((n, g) => n + g.cycles, 0)]));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const base = read("base.json"), swapped = read("base-swapped.json"), head = read("head.json");
const b = cyclesOf(base), s = cyclesOf(swapped), h = cyclesOf(head);
for (const [r, log] of [[b, "cycles-base.log"], [h, "cycles-head.log"]]) {
  if (JSON.stringify(Object.values(r).sort()) !== JSON.stringify(testtool(log))) fail(`report ${JSON.stringify(r)} != ckb-testtool ${testtool(log)}`);
}
if (JSON.stringify(b) !== JSON.stringify(s)) fail(`the base build swapped into the head's mocks: ${JSON.stringify(s)}, the base's own run: ${JSON.stringify(b)}`);
if (!(h["tests.test_alpha"] > b["tests.test_alpha"])) fail("alpha did not get costlier");
if (h["tests.test_beta"] !== b["tests.test_beta"]) fail("beta changed");
const names = head.scenarios.flatMap((x) => x.groups.flatMap((g) => (g.functions ?? []).map((f) => f.name)));
if (!names.length) fail("no functions recorded");
if (names.some((n) => n.startsWith("func_0x"))) fail(`unnamed functions: ${names.filter((n) => n.startsWith("func_0x"))}`);
console.log(`ok: base ${JSON.stringify(b)}, head ${JSON.stringify(h)}; the reports match ckb-testtool's own counts`);
JS
echo "work dir: $WORK"

/**
 * session-lock, ported line for line to TypeScript for ckb-js-vm.
 *
 * The reference is the Rust lock in ckb-session-kit
 * (contracts/session-lock/src/main.rs). Same args, same rules, same error codes —
 * the comparison harness fails if the two ever disagree on accept/reject. The
 * only difference is where the args start: ckb-js-vm reserves the first 35 bytes
 * of a script's args (2 flag bytes, the bytecode's code hash, its hash type).
 */
import * as bindings from "@ckb-js-std/bindings";
import { HighLevel } from "@ckb-js-std/core";

const enum Error {
  BadArgs = 10,
  NotAuthorized = 11,
  OutflowExceeded = 12,
  RecipientNotAllowed = 13,
  RateLimited = 14,
  CapacityOverflow = 15,
}

const VM_ARGS_PREFIX = 35;
const U64_MAX = 2n ** 64n - 1n;
const SINCE_FLAGS_MASK = 0b111n << 61n;
const SINCE_RELATIVE_BLOCKS = 0b100n << 61n;
const SINCE_VALUE_MASK = (1n << 56n) - 1n;

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const bytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

function main(): number {
  const all = bytes(HighLevel.loadScript().args);
  const raw = all.subarray(VM_ARGS_PREFIX);
  if (raw.length !== 80 && raw.length !== 112) return Error.BadArgs;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const ownerLockHash = raw.subarray(0, 32);
  const sessionLockHash = raw.subarray(32, 64);
  const maxPerTx = view.getBigUint64(64, true);
  const minInterval = view.getBigUint64(72, true);
  const recipientLockHash = raw.length === 112 ? raw.subarray(80, 112) : null;

  let ownerPresent = false;
  let sessionPresent = false;
  for (const lock of new HighLevel.QueryIter(HighLevel.loadCellLockHash, bindings.SOURCE_INPUT)) {
    const l = bytes(lock);
    ownerPresent ||= equal(l, ownerLockHash);
    sessionPresent ||= equal(l, sessionLockHash);
  }
  if (ownerPresent) return 0; // owner mode
  if (!sessionPresent) return Error.NotAuthorized;

  if (minInterval > 0n) {
    for (const since of new HighLevel.QueryIter(HighLevel.loadInputSince, bindings.SOURCE_GROUP_INPUT)) {
      const relativeBlocks = (since & SINCE_FLAGS_MASK) === SINCE_RELATIVE_BLOCKS;
      if (!relativeBlocks || (since & SINCE_VALUE_MASK) < minInterval) return Error.RateLimited;
    }
  }

  const ownHash = bytes(HighLevel.loadScriptHash());

  let spent = 0n;
  for (const c of new HighLevel.QueryIter(HighLevel.loadCellCapacity, bindings.SOURCE_GROUP_INPUT)) {
    spent += c;
    if (spent > U64_MAX) return Error.CapacityOverflow;
  }
  let change = 0n;
  let i = 0;
  for (const lock of new HighLevel.QueryIter(HighLevel.loadCellLockHash, bindings.SOURCE_OUTPUT)) {
    const l = bytes(lock);
    if (equal(l, ownHash)) {
      change += HighLevel.loadCellCapacity(i, bindings.SOURCE_OUTPUT);
      if (change > U64_MAX) return Error.CapacityOverflow;
    } else if (recipientLockHash) {
      const allowed = equal(l, recipientLockHash) || equal(l, sessionLockHash) || equal(l, ownerLockHash);
      if (!allowed) return Error.RecipientNotAllowed;
    }
    i++;
  }
  const outflow = spent > change ? spent - change : 0n;
  if (outflow > maxPerTx) return Error.OutflowExceeded;
  return 0;
}

bindings.exit(main());

/**
 * session-lock, ported line for line to TypeScript for ckb-js-vm.
 *
 * The reference is the Rust lock in ckb-session-kit
 * (contracts/session-lock/src/main.rs, unchanged since ba1fa58). Same args, same
 * rules in the same order, same error codes — the comparison harness fails if the
 * two ever disagree on accept/reject. The only difference is where the args
 * start: ckb-js-vm reserves the first 35 bytes of a script's args (2 flag bytes,
 * the bytecode's code hash, its hash type).
 *
 * Plain CKB sessions (80 or 112-byte args) and token sessions (128 or 160 bytes:
 * an xUDT type hash and a u128 max_per_tx_token before the optional recipient).
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
  TooManyChangeCells = 16,
  KeyCellGrew = 17,
  TypedCell = 18,
  TokenData = 19,
  TokenOutflowExceeded = 20,
}

const VM_ARGS_PREFIX = 35;
const U64_MAX = 2n ** 64n - 1n;
const U128_MAX = 2n ** 128n - 1n;
const SINCE_FLAGS_MASK = 0b111n << 61n;
const SINCE_RELATIVE_BLOCKS = 0b100n << 61n;
const SINCE_VALUE_MASK = (1n << 56n) - 1n;

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const bytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

/** What a cell is to a token session: untyped, the token (amount null if under 16 data bytes), or any other type. */
type Held = { kind: "untyped" } | { kind: "token"; amount: bigint | null; len: number } | { kind: "other" };

function held(tokenTypeHash: Uint8Array, index: number, source: bindings.SourceType): Held {
  const type = HighLevel.loadCellTypeHash(index, source);
  if (type === null) return { kind: "untyped" };
  if (!equal(bytes(type), tokenTypeHash)) return { kind: "other" };
  const data = bytes(HighLevel.loadCellData(index, source));
  if (data.length < 16) return { kind: "token", amount: null, len: data.length };
  const view = new DataView(data.buffer, data.byteOffset, 16);
  return { kind: "token", amount: view.getBigUint64(0, true) | (view.getBigUint64(8, true) << 64n), len: data.length };
}

const hasType = (index: number, source: bindings.SourceType) => HighLevel.loadCellTypeHash(index, source) !== null;

function main(): number {
  const all = bytes(HighLevel.loadScript().args);
  const raw = all.subarray(VM_ARGS_PREFIX);
  let tokenSession: boolean;
  let recipientAt: number | null;
  switch (raw.length) {
    case 80: [tokenSession, recipientAt] = [false, null]; break;
    case 112: [tokenSession, recipientAt] = [false, 80]; break;
    case 128: [tokenSession, recipientAt] = [true, null]; break;
    case 160: [tokenSession, recipientAt] = [true, 128]; break;
    default: return Error.BadArgs;
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const ownerLockHash = raw.subarray(0, 32);
  const sessionLockHash = raw.subarray(32, 64);
  const maxPerTx = view.getBigUint64(64, true);
  const minInterval = view.getBigUint64(72, true);
  const token = tokenSession
    ? { typeHash: raw.subarray(80, 112), maxPerTx: view.getBigUint64(112, true) | (view.getBigUint64(120, true) << 64n) }
    : null;
  const recipientLockHash = recipientAt === null ? null : raw.subarray(recipientAt, recipientAt + 32);

  let ownerPresent = false;
  let sessionPresent = false;
  let keyIn = 0n;
  let i = 0;
  for (const lock of new HighLevel.QueryIter(HighLevel.loadCellLockHash, bindings.SOURCE_INPUT)) {
    const l = bytes(lock);
    ownerPresent ||= equal(l, ownerLockHash);
    if (equal(l, sessionLockHash)) {
      sessionPresent = true;
      if (recipientLockHash) {
        // Saturating: this runs before the owner-mode return, which nothing may fail.
        keyIn += HighLevel.loadCellCapacity(i, bindings.SOURCE_INPUT);
        if (keyIn > U64_MAX) keyIn = U64_MAX;
      }
    }
    i++;
  }
  if (ownerPresent) return 0; // owner mode
  if (!sessionPresent) return Error.NotAuthorized;

  // Session mode from here on.

  // Tokens entering from this group (rule 6); with no token, rule 5 refuses any type.
  let tokenIn = 0n;
  if (!token) {
    for (const typed of new HighLevel.QueryIter(hasType, bindings.SOURCE_GROUP_INPUT)) {
      if (typed) return Error.TypedCell;
    }
  } else {
    const heldIn = (index: number, source: bindings.SourceType) => held(token.typeHash, index, source);
    for (const cell of new HighLevel.QueryIter(heldIn, bindings.SOURCE_GROUP_INPUT)) {
      if (cell.kind === "other") return Error.TypedCell;
      if (cell.kind === "token") {
        if (cell.amount === null) return Error.TokenData;
        tokenIn += cell.amount;
        if (tokenIn > U128_MAX) return Error.CapacityOverflow;
      }
    }
  }

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
  let changeCells = 0;
  let keyOut = 0n;
  let tokenChange = 0n;
  let keyTokenOut = 0n;
  i = 0;
  for (const lock of new HighLevel.QueryIter(HighLevel.loadCellLockHash, bindings.SOURCE_OUTPUT)) {
    const l = bytes(lock);
    if (equal(l, ownHash)) {
      if (++changeCells > 1) return Error.TooManyChangeCells;
      if (!token) {
        if (hasType(i, bindings.SOURCE_OUTPUT)) return Error.TypedCell;
      } else {
        const cell = held(token.typeHash, i, bindings.SOURCE_OUTPUT);
        if (cell.kind === "other") return Error.TypedCell;
        if (cell.kind === "token") {
          // Exactly the amount: no xUDT extension data in the change.
          if (cell.amount === null || cell.len !== 16) return Error.TokenData;
          tokenChange = cell.amount;
        }
      }
      change += HighLevel.loadCellCapacity(i, bindings.SOURCE_OUTPUT);
      if (change > U64_MAX) return Error.CapacityOverflow;
    } else if (recipientLockHash) {
      if (equal(l, sessionLockHash)) {
        keyOut += HighLevel.loadCellCapacity(i, bindings.SOURCE_OUTPUT);
        if (keyOut > U64_MAX) return Error.CapacityOverflow;
        if (token) {
          const cell = held(token.typeHash, i, bindings.SOURCE_OUTPUT);
          if (cell.kind === "token") {
            if (cell.amount === null) return Error.TokenData;
            keyTokenOut += cell.amount;
            if (keyTokenOut > U128_MAX) return Error.CapacityOverflow;
          }
        }
      } else if (!equal(l, recipientLockHash) && !equal(l, ownerLockHash)) {
        return Error.RecipientNotAllowed;
      } else {
        // Paid plainly or in the token, never in a cell typed by a script the key controls.
        const foreign = token
          ? held(token.typeHash, i, bindings.SOURCE_OUTPUT).kind === "other"
          : hasType(i, bindings.SOURCE_OUTPUT);
        if (foreign) return Error.TypedCell;
      }
    }
    i++;
  }
  if (keyOut > keyIn) return Error.KeyCellGrew;
  // Topping the cell up (change > spent) is an outflow of zero.
  const outflow = spent > change ? spent - change : 0n;
  if (outflow > maxPerTx) return Error.OutflowExceeded;

  if (token) {
    if (recipientLockHash) {
      // Tokens the key's own cells brought in, read only now, in session mode.
      let keyTokenIn = 0n;
      i = 0;
      for (const lock of new HighLevel.QueryIter(HighLevel.loadCellLockHash, bindings.SOURCE_INPUT)) {
        if (equal(bytes(lock), sessionLockHash)) {
          const cell = held(token.typeHash, i, bindings.SOURCE_INPUT);
          if (cell.kind === "token" && cell.amount !== null) {
            keyTokenIn += cell.amount;
            if (keyTokenIn > U128_MAX) return Error.CapacityOverflow;
          }
        }
        i++;
      }
      if (keyTokenOut > keyTokenIn) return Error.KeyCellGrew;
    }
    // As with capacity, a token top-up (change > in) is an outflow of zero.
    const tokenOutflow = tokenIn > tokenChange ? tokenIn - tokenChange : 0n;
    if (tokenOutflow > token.maxPerTx) return Error.TokenOutflowExceeded;
  }
  return 0;
}

bindings.exit(main());

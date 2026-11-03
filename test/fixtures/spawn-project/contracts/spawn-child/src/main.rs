//! The spawned script: never a lock or type script itself. Its one argument
//! is the hex of a byte, `rounds`; it runs `child_work` rounds * 64 times,
//! writes the result (u64 LE) to its one inherited fd and exits 0. Rounds
//! 0xff is an illegal run: it exits 9 without answering.
#![no_std]
#![no_main]

use ckb_std::env::argv;
use ckb_std::high_level::{decode_hex, inherited_fds};
use ckb_std::syscalls::write;
use ckb_std::{default_alloc, entry};
use core::hint::black_box;

entry!(program_entry);
default_alloc!();

#[inline(never)]
fn child_work(seed: u64) -> u64 {
    let mut x = seed;
    for _ in 0..16 {
        x = black_box(x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407));
    }
    x
}

fn program_entry() -> i8 {
    let args = argv();
    if args.len() != 1 {
        return 1;
    }
    let Ok(raw) = decode_hex(&args[0]) else { return 1 };
    if raw.len() != 1 {
        return 1;
    }
    if raw[0] == 0xff {
        return 9;
    }
    let fds = inherited_fds();
    if fds.len() != 1 {
        return 3;
    }
    let mut acc = 0u64;
    for i in 0..raw[0] as u64 * 64 {
        acc ^= child_work(i);
    }
    let bytes = acc.to_le_bytes();
    let mut sent = 0;
    while sent < bytes.len() {
        match write(fds[0], &bytes[sent..]) {
            Ok(0) | Err(_) => return 3,
            Ok(n) => sent += n,
        }
    }
    0
}

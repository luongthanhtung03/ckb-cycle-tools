//! A lock that spawns a child script and accepts only if the child answers.
//!
//! Its input cell's data is `child data2 hash (32 bytes) ‖ rounds (1 byte)`.
//! It does some work of its own (`parent_work`), spawns the child found by
//! that hash with `hex(rounds)` as its one argument and the write end of a
//! pipe, reads the child's 8-byte answer, and waits for it to exit. Exit
//! codes: 0 the child answered and exited 0; 4 bad cell data; 5 spawn
//! failed (no such child); 6 the pipe broke; 7 the child exited non-zero.
#![no_std]
#![no_main]

use ckb_std::ckb_types::core::ScriptHashType;
use ckb_std::high_level::{encode_hex, load_cell_data, spawn_cell};
use ckb_std::syscalls::{pipe, read, wait};
use ckb_std::{ckb_constants::Source, default_alloc, entry};
use core::hint::black_box;

entry!(program_entry);
default_alloc!();

#[inline(never)]
fn parent_work(seed: u64) -> u64 {
    let mut x = seed;
    for _ in 0..512 {
        x = black_box(x.wrapping_mul(2862933555777941757).wrapping_add(3037000493));
    }
    x
}

fn program_entry() -> i8 {
    let Ok(data) = load_cell_data(0, Source::GroupInput) else { return 4 };
    if data.len() != 33 {
        return 4;
    }
    black_box(parent_work(data[32] as u64));
    let arg = encode_hex(&data[32..33]);
    let Ok((reader, writer)) = pipe() else { return 6 };
    let Ok(pid) = spawn_cell(&data[..32], ScriptHashType::Data2, &[arg.as_c_str()], &[writer]) else { return 5 };
    let mut answer = [0u8; 8];
    let mut got = 0;
    while got < answer.len() {
        match read(reader, &mut answer[got..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => got += n,
        }
    }
    match wait(pid) {
        Ok(0) if got == answer.len() => 0,
        Ok(0) => 6,
        _ => 7,
    }
}

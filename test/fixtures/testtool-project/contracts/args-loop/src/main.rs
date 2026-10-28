//! A lock whose cost is set by its args: it runs `work` args[0] * 64 times,
//! and rejects (exit 5) a script with empty args. No ckb-std, so it builds
//! with rustup's riscv64imac target alone.
#![no_std]
#![no_main]

use core::arch::asm;
use core::hint::black_box;
use core::panic::PanicInfo;

const SYS_EXIT: u64 = 93;
const SYS_LOAD_SCRIPT: u64 = 2052;

fn exit(code: i8) -> ! {
    unsafe { asm!("ecall", in("a0") code as u64, in("a7") SYS_EXIT, options(noreturn)) }
}

fn load_script(buf: &mut [u8]) -> usize {
    let mut len = buf.len() as u64;
    let ret: u64;
    unsafe {
        asm!("ecall", inlateout("a0") buf.as_mut_ptr() as u64 => ret, in("a1") &mut len as *mut u64,
             in("a2") 0u64, in("a7") SYS_LOAD_SCRIPT);
    }
    if ret != 0 {
        exit(1);
    }
    len as usize
}

fn u32_at(buf: &[u8], at: usize) -> usize {
    u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]]) as usize
}

#[inline(never)]
fn work(seed: u64) -> u64 {
    let mut x = seed;
    for _ in 0..16 {
        x = black_box(x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407));
    }
    x
}

#[unsafe(no_mangle)]
pub extern "C" fn _start() -> ! {
    let mut buf = [0u8; 256];
    let len = load_script(&mut buf);
    if len > buf.len() {
        exit(2);
    }
    // Script is a molecule table: total size, three field offsets; args (field 2) is Bytes.
    let args_at = u32_at(&buf, 12);
    let args_len = u32_at(&buf, args_at);
    if args_len == 0 {
        exit(5);
    }
    let rounds = buf[args_at + 4] as u64 * 64;
    let mut acc = 0u64;
    for i in 0..rounds {
        acc ^= work(i);
    }
    black_box(acc);
    exit(0)
}

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    exit(-1)
}

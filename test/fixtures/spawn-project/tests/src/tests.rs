//! A parent lock that spawns a child script found by the data2 hash in its
//! cell's data, as a match script spawns a game script. Each test prints the
//! cycles ckb-testtool's verifier (the node's ckb-script) counted, so the
//! report's numbers can be checked against them.
use crate::load_binary;
use ckb_cycles_testtool::verify_tx;
use ckb_testtool::ckb_hash::blake2b_256;
use ckb_testtool::ckb_types::{bytes::Bytes, core::TransactionBuilder, core::TransactionView, packed::*, prelude::*};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 10_000_000;

/// One input locked by spawn-parent whose data names `child` (a data2 hash) and `rounds`.
fn spend(context: &mut Context, child: [u8; 32], rounds: u8) -> TransactionView {
    let parent = context.deploy_cell(load_binary("spawn-parent"));
    context.deploy_cell(load_binary("spawn-child"));
    let lock = context.build_script(&parent, Bytes::new()).expect("script");
    let mut data = child.to_vec();
    data.push(rounds);
    let input = context.create_cell(CellOutput::new_builder().capacity(1000u64).lock(lock.clone()).build(), data.into());
    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(input).build())
        .output(CellOutput::new_builder().capacity(1000u64).lock(lock).build())
        .output_data(Bytes::new().pack())
        .build();
    context.complete_tx(tx)
}

fn child_hash() -> [u8; 32] {
    blake2b_256(load_binary("spawn-child"))
}

#[test]
fn test_spawn_light() {
    let mut context = Context::default();
    let tx = spend(&mut context, child_hash(), 1);
    let cycles = verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
    println!("ckb-testtool cycles: {cycles}");
}

#[test]
fn test_spawn_heavy() {
    let mut context = Context::default();
    let tx = spend(&mut context, child_hash(), 40);
    let cycles = verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
    println!("ckb-testtool cycles: {cycles}");
}

#[test]
fn test_spawn_child_rejects() {
    let mut context = Context::default();
    let tx = spend(&mut context, child_hash(), 0xff);
    verify_tx(&context, &tx, MAX_CYCLES).expect_err("the child refuses rounds 0xff");
}

#[test]
fn test_spawn_no_such_child() {
    let mut context = Context::default();
    let tx = spend(&mut context, [0xde; 32], 1);
    verify_tx(&context, &tx, MAX_CYCLES).expect_err("no cell dep has that hash");
}

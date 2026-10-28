use crate::load_binary;
use ckb_cycles_testtool::verify_tx;
use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{bytes::Bytes, core::TransactionBuilder, core::TransactionView, packed::*, prelude::*};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 10_000_000;

/// One input locked by args-loop with these args, one output.
fn spend(context: &mut Context, args: &[u8]) -> TransactionView {
    let out_point = context.deploy_cell(load_binary("args-loop"));
    let lock = context.build_script(&out_point, Bytes::copy_from_slice(args)).expect("script");
    let input = context.create_cell(CellOutput::new_builder().capacity(1000u64).lock(lock.clone()).build(), Bytes::new());
    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(input).build())
        .output(CellOutput::new_builder().capacity(1000u64).lock(lock).build())
        .output_data(Bytes::new().pack())
        .build();
    context.complete_tx(tx)
}

#[test]
fn test_light_spend() {
    let mut context = Context::default();
    let tx = spend(&mut context, &[2]);
    verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
}

#[test]
fn test_heavy_spend() {
    let mut context = Context::default();
    let tx = spend(&mut context, &[40]);
    verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
}

#[test]
fn test_empty_args_rejected() {
    let mut context = Context::default();
    let tx = spend(&mut context, &[]);
    verify_tx(&context, &tx, MAX_CYCLES).expect_err("empty args must be rejected");
}

#[test]
fn test_beside_always_success() {
    // Two lock groups: args-loop, and ckb-testtool's built-in always-success.
    let mut context = Context::default();
    let tx = spend(&mut context, &[8]);
    let always = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let lock = context.build_script(&always, Bytes::new()).expect("script");
    let extra = context.create_cell(CellOutput::new_builder().capacity(500u64).lock(lock).build(), Bytes::new());
    let tx = tx.as_advanced_builder().input(CellInput::new_builder().previous_output(extra).build()).build();
    let tx = context.complete_tx(tx);
    verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
}

#[test]
fn test_two_transactions() {
    let mut context = Context::default();
    for args in [[1u8], [16u8]] {
        let tx = spend(&mut context, &args);
        verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
    }
}

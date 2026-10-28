//! Writes the transactions a ckb-testtool test verifies as ckb-debugger mock
//! transactions, so `ckb-cycles scan` can turn a test suite into a cycles.json.
//!
//! Use [`verify_tx`] where a test calls `context.verify_tx`. It returns the same
//! result. When the `CKB_CYCLES_MOCKS` environment variable names a directory,
//! it also writes the transaction there (accepted or rejected) as
//! `<test path>.json`; without the variable it writes nothing.
//!
//! ```ignore
//! let cycles = ckb_cycles_testtool::verify_tx(&context, &tx, MAX_CYCLES).expect("pass verification");
//! ```

use ckb_testtool::ckb_error::Error;
use ckb_testtool::ckb_types::core::{Cycle, TransactionView};
use ckb_testtool::context::Context;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// The environment variable naming the directory mocks are written to.
pub const MOCKS_ENV: &str = "CKB_CYCLES_MOCKS";

/// `context.verify_tx(tx, max_cycles)`, and the transaction written to
/// `$CKB_CYCLES_MOCKS/<test path>.json` when that variable is set.
///
/// The name is the running test's (libtest names each test's thread after it):
/// `tests::test_transfer` is written as `tests.test_transfer.json`, a second
/// transaction in the same test as `tests.test_transfer-2.json`.
pub fn verify_tx(context: &Context, tx: &TransactionView, max_cycles: u64) -> Result<Cycle, Error> {
    let result = context.verify_tx(tx, max_cycles);
    if std::env::var_os(MOCKS_ENV).is_some() {
        let name = std::thread::current()
            .name()
            .filter(|n| *n != "main")
            .unwrap_or("tx")
            .to_string();
        dump_tx(context, tx, &name);
    }
    result
}

/// Writes `tx` to `$CKB_CYCLES_MOCKS/<name>.json` (`::` becomes `.`, anything
/// else outside `[A-Za-z0-9._-]` becomes `_`). A name written before in this
/// process gets `-2`, `-3`, ... Does nothing when the variable is not set.
/// Returns the path written.
pub fn dump_tx(context: &Context, tx: &TransactionView, name: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os(MOCKS_ENV)?);
    let mock = context.dump_tx(tx).expect("ckb-testtool could not dump the transaction");
    let json = serde_json::to_string_pretty(&mock).expect("mock transaction as JSON");
    let file = dir.join(format!("{}.json", unique(&file_name(name))));
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{MOCKS_ENV}: cannot create {dir:?}: {e}"));
    std::fs::write(&file, json).unwrap_or_else(|e| panic!("{MOCKS_ENV}: cannot write {file:?}: {e}"));
    Some(file)
}

fn file_name(name: &str) -> String {
    name.replace("::", ".")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .collect()
}

/// `name`, or `name-2`, `name-3`, ... for the second and later uses in this process.
fn unique(name: &str) -> String {
    static SEEN: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let count = seen.get_or_insert_with(HashMap::new).entry(name.to_string()).or_insert(0);
    *count += 1;
    if *count == 1 { name.to_string() } else { format!("{name}-{count}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_safe() {
        assert_eq!(file_name("tests::test_transfer"), "tests.test_transfer");
        assert_eq!(file_name(r"a b/c\d:e"), "a_b_c_d_e");
    }

    #[test]
    fn a_name_used_again_gets_a_number() {
        assert_eq!(unique("unique-test"), "unique-test");
        assert_eq!(unique("unique-test"), "unique-test-2");
        assert_eq!(unique("unique-test"), "unique-test-3");
    }
}

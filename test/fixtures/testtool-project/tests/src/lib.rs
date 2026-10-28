use ckb_testtool::ckb_types::bytes::Bytes;
use std::path::PathBuf;

#[cfg(test)]
mod tests;

/// build/release/<name>, as the template's Loader finds it.
pub fn load_binary(name: &str) -> Bytes {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../build/release").join(name);
    std::fs::read(&path).unwrap_or_else(|_| panic!("{path:?} is missing: run make build")).into()
}

//! Framework-agnostic core logic.
//!
//! Everything in here must stay byte/semantics-compatible with the v1
//! (Electron) app's on-disk formats so users can swap binaries freely.
//! See docs/rust-rewrite/README.md §4 for the compatibility contract.

pub mod clients;
pub mod fs_retry;
pub mod launch;
pub mod linking;
pub mod paths;
pub mod process;
pub mod settings;
pub mod stats;

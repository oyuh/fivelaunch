//! Framework-agnostic core logic.
//!
//! Everything in here must stay byte/semantics-compatible with the v1
//! (Electron) app's on-disk formats so users can swap binaries freely.
//! See PLAN.md §4 for the compatibility contract.

pub mod args;
pub mod clients;
pub mod file_sync;
pub mod fs_retry;
pub mod gta_settings;
pub mod hash;
pub mod launch;
pub mod linking;
pub mod log_store;
pub mod mirror;
pub mod paths;
pub mod plugins_sync;
pub mod process;
pub mod reshade;
pub mod settings;
pub mod shortcut;
pub mod stats;
pub mod update_checker;

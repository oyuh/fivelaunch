//! Main-process log store — port of v1 `app/logging.ts`.
//!
//! A bounded ring buffer of log entries the UI can fetch (`get_app_logs`)
//! plus live forwarding via the `app-log` event. Instead of v1's console
//! monkey-patching, v2 installs a `log::Log` implementation so every
//! `log::info!/warn!/error!` in the app lands here.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const APP_LOG_BUFFER_LIMIT: usize = 800;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppLogEntry {
    pub id: u64,
    pub ts: u64,
    pub level: String, // 'debug' | 'info' | 'warn' | 'error'
    pub message: String,
}

#[derive(Default)]
pub struct LogStore {
    entries: Mutex<VecDeque<AppLogEntry>>,
    seq: AtomicU64,
}

impl LogStore {
    pub fn push(&self, level: &str, message: String) -> AppLogEntry {
        let entry = AppLogEntry {
            id: self.seq.fetch_add(1, Ordering::SeqCst) + 1,
            ts: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            level: level.to_string(),
            message,
        };

        if let Ok(mut entries) = self.entries.lock() {
            entries.push_back(entry.clone());
            while entries.len() > APP_LOG_BUFFER_LIMIT {
                entries.pop_front();
            }
        }
        entry
    }

    pub fn get_logs(&self) -> Vec<AppLogEntry> {
        self.entries
            .lock()
            .map(|e| e.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
}

fn level_str(level: log::Level) -> &'static str {
    match level {
        log::Level::Error => "error",
        log::Level::Warn => "warn",
        log::Level::Debug | log::Level::Trace => "debug",
        log::Level::Info => "info",
    }
}

/// Global logger: stderr + store + live `app-log` event to the UI.
///
/// Captures everything from our own crate, and warnings/errors from
/// dependencies (tao/wry noise stays out of the user-visible log).
pub struct StoreLogger {
    store: std::sync::Arc<LogStore>,
    emit: Box<dyn Fn(&AppLogEntry) + Send + Sync>,
}

impl StoreLogger {
    pub fn install(
        store: std::sync::Arc<LogStore>,
        emit: Box<dyn Fn(&AppLogEntry) + Send + Sync>,
    ) {
        let logger = Box::new(StoreLogger { store, emit });
        if log::set_boxed_logger(logger).is_ok() {
            log::set_max_level(log::LevelFilter::Info);
        }
    }

    fn wants(record: &log::Record<'_>) -> bool {
        record.target().starts_with("fivelaunch") || record.level() <= log::Level::Warn
    }
}

impl log::Log for StoreLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) || !Self::wants(record) {
            return;
        }
        let message = format!("{}", record.args());
        eprintln!("[{}] {}", record.level(), message);
        let entry = self.store.push(level_str(record.level()), message);
        (self.emit)(&entry);
    }

    fn flush(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_assigns_ids_and_caps_buffer() {
        let store = LogStore::default();
        for i in 0..900 {
            store.push("info", format!("message {i}"));
        }

        let logs = store.get_logs();
        assert_eq!(logs.len(), APP_LOG_BUFFER_LIMIT);
        // Oldest entries dropped; ids keep counting.
        assert_eq!(logs.first().unwrap().message, "message 100");
        assert_eq!(logs.last().unwrap().id, 900);

        store.clear();
        assert!(store.get_logs().is_empty());
    }

    #[test]
    fn entry_serializes_to_v1_shape() {
        let store = LogStore::default();
        let entry = store.push("warn", "careful".into());
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"level\":\"warn\""));
        assert!(json.contains("\"message\":\"careful\""));
        assert!(json.contains("\"ts\":"));
    }
}

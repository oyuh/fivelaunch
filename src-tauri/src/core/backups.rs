//! Central backup store.
//!
//! Instead of littering FiveM.app / CitizenFX with `_original` and
//! `_backup_<ts>` siblings (v1 behavior), everything FiveLaunch moves aside
//! lands in `%APPDATA%\FiveLaunch\backups\<kind>_<epoch_ms>`, browsable from
//! the History dialog in the app.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::fs_retry::rename_with_retry;
use super::paths::AppPaths;
use super::stats::folder_stats;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    /// Directory/file name inside the backups root (`<kind>_<epoch_ms>`).
    pub name: String,
    pub path: String,
    /// Human-readable label (the `<kind>` part).
    pub kind: String,
    pub created_ms: u64,
    pub is_dir: bool,
    pub total_bytes: u64,
    pub file_count: u64,
}

pub fn backups_root(app_paths: &AppPaths) -> PathBuf {
    app_paths.app_data.join("backups")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        // Never follow links out of the tree being backed up.
        return Ok(());
    }
    if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst).map(|_| ())
    }
}

/// Move a file or directory into the central backup store, returning the
/// backup's new path. Uses rename when possible; falls back to copy+delete
/// for cross-volume moves (FiveM on another drive than %APPDATA%).
pub fn move_into_backups(
    backups_dir: &Path,
    source: &Path,
    kind: &str,
) -> Result<PathBuf, String> {
    fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let dest = backups_dir.join(format!("{kind}_{}", now_ms()));

    match rename_with_retry(source, &dest) {
        Ok(()) => Ok(dest),
        Err(rename_err) => {
            // Cross-volume (or exotic) failure: copy then delete.
            copy_recursive(source, &dest).map_err(|copy_err| {
                format!(
                    "Failed to back up {} (rename: {rename_err}; copy: {copy_err}). Close FiveM/overlays and try again.",
                    source.display()
                )
            })?;
            let remove_result = if source.is_dir() {
                fs::remove_dir_all(source)
            } else {
                fs::remove_file(source)
            };
            remove_result.map_err(|e| {
                format!(
                    "Backed up {} but could not remove the original: {e}. Close FiveM/overlays and try again.",
                    source.display()
                )
            })?;
            Ok(dest)
        }
    }
}

/// Copy (not move) a file into the store — used for settings files that must
/// stay in place while we overwrite them.
pub fn copy_into_backups(
    backups_dir: &Path,
    source: &Path,
    kind: &str,
) -> Result<PathBuf, String> {
    fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let dest = backups_dir.join(format!("{kind}_{}", now_ms()));
    copy_recursive(source, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Parse `<kind>_<epoch_ms>` back into its parts.
fn parse_entry_name(name: &str) -> (String, u64) {
    match name.rsplit_once('_') {
        Some((kind, ms)) => match ms.parse::<u64>() {
            Ok(ms) if ms > 1_000_000_000_000 => (kind.to_string(), ms),
            _ => (name.to_string(), 0),
        },
        None => (name.to_string(), 0),
    }
}

pub fn list_backups(backups_dir: &Path) -> Vec<BackupEntry> {
    let Ok(entries) = fs::read_dir(backups_dir) else {
        return Vec::new();
    };

    let mut out: Vec<BackupEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let meta = entry.metadata().ok()?;
            let (kind, created_ms) = parse_entry_name(&name);

            let (total_bytes, file_count) = if meta.is_dir() {
                let stats = folder_stats(&path);
                (stats.total_bytes, stats.file_count)
            } else {
                (meta.len(), 1)
            };

            Some(BackupEntry {
                name,
                path: path.to_string_lossy().to_string(),
                kind,
                created_ms,
                is_dir: meta.is_dir(),
                total_bytes,
                file_count,
            })
        })
        .collect();

    // Newest first.
    out.sort_by_key(|e| std::cmp::Reverse(e.created_ms));
    out
}

/// Delete one backup by name. The name must be a direct child of the store —
/// no path components allowed.
pub fn delete_backup(backups_dir: &Path, name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err("Invalid backup name.".into());
    }

    let path = backups_dir.join(name);
    if !path.exists() {
        return Err("Backup not found.".into());
    }

    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_directory_into_store_and_lists_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("backups");
        let victim = dir.path().join("mods");
        fs::create_dir_all(victim.join("sub")).unwrap();
        fs::write(victim.join("a.rpf"), vec![1u8; 100]).unwrap();
        fs::write(victim.join("sub").join("b.rpf"), vec![1u8; 50]).unwrap();

        let dest = move_into_backups(&store, &victim, "mods").unwrap();

        assert!(!victim.exists(), "original must be gone");
        assert!(dest.join("a.rpf").exists());
        assert!(dest.join("sub").join("b.rpf").exists());

        let entries = list_backups(&store);
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.kind, "mods");
        assert!(entry.created_ms > 1_000_000_000_000);
        assert_eq!(entry.total_bytes, 150);
        assert_eq!(entry.file_count, 2);
        assert!(entry.is_dir);
    }

    #[test]
    fn copies_file_into_store_keeping_original() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("backups");
        let file = dir.path().join("gta5_settings.xml");
        fs::write(&file, "<Settings/>").unwrap();

        let dest = copy_into_backups(&store, &file, "gta5_settings.xml").unwrap();

        assert!(file.exists(), "original stays in place");
        assert_eq!(fs::read_to_string(dest).unwrap(), "<Settings/>");
    }

    #[test]
    fn list_is_newest_first_and_delete_is_guarded() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("backups");
        fs::create_dir_all(&store).unwrap();
        fs::create_dir_all(store.join("plugins_1700000000001")).unwrap();
        fs::create_dir_all(store.join("mods_1700000000002")).unwrap();

        let entries = list_backups(&store);
        assert_eq!(entries[0].kind, "mods");
        assert_eq!(entries[1].kind, "plugins");

        assert!(delete_backup(&store, "../evil").is_err());
        assert!(delete_backup(&store, "a\\b").is_err());
        assert!(delete_backup(&store, "missing_123").is_err());

        delete_backup(&store, "mods_1700000000002").unwrap();
        assert_eq!(list_backups(&store).len(), 1);
    }
}

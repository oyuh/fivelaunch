use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::fs_retry::rename_with_retry;

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

/// Merge files from `from_dir` into `to_dir` without overwriting existing
/// files. Port of v1 `mergeFolderContents` — used as a non-destructive
/// migration step before switching a folder to junction mode.
fn merge_folder_contents(from_dir: &Path, to_dir: &Path) {
    if fs::create_dir_all(to_dir).is_err() {
        return;
    }

    let Ok(entries) = fs::read_dir(from_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let from_path = entry.path();
        let to_path = to_dir.join(entry.file_name());

        let Ok(meta) = fs::symlink_metadata(&from_path) else {
            continue;
        };

        if meta.file_type().is_symlink() {
            continue;
        }

        if meta.is_dir() {
            merge_folder_contents(&from_path, &to_path);
            continue;
        }

        if meta.is_file() && !to_path.exists() {
            // Best-effort, like v1 copyFileBestEffort.
            if let Some(parent) = to_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::copy(&from_path, &to_path);
        }
    }
}

/// Replace a real directory at `target` with a junction pointing at `source`.
///
/// Port of v1 `linkFolder`:
/// - ensures `source` exists
/// - an existing link at `target` is removed
/// - an existing real directory is renamed to `{target}_original` (first
///   time) or `{target}_backup_{timestamp}` (when a backup already exists)
/// - with `migrate_existing`, game-side files are merged into `source`
///   (non-destructively) before the takeover
pub fn link_folder(source: &Path, target: &Path, migrate_existing: bool) -> Result<(), String> {
    if !source.exists() {
        fs::create_dir_all(source).map_err(|e| e.to_string())?;
    }

    if let Ok(meta) = fs::symlink_metadata(target) {
        if meta.file_type().is_symlink() {
            // Already a link (junction or symlink) — remove it.
            fs::remove_dir(target)
                .or_else(|_| fs::remove_file(target))
                .map_err(|e| format!("Failed to remove existing link {}: {e}", target.display()))?;
        } else if meta.is_dir() {
            if migrate_existing {
                merge_folder_contents(target, source);
            }

            let backup_path = with_suffix(target, "_original");
            if !backup_path.exists() {
                rename_with_retry(target, &backup_path).map_err(|err| {
                    format!(
                        "Failed to back up existing folder (code={}): {}. Close FiveM/any overlays and try again.",
                        err.raw_os_error().map_or_else(|| "unknown".into(), |c| c.to_string()),
                        target.display()
                    )
                })?;
            } else {
                let unique = with_suffix(target, &format!("_backup_{}", now_ms()));
                rename_with_retry(target, &unique).map_err(|err| {
                    format!(
                        "Failed to move existing folder aside (code={}): {}. Close FiveM/any overlays and try again.",
                        err.raw_os_error().map_or_else(|| "unknown".into(), |c| c.to_string()),
                        target.display()
                    )
                })?;
            }
        } else {
            // Unexpected file at the target path; move it aside (best effort).
            let _ = fs::rename(target, with_suffix(target, &format!("_backup_{}", now_ms())));
        }
    }

    // Junction: works for directories on Windows without admin rights.
    junction::create(source, target).map_err(|e| {
        format!(
            "Failed to create junction {} -> {}: {e}",
            target.display(),
            source.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_junction_when_target_missing() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_mods");
        let target = dir.path().join("game_mods");

        link_folder(&source, &target, false).unwrap();

        assert!(source.is_dir(), "source must be created");
        // Write through the junction, read from the source.
        fs::write(target.join("test.txt"), b"via-junction").unwrap();
        assert_eq!(fs::read(source.join("test.txt")).unwrap(), b"via-junction");
    }

    #[test]
    fn backs_up_existing_directory_as_original() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_mods");
        let target = dir.path().join("game_mods");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("orig.txt"), b"original data").unwrap();

        link_folder(&source, &target, false).unwrap();

        let backup = dir.path().join("game_mods_original");
        assert!(backup.is_dir(), "_original backup must exist");
        assert_eq!(fs::read(backup.join("orig.txt")).unwrap(), b"original data");
        // Target is now a junction to source.
        assert!(fs::symlink_metadata(&target).unwrap().file_type().is_symlink());
    }

    #[test]
    fn rotates_to_timestamped_backup_when_original_exists() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_mods");
        let target = dir.path().join("game_mods");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(dir.path().join("game_mods_original")).unwrap();

        link_folder(&source, &target, false).unwrap();

        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("game_mods_backup_"))
            .collect();
        assert_eq!(backups.len(), 1, "expected one timestamped backup");
    }

    #[test]
    fn replaces_stale_link() {
        let dir = tempfile::tempdir().unwrap();
        let old_source = dir.path().join("old_client");
        let new_source = dir.path().join("new_client");
        let target = dir.path().join("game_mods");

        link_folder(&old_source, &target, false).unwrap();
        link_folder(&new_source, &target, false).unwrap();

        fs::write(target.join("x.txt"), b"new").unwrap();
        assert!(new_source.join("x.txt").exists());
        assert!(!old_source.join("x.txt").exists());
    }

    #[test]
    fn migrate_existing_merges_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_plugins");
        let target = dir.path().join("game_plugins");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(target.join("sub")).unwrap();
        fs::write(source.join("keep.ini"), b"client wins").unwrap();
        fs::write(target.join("keep.ini"), b"game version").unwrap();
        fs::write(target.join("sub").join("preset.ini"), b"game preset").unwrap();

        link_folder(&source, &target, true).unwrap();

        // Existing client file NOT overwritten; new game file merged in.
        assert_eq!(fs::read(source.join("keep.ini")).unwrap(), b"client wins");
        assert_eq!(
            fs::read(source.join("sub").join("preset.ini")).unwrap(),
            b"game preset"
        );
    }
}

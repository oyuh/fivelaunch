use std::fs;
use std::path::Path;

use super::backups::move_into_backups;

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
/// - ensures `source` exists
/// - an existing link at `target` is removed
/// - an existing real directory is MOVED into the central backup store
///   (`backups_dir`) instead of being renamed in place — FiveM.app stays clean
/// - with `migrate_existing`, game-side files are merged into `source`
///   (non-destructively) before the takeover
pub fn link_folder(
    source: &Path,
    target: &Path,
    backups_dir: &Path,
    migrate_existing: bool,
) -> Result<(), String> {
    if !source.exists() {
        fs::create_dir_all(source).map_err(|e| e.to_string())?;
    }

    if let Ok(meta) = fs::symlink_metadata(target) {
        if meta.file_type().is_symlink() {
            // Already a link (junction or symlink) — remove it.
            fs::remove_dir(target)
                .or_else(|_| fs::remove_file(target))
                .map_err(|e| format!("Failed to remove existing link {}: {e}", target.display()))?;
        } else {
            if meta.is_dir() && migrate_existing {
                merge_folder_contents(target, source);
            }

            let kind = target
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "folder".to_string());
            move_into_backups(backups_dir, target, &kind)?;
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
    use crate::core::backups::list_backups;

    #[test]
    fn creates_junction_when_target_missing() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_mods");
        let target = dir.path().join("game_mods");
        let store = dir.path().join("backups");

        link_folder(&source, &target, &store, false).unwrap();

        assert!(source.is_dir(), "source must be created");
        // Write through the junction, read from the source.
        fs::write(target.join("test.txt"), b"via-junction").unwrap();
        assert_eq!(fs::read(source.join("test.txt")).unwrap(), b"via-junction");
        assert!(list_backups(&store).is_empty(), "nothing to back up");
    }

    #[test]
    fn moves_existing_directory_into_central_store() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_mods");
        let target = dir.path().join("game_mods");
        let store = dir.path().join("backups");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("orig.txt"), b"original data").unwrap();

        link_folder(&source, &target, &store, false).unwrap();

        // Target is now a junction to source; NO siblings left behind.
        assert!(fs::symlink_metadata(&target).unwrap().file_type().is_symlink());
        let siblings: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("game_mods_"))
            .collect();
        assert!(siblings.is_empty(), "no in-place backups: {siblings:?}");

        // The original content lives in the central store.
        let entries = list_backups(&store);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "game_mods");
        let backup_path = std::path::PathBuf::from(&entries[0].path);
        assert_eq!(fs::read(backup_path.join("orig.txt")).unwrap(), b"original data");
    }

    #[test]
    fn repeated_links_stack_backups_in_store() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_mods");
        let target = dir.path().join("game_mods");
        let store = dir.path().join("backups");

        for i in 0..2 {
            // A real dir shows up at the target again (e.g., game update).
            if fs::symlink_metadata(&target).is_ok() {
                fs::remove_dir(&target).unwrap();
            }
            fs::create_dir_all(&target).unwrap();
            fs::write(target.join(format!("gen{i}.txt")), b"x").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
            link_folder(&source, &target, &store, false).unwrap();
        }

        assert_eq!(list_backups(&store).len(), 2, "each rotation gets its own entry");
    }

    #[test]
    fn replaces_stale_link() {
        let dir = tempfile::tempdir().unwrap();
        let old_source = dir.path().join("old_client");
        let new_source = dir.path().join("new_client");
        let target = dir.path().join("game_mods");
        let store = dir.path().join("backups");

        link_folder(&old_source, &target, &store, false).unwrap();
        link_folder(&new_source, &target, &store, false).unwrap();

        fs::write(target.join("x.txt"), b"new").unwrap();
        assert!(new_source.join("x.txt").exists());
        assert!(!old_source.join("x.txt").exists());
        assert!(list_backups(&store).is_empty(), "links are never backed up");
    }

    #[test]
    fn migrate_existing_merges_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("client_plugins");
        let target = dir.path().join("game_plugins");
        let store = dir.path().join("backups");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(target.join("sub")).unwrap();
        fs::write(source.join("keep.ini"), b"client wins").unwrap();
        fs::write(target.join("keep.ini"), b"game version").unwrap();
        fs::write(target.join("sub").join("preset.ini"), b"game preset").unwrap();

        link_folder(&source, &target, &store, true).unwrap();

        // Existing client file NOT overwritten; new game file merged in.
        assert_eq!(fs::read(source.join("keep.ini")).unwrap(), b"client wins");
        assert_eq!(
            fs::read(source.join("sub").join("preset.ini")).unwrap(),
            b"game preset"
        );
    }
}

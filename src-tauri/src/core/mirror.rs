//! File mirroring engine — port of v1 `pluginsMirror.ts`.
//!
//! Semantics preserved exactly (they encode hard-won edge cases):
//! - 900ms mtime skew window (FAT/timestamp-granularity tolerance)
//! - content-compare tiebreak for two-way sync
//! - best-effort copies that tolerate locked files (game may hold them)
//! - never traverse into symlinks/junctions
//! - mtime cache keyed on *source* mtime so repeat launches skip clean files
//!
//! Dropped from v1: `yieldEvery`/`timeBudgetMs` event-loop yielding — this
//! runs on a dedicated thread in Rust, so there is no event loop to starve.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub const MTIME_SKEW_MS: f64 = 900.0;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MirrorProgress {
    pub processed: u64,
    pub copied: u64,
    pub skipped: u64,
}

/// Which side wins a two-way tie (mtimes within skew but content differs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TiePreference {
    A,
    B,
}

/// Safe `mtime` in fractional milliseconds. Returns 0.0 on error
/// (v1 `getMtimeMsSafe`). f64 keeps the persisted cache format identical
/// to v1's JS `mtimeMs` floats.
pub fn mtime_ms(path: &Path) -> f64 {
    fs::metadata(path).map(|m| mtime_ms_from_meta(&m)).unwrap_or(0.0)
}

fn mtime_ms_from_meta(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

pub fn ensure_dir_exists(dir: &Path) {
    let _ = fs::create_dir_all(dir);
}

pub fn ensure_file_exists(path: &Path, fallback_contents: &str) {
    if let Some(parent) = path.parent() {
        ensure_dir_exists(parent);
    }
    if !path.exists() {
        let _ = fs::write(path, fallback_contents);
    }
}

/// Best-effort copy that tolerates transient locks (common while the game
/// is running). Returns false on failure — callers must not poison caches
/// with failed copies.
pub fn copy_file_best_effort(source: &Path, target: &Path) -> bool {
    if let Some(parent) = target.parent() {
        ensure_dir_exists(parent);
    }
    match fs::copy(source, target) {
        Ok(_) => {
            // fsync best-effort, like v1.
            if let Ok(f) = fs::OpenOptions::new().write(true).open(target) {
                let _ = f.sync_all();
            }
            true
        }
        Err(_) => false,
    }
}

/// Two-way sync of a single file pair, newest side wins; falls back to a
/// content comparison when mtimes are within the skew window.
pub fn sync_file_prefer_newest(a: &Path, b: &Path, tie_preference: TiePreference) {
    let a_exists = a.exists();
    let b_exists = b.exists();

    if !a_exists && !b_exists {
        return;
    }
    if a_exists && !b_exists {
        ensure_file_exists(b, "");
        copy_file_best_effort(a, b);
        return;
    }
    if b_exists && !a_exists {
        ensure_file_exists(a, "");
        copy_file_best_effort(b, a);
        return;
    }

    let a_time = mtime_ms(a);
    let b_time = mtime_ms(b);

    if a_time > b_time + MTIME_SKEW_MS {
        copy_file_best_effort(a, b);
        return;
    }
    if b_time > a_time + MTIME_SKEW_MS {
        copy_file_best_effort(b, a);
        return;
    }

    // Timestamps too close to call — compare contents.
    let (Ok(a_buf), Ok(b_buf)) = (fs::read(a), fs::read(b)) else {
        return;
    };
    if a_buf != b_buf {
        match tie_preference {
            TiePreference::A => copy_file_best_effort(a, b),
            TiePreference::B => copy_file_best_effort(b, a),
        };
    }
}

/// Recursive file listing relative to `base_dir`, never entering
/// symlinks/junctions. Backslash-separated rel paths on Windows — the same
/// keys v1 wrote into its persisted mtime caches.
pub fn list_files_recursive(
    base_dir: &Path,
    filter_rel: Option<&dyn Fn(&str) -> bool>,
    max_files: Option<usize>,
) -> Vec<String> {
    list_files_with_mtime(base_dir, filter_rel, max_files)
        .into_iter()
        .map(|(rel, _)| rel)
        .collect()
}

/// Like [`list_files_recursive`], but also yields each file's mtime taken
/// from the metadata walkdir already fetched during enumeration — the mirror
/// loops below would otherwise re-stat every source file.
fn list_files_with_mtime(
    base_dir: &Path,
    filter_rel: Option<&dyn Fn(&str) -> bool>,
    max_files: Option<usize>,
) -> Vec<(String, f64)> {
    let mut out = Vec::new();

    let walker = WalkDir::new(base_dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !e.path_is_symlink());

    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(base_dir) else {
            continue;
        };
        let rel = rel.to_string_lossy().to_string();
        if let Some(filter) = filter_rel {
            if !filter(&rel) {
                continue;
            }
        }
        let mtime = entry
            .metadata()
            .map(|m| mtime_ms_from_meta(&m))
            .unwrap_or(0.0);
        out.push((rel, mtime));
        if let Some(max) = max_files {
            if out.len() >= max {
                break;
            }
        }
    }

    out
}

/// Source-authoritative mirror: copies from `source_dir` to `target_dir`
/// whenever the source changed since the cached mtime (even if the target is
/// newer). Used at launch so the per-client folder always wins.
pub fn mirror_folder_source_wins_one_way(
    source_dir: &Path,
    target_dir: &Path,
    filter_rel: Option<&dyn Fn(&str) -> bool>,
    max_files: Option<usize>,
    mut cache: Option<&mut HashMap<String, f64>>,
    mut on_progress: Option<&mut dyn FnMut(&MirrorProgress)>,
) -> MirrorProgress {
    ensure_dir_exists(source_dir);
    ensure_dir_exists(target_dir);

    let mut p = MirrorProgress::default();

    for (rel, from_time) in list_files_with_mtime(source_dir, filter_rel, max_files) {
        let from = source_dir.join(&rel);
        let to = target_dir.join(&rel);

        let cached = cache.as_ref().and_then(|c| c.get(&rel)).copied();

        // Cache check first: only stat the target when the cache says the
        // source is unchanged (the common warm-launch case).
        if cached.is_some_and(|c| (c - from_time).abs() <= MTIME_SKEW_MS) && to.exists() {
            p.skipped += 1;
        } else if copy_file_best_effort(&from, &to) {
            if let Some(c) = cache.as_deref_mut() {
                c.insert(rel, from_time);
            }
            p.copied += 1;
        } else {
            // Copy failed (locked) — don't poison the cache.
            p.skipped += 1;
        }

        p.processed += 1;
        if p.processed % 250 == 0 {
            if let Some(cb) = on_progress.as_deref_mut() {
                cb(&p);
            }
        }
    }

    if let Some(cb) = on_progress {
        cb(&p);
    }
    p
}

/// One-way mirror that only copies when the source is newer than the target
/// (with cache fast-path). Used game→client while/after the game runs.
pub fn mirror_folder_prefer_newest_one_way(
    source_dir: &Path,
    target_dir: &Path,
    filter_rel: Option<&dyn Fn(&str) -> bool>,
    max_files: Option<usize>,
    mut cache: Option<&mut HashMap<String, f64>>,
    mut on_progress: Option<&mut dyn FnMut(&MirrorProgress)>,
) -> MirrorProgress {
    ensure_dir_exists(source_dir);
    ensure_dir_exists(target_dir);

    let mut p = MirrorProgress::default();

    for (rel, from_time) in list_files_with_mtime(source_dir, filter_rel, max_files) {
        let from = source_dir.join(&rel);
        let to = target_dir.join(&rel);

        // One stat covers both the existence check and the target mtime.
        let to_meta = fs::metadata(&to).ok();

        if to_meta.is_none() {
            if copy_file_best_effort(&from, &to) {
                if let Some(c) = cache.as_deref_mut() {
                    c.insert(rel, from_time);
                }
            }
            p.copied += 1;
        } else {
            let cached = cache.as_ref().and_then(|c| c.get(&rel)).copied();
            if cached.is_some_and(|c| (c - from_time).abs() <= MTIME_SKEW_MS) {
                // Source unchanged since last mirror; assume target correct.
                p.skipped += 1;
            } else {
                let to_time = to_meta.map(|m| mtime_ms_from_meta(&m)).unwrap_or(0.0);
                if from_time > to_time + MTIME_SKEW_MS {
                    if copy_file_best_effort(&from, &to) {
                        if let Some(c) = cache.as_deref_mut() {
                            c.insert(rel.clone(), from_time);
                        }
                    }
                    p.copied += 1;
                } else {
                    // Target already newer/equal; cache so next run skips the stat.
                    if let Some(c) = cache.as_deref_mut() {
                        c.insert(rel, from_time);
                    }
                    p.skipped += 1;
                }
            }
        }

        p.processed += 1;
        if p.processed % 250 == 0 {
            if let Some(cb) = on_progress.as_deref_mut() {
                cb(&p);
            }
        }
    }

    if let Some(cb) = on_progress {
        cb(&p);
    }
    p
}

/// True if a file is safe to sync while FiveM/GTA is running.
/// Conservative on purpose: copying DLLs/binaries at runtime can crash the game.
pub fn is_safe_runtime_plugin_file(rel_path: &str) -> bool {
    let lower = rel_path.to_lowercase();
    lower.ends_with(".ini")
        || lower.ends_with(".log")
        || lower.ends_with(".cfg")
        || lower.ends_with(".txt")
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};

    fn set_mtime_secs_ago(path: &Path, secs_ago: i64) {
        let now = FileTime::now();
        set_file_mtime(
            path,
            FileTime::from_unix_time(now.unix_seconds() - secs_ago, 0),
        )
        .unwrap();
    }

    #[test]
    fn safe_runtime_filter_matches_v1() {
        assert!(is_safe_runtime_plugin_file("ReShade.ini"));
        assert!(is_safe_runtime_plugin_file("sub\\presets\\My Preset.INI"));
        assert!(is_safe_runtime_plugin_file("reshade.log"));
        assert!(is_safe_runtime_plugin_file("notes.TXT"));
        assert!(is_safe_runtime_plugin_file("config.cfg"));
        assert!(!is_safe_runtime_plugin_file("dinput8.dll"));
        assert!(!is_safe_runtime_plugin_file("shader.fx"));
        assert!(!is_safe_runtime_plugin_file("texture.png"));
    }

    #[test]
    fn source_wins_copies_and_caches() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("client");
        let dst = dir.path().join("game");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.dll"), b"plugin a").unwrap();
        fs::write(src.join("sub\\b.ini"), b"[b]").unwrap();

        let mut cache = HashMap::new();
        let p = mirror_folder_source_wins_one_way(&src, &dst, None, None, Some(&mut cache), None);

        assert_eq!(p.copied, 2);
        assert_eq!(fs::read(dst.join("a.dll")).unwrap(), b"plugin a");
        assert_eq!(fs::read(dst.join("sub\\b.ini")).unwrap(), b"[b]");
        assert_eq!(cache.len(), 2);
        assert!(cache.contains_key("a.dll"));
        assert!(cache.contains_key("sub\\b.ini"), "cache keys use backslash rel paths like v1");

        // Second run with warm cache: everything skipped.
        let p2 = mirror_folder_source_wins_one_way(&src, &dst, None, None, Some(&mut cache), None);
        assert_eq!(p2.copied, 0);
        assert_eq!(p2.skipped, 2);
    }

    #[test]
    fn source_wins_overwrites_newer_target() {
        // Source-authoritative: even a NEWER target gets overwritten when the
        // source changed vs cache (client folder is the source of truth).
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("client");
        let dst = dir.path().join("game");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("x.ini"), b"client").unwrap();
        fs::write(dst.join("x.ini"), b"game-newer").unwrap();
        set_mtime_secs_ago(&src.join("x.ini"), 60);

        let p = mirror_folder_source_wins_one_way(&src, &dst, None, None, None, None);
        assert_eq!(p.copied, 1);
        assert_eq!(fs::read(dst.join("x.ini")).unwrap(), b"client");
    }

    #[test]
    fn prefer_newest_respects_newer_target() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("game");
        let dst = dir.path().join("client");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("x.ini"), b"old game").unwrap();
        fs::write(dst.join("x.ini"), b"newer client").unwrap();
        set_mtime_secs_ago(&src.join("x.ini"), 120);

        let p = mirror_folder_prefer_newest_one_way(&src, &dst, None, None, None, None);
        assert_eq!(p.copied, 0);
        assert_eq!(p.skipped, 1);
        assert_eq!(fs::read(dst.join("x.ini")).unwrap(), b"newer client");
    }

    #[test]
    fn prefer_newest_copies_newer_source() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("game");
        let dst = dir.path().join("client");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("x.ini"), b"stale client").unwrap();
        fs::write(src.join("x.ini"), b"fresh game").unwrap();
        set_mtime_secs_ago(&dst.join("x.ini"), 120);

        let p = mirror_folder_prefer_newest_one_way(&src, &dst, None, None, None, None);
        assert_eq!(p.copied, 1);
        assert_eq!(fs::read(dst.join("x.ini")).unwrap(), b"fresh game");
    }

    #[test]
    fn prefer_newest_filter_and_max_files() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("game");
        let dst = dir.path().join("client");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("keep.ini"), b"x").unwrap();
        fs::write(src.join("skip.dll"), b"x").unwrap();

        let filter: &dyn Fn(&str) -> bool = &is_safe_runtime_plugin_file;
        let p =
            mirror_folder_prefer_newest_one_way(&src, &dst, Some(filter), Some(350), None, None);
        assert_eq!(p.processed, 1);
        assert!(dst.join("keep.ini").exists());
        assert!(!dst.join("skip.dll").exists());
    }

    #[test]
    fn two_way_prefer_newest_with_content_tiebreak() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.ini");
        let b = dir.path().join("b.ini");

        // Only A exists → seeded to B.
        fs::write(&a, b"from a").unwrap();
        sync_file_prefer_newest(&a, &b, TiePreference::B);
        assert_eq!(fs::read(&b).unwrap(), b"from a");

        // Same mtime (within skew), different content → tie preference wins.
        fs::write(&a, b"content A").unwrap();
        fs::write(&b, b"content B").unwrap();
        let now = FileTime::now();
        set_file_mtime(&a, now).unwrap();
        set_file_mtime(&b, now).unwrap();
        sync_file_prefer_newest(&a, &b, TiePreference::B);
        assert_eq!(fs::read(&a).unwrap(), b"content B");

        // A clearly newer → A wins regardless of preference.
        fs::write(&a, b"newest A").unwrap();
        set_mtime_secs_ago(&b, 60);
        sync_file_prefer_newest(&a, &b, TiePreference::B);
        assert_eq!(fs::read(&b).unwrap(), b"newest A");
    }

    #[test]
    fn does_not_traverse_junctions() {
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.ini"), b"outside").unwrap();

        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("client");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("real.ini"), b"real").unwrap();
        junction::create(outside.path(), src.join("linked")).unwrap();

        let rels = list_files_recursive(&src, None, None);
        assert_eq!(rels, vec!["real.ini".to_string()]);
    }
}

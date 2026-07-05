use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStats {
    pub file_count: u64,
    pub total_bytes: u64,
}

/// Recursive file count + total size, never following or descending into
/// symlinks/junctions (v1 skipped anything `lstat().isSymbolicLink()`).
pub fn folder_stats(folder: &Path) -> ClientStats {
    let mut stats = ClientStats::default();

    let walker = WalkDir::new(folder)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !e.path_is_symlink());

    for entry in walker.flatten() {
        if entry.file_type().is_file() {
            stats.file_count += 1;
            if let Ok(meta) = entry.metadata() {
                stats.total_bytes += meta.len();
            }
        }
    }

    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn counts_files_and_bytes_recursively() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), b"12345").unwrap();
        fs::create_dir_all(dir.path().join("sub/deeper")).unwrap();
        fs::write(dir.path().join("sub/b.bin"), b"1234567890").unwrap();
        fs::write(dir.path().join("sub/deeper/c.ini"), b"xy").unwrap();

        let stats = folder_stats(dir.path());
        assert_eq!(stats.file_count, 3);
        assert_eq!(stats.total_bytes, 17);
    }

    #[test]
    fn missing_folder_is_zero() {
        let stats = folder_stats(Path::new(r"C:\does\not\exist\anywhere"));
        assert_eq!(stats, ClientStats::default());
    }

    #[test]
    fn serializes_camel_case_like_v1() {
        let stats = ClientStats {
            file_count: 2,
            total_bytes: 99,
        };
        let json = serde_json::to_string(&stats).unwrap();
        assert_eq!(json, r#"{"fileCount":2,"totalBytes":99}"#);
    }

    #[cfg(windows)]
    #[test]
    fn does_not_descend_into_junctions() {
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("big.bin"), vec![0u8; 1000]).unwrap();

        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("real.txt"), b"abc").unwrap();

        // Create a junction inside `dir` pointing at `outside`.
        let junction_path = dir.path().join("linked");
        let status = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &junction_path.to_string_lossy(),
                &outside.path().to_string_lossy(),
            ])
            .output()
            .expect("mklink failed to run");
        assert!(status.status.success(), "mklink /J failed");

        let stats = folder_stats(dir.path());
        assert_eq!(stats.file_count, 1, "junction contents must not be counted");
        assert_eq!(stats.total_bytes, 3);
    }
}

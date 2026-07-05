use std::fs;
use std::io;
use std::path::Path;
use std::thread;
use std::time::Duration;

/// `fs::rename` with retry/backoff for transient Windows locking errors.
///
/// Port of v1 `renameWithRetrySync` (20 retries x 75ms). Retries on
/// ACCESS_DENIED (5), SHARING_VIOLATION (32) and LOCK_VIOLATION (33) —
/// the Windows codes behind Node's EPERM/EACCES/EBUSY.
pub fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    const RETRIES: u32 = 20;
    const DELAY: Duration = Duration::from_millis(75);

    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(err) => {
                let retryable = err.kind() == io::ErrorKind::PermissionDenied
                    || matches!(err.raw_os_error(), Some(5) | Some(32) | Some(33));
                if !retryable || attempt == RETRIES {
                    return Err(err);
                }
                attempt += 1;
                thread::sleep(DELAY);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_normally() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        fs::write(&from, b"x").unwrap();

        rename_with_retry(&from, &to).unwrap();
        assert!(!from.exists());
        assert!(to.exists());
    }

    #[test]
    fn non_retryable_error_fails_fast() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.txt");
        let to = dir.path().join("b.txt");

        let started = std::time::Instant::now();
        let err = rename_with_retry(&missing, &to).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        // NotFound must not burn the full 1.5s retry budget.
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}

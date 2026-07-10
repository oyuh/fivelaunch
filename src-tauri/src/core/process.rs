use std::io;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

const GAME_PROCESS_NAMES: &[&str] = &["FiveM.exe", "GTA5.exe"];

/// Several watcher loops (tray restore, restore-on-close, file sync) poll the
/// game state concurrently at ~1s. They share one `System` (sysinfo reuses
/// its buffers across refreshes) and one result inside this TTL, so a burst
/// of callers costs a single process-table scan. The TTL is well under every
/// caller's poll interval, so observable behavior is unchanged.
const GAME_CHECK_TTL: Duration = Duration::from_millis(250);

struct GameCheck {
    sys: System,
    last: Option<(Instant, bool)>,
}

fn game_check() -> &'static Mutex<GameCheck> {
    static CELL: OnceLock<Mutex<GameCheck>> = OnceLock::new();
    CELL.get_or_init(|| {
        Mutex::new(GameCheck {
            sys: System::new(),
            last: None,
        })
    })
}

fn scan_for_names(sys: &mut System, names: &[&str]) -> bool {
    // Names only — skip the per-process CPU/memory/disk stats the default
    // refresh collects; this runs in a poll loop while the game is up.
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().any(|p| {
        let name = p.name();
        names.iter().any(|n| name.eq_ignore_ascii_case(n.trim()))
    })
}

/// True if any process with one of the given image names is running.
///
/// Replaces v1's `tasklist.exe` subprocess polling (spawned every ~1s while
/// the game ran) with native process enumeration — this is one of the
/// headline perf wins of the rewrite.
pub fn any_process_running(names: &[&str]) -> bool {
    if names.is_empty() {
        return false;
    }
    let mut sys = System::new();
    scan_for_names(&mut sys, names)
}

pub fn is_game_running() -> bool {
    let mut guard = game_check().lock().unwrap_or_else(|p| p.into_inner());
    if let Some((at, result)) = guard.last {
        if at.elapsed() < GAME_CHECK_TTL {
            return result;
        }
    }
    let sys = &mut guard.sys;
    let running = scan_for_names(sys, GAME_PROCESS_NAMES);
    guard.last = Some((Instant::now(), running));
    running
}

/// Launch an executable fully detached from the launcher (no retained
/// handle, no console). Port of v1 `spawnDetachedProcess`, extended to pass
/// command-line args (e.g. FiveM's `-pure_1` pure-mode flag).
pub fn spawn_detached(exe: &Path, args: &[String]) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

        std::process::Command::new(exe)
            .args(args)
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        std::process::Command::new(exe).args(args).spawn()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_current_process() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().to_string();
        assert!(any_process_running(&[&name]), "should find our own process ({name})");
    }

    #[test]
    fn does_not_find_nonexistent_process() {
        assert!(!any_process_running(&["definitely_not_a_real_process_xyz123.exe"]));
    }

    #[test]
    fn empty_list_is_false() {
        assert!(!any_process_running(&[]));
    }
}

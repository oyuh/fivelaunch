use std::io;
use std::path::Path;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// True if any process with one of the given image names is running.
///
/// Replaces v1's `tasklist.exe` subprocess polling (spawned every ~1s while
/// the game ran) with native process enumeration — this is one of the
/// headline perf wins of the rewrite.
pub fn any_process_running(names: &[&str]) -> bool {
    let lowered: Vec<String> = names.iter().map(|n| n.trim().to_lowercase()).collect();
    if lowered.is_empty() {
        return false;
    }

    // Names only — skip the per-process CPU/memory/disk stats the default
    // refresh collects; this runs in a poll loop while the game is up.
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());

    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        lowered.contains(&name)
    })
}

pub fn is_game_running() -> bool {
    any_process_running(&["FiveM.exe", "GTA5.exe"])
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

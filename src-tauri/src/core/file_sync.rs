//! Runtime file syncing for a launched client — port of v1 `runtimeSync.ts`.
//!
//! v2 divergence (documented in PERF.md): v1 paired FS watchers (350ms
//! debounce) with a 5s prefer-newest interval loop. v2 uses the interval loop
//! only — same convergence guarantees (including the final pass after the
//! game exits), reaction latency bounded by the tick instead of the watcher.
//! These are small config files written at discrete moments, and the loop is
//! a handful of stat calls per tick.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::mirror::{copy_file_best_effort, ensure_file_exists, sync_file_prefer_newest, TiePreference};

/// Handle for a generic background task (enforcement, file-sync loops).
pub struct BackgroundTask {
    pub stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl BackgroundTask {
    pub fn spawn(f: impl FnOnce(Arc<AtomicBool>) + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = stop.clone();
            std::thread::spawn(move || f(stop))
        };
        Self {
            stop,
            thread: Some(thread),
        }
    }

    pub fn stop_and_join(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for BackgroundTask {
    fn drop(&mut self) {
        // Signal but don't join in drop — joining can block the caller;
        // explicit stop_and_join() is the orderly path.
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// A pair of files to keep in sync (a = client-owned, b = real/game file).
#[derive(Debug, Clone)]
pub struct SyncPair {
    pub a: PathBuf,
    pub b: PathBuf,
}

/// v1 `seedAndStartTwoWaySync` seeding step: client wins when it exists,
/// otherwise adopt the game file. Both files are created empty if missing.
pub fn seed_pair(client_file: &Path, game_file: &Path) {
    let client_exists = client_file.exists();
    let game_exists = game_file.exists();

    ensure_file_exists(client_file, "");
    ensure_file_exists(game_file, "");

    if client_exists {
        copy_file_best_effort(client_file, game_file);
    } else if game_exists {
        copy_file_best_effort(game_file, client_file);
    }
}

pub struct FileSyncConfig {
    pub tick: Duration,
    pub max_duration: Duration,
}

impl Default for FileSyncConfig {
    fn default() -> Self {
        Self {
            tick: Duration::from_secs(5),          // v1: 5_000ms
            max_duration: Duration::from_secs(21_600), // v1: 6h
        }
    }
}

/// Blocking prefer-newest sync loop over file pairs (run on a background
/// thread). v1 semantics per pair: newest side wins, tie -> game file wins
/// (`tiePreference: 'b'`). Once the game has been seen running and exits,
/// one final sync pass runs and the loop ends.
pub fn run_prefer_newest_sync_loop(
    pairs: &[SyncPair],
    config: &FileSyncConfig,
    is_game_running: &(dyn Fn() -> bool + Sync),
    stop: &AtomicBool,
) {
    if pairs.is_empty() {
        return;
    }

    let started = Instant::now();
    let mut ever_running = false;

    loop {
        if stop.load(Ordering::SeqCst) || started.elapsed() > config.max_duration {
            return;
        }

        let running = is_game_running();
        if running {
            ever_running = true;
        } else if ever_running {
            // Final pass after game exit (atomic-save-on-exit patterns).
            for pair in pairs {
                sync_file_prefer_newest(&pair.a, &pair.b, TiePreference::B);
            }
            return;
        }

        for pair in pairs {
            sync_file_prefer_newest(&pair.a, &pair.b, TiePreference::B);
        }

        // Sleep one tick, responsive to stop.
        let tick_started = Instant::now();
        while tick_started.elapsed() < config.tick {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50).min(config.tick));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn seed_prefers_existing_client_file() {
        let dir = tempfile::tempdir().unwrap();
        let client = dir.path().join("client").join("CitizenFX.ini");
        let game = dir.path().join("game").join("CitizenFX.ini");
        fs::create_dir_all(client.parent().unwrap()).unwrap();
        fs::write(&client, "client config").unwrap();

        seed_pair(&client, &game);
        assert_eq!(fs::read_to_string(&game).unwrap(), "client config");
    }

    #[test]
    fn seed_adopts_game_file_when_client_missing() {
        let dir = tempfile::tempdir().unwrap();
        let client = dir.path().join("client").join("ReShade.ini");
        let game = dir.path().join("game").join("ReShade.ini");
        fs::create_dir_all(game.parent().unwrap()).unwrap();
        fs::write(&game, "game config").unwrap();

        seed_pair(&client, &game);
        assert_eq!(fs::read_to_string(&client).unwrap(), "game config");
    }

    #[test]
    fn loop_syncs_while_game_runs_and_does_final_pass() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.ini");
        let b = dir.path().join("b.ini");
        fs::write(&a, "same").unwrap();
        fs::write(&b, "same").unwrap();

        let game_running = Arc::new(AtomicBool::new(true));
        let pairs = vec![SyncPair { a: a.clone(), b: b.clone() }];
        let config = FileSyncConfig {
            tick: Duration::from_millis(30),
            max_duration: Duration::from_secs(10),
        };

        let task = {
            let flag = game_running.clone();
            BackgroundTask::spawn(move |stop| {
                run_prefer_newest_sync_loop(
                    &pairs,
                    &config,
                    &move || flag.load(Ordering::SeqCst),
                    &stop,
                )
            })
        };

        // "Game" writes to b (clearly newer): must propagate to a.
        std::thread::sleep(Duration::from_millis(60));
        fs::write(&b, "written by game").unwrap();
        filetime::set_file_mtime(
            &a,
            filetime::FileTime::from_unix_time(filetime::FileTime::now().unix_seconds() - 60, 0),
        )
        .unwrap();

        let deadline = Instant::now() + Duration::from_secs(3);
        while fs::read_to_string(&a).unwrap() != "written by game" {
            assert!(Instant::now() < deadline, "sync loop did not propagate");
            std::thread::sleep(Duration::from_millis(20));
        }

        // Game exits -> loop makes a final pass and terminates on its own.
        game_running.store(false, Ordering::SeqCst);
        let mut task = task;
        let join_deadline = Instant::now() + Duration::from_secs(3);
        while !task.thread.as_ref().unwrap().is_finished() {
            assert!(Instant::now() < join_deadline, "loop did not exit after game closed");
            std::thread::sleep(Duration::from_millis(20));
        }
        task.stop_and_join();
    }

    #[test]
    fn stop_terminates_promptly() {
        let dir = tempfile::tempdir().unwrap();
        let pairs = vec![SyncPair {
            a: dir.path().join("a.ini"),
            b: dir.path().join("b.ini"),
        }];
        let config = FileSyncConfig {
            tick: Duration::from_secs(5),
            ..Default::default()
        };

        let mut task = BackgroundTask::spawn(move |stop| {
            run_prefer_newest_sync_loop(&pairs, &config, &|| true, &stop)
        });

        std::thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        task.stop_and_join();
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "stop must interrupt mid-tick"
        );
    }
}

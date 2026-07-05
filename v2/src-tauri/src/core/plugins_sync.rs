//! Plugins sync (copy) mode — port of v1 `pluginsLaunch.ts`.
//!
//! Sync mode keeps `FiveM.app/plugins` a *real* folder owned by exactly one
//! client (marker files), mirrors client→game at launch (source wins, with a
//! persisted mtime cache), then runs a conservative game→client sync of safe
//! file types while the game runs, plus one finalizing pass after exit.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::fs_retry::rename_with_retry;
use super::hash::fnv1a32_hex;
use super::mirror::{
    is_safe_runtime_plugin_file, mirror_folder_prefer_newest_one_way,
    mirror_folder_source_wins_one_way, MirrorProgress,
};

// ---------------------------------------------------------------------------
// Markers (file names + JSON shape must match v1)
// ---------------------------------------------------------------------------

/// `.fivelaunch-plugins-owner.json` payload — same shape as v1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginsOwnerMarker {
    #[serde(rename = "clientId")]
    pub client_id: String,
    pub mode: String,
    pub at: String,
}

pub fn plugins_owner_marker_path(dir: &Path) -> PathBuf {
    dir.join(".fivelaunch-plugins-owner.json")
}

pub fn managed_marker_path(dir: &Path) -> PathBuf {
    dir.join(".managed-by-fivem-clients")
}

pub fn write_plugins_owner_marker(dir: &Path, client_id: &str, mode: &str) {
    let _ = fs::create_dir_all(dir);
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let marker = PluginsOwnerMarker {
        client_id: client_id.to_string(),
        mode: mode.to_string(),
        at,
    };
    if let Ok(json) = serde_json::to_string_pretty(&marker) {
        let _ = fs::write(plugins_owner_marker_path(dir), json);
    }
}

pub fn read_plugins_owner_marker(dir: &Path) -> Option<PluginsOwnerMarker> {
    let raw = fs::read_to_string(plugins_owner_marker_path(dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

// ---------------------------------------------------------------------------
// Persisted mtime caches (JSON object of rel-path -> mtimeMs float, like v1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MirrorDirection {
    ClientToGame,
    GameToClient,
}

pub fn mirror_cache_file(client_path: &Path, direction: MirrorDirection) -> PathBuf {
    let name = match direction {
        MirrorDirection::ClientToGame => "plugins-cache-client-to-game.json",
        MirrorDirection::GameToClient => "plugins-cache-game-to-client.json",
    };
    client_path.join("settings").join(name)
}

pub fn load_mirror_cache(path: &Path) -> HashMap<String, f64> {
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save_mirror_cache(path: &Path, cache: &HashMap<String, f64>) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // v1 wrote compact JSON (no indent) for these caches.
    if let Ok(json) = serde_json::to_string(cache) {
        let _ = fs::write(path, json);
    }
}

// ---------------------------------------------------------------------------
// Game plugins dir isolation
// ---------------------------------------------------------------------------

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

/// Make `FiveM.app/plugins` a real directory owned by `client_id`.
///
/// Port of v1 `prepareGamePluginsDirForSyncMode`:
/// - a leftover junction is removed
/// - a directory that isn't ours, or is owned by another client, is rotated
///   away to `plugins_managed_<fnv>_backup_<ts>` / `plugins_unmanaged_backup_<ts>`
///   (prevents cross-client plugin leakage)
/// - ownership markers are always (re)stamped
pub fn prepare_game_plugins_dir_for_sync_mode(
    game_plugins_dir: &Path,
    client_id: &str,
    status: &mut dyn FnMut(&str),
) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(game_plugins_dir) {
        if meta.file_type().is_symlink() {
            let _ = fs::remove_dir(game_plugins_dir).or_else(|_| fs::remove_file(game_plugins_dir));
        } else if meta.is_dir() {
            let managed = managed_marker_path(game_plugins_dir).exists();
            let owner_id = read_plugins_owner_marker(game_plugins_dir).map(|m| m.client_id);

            let ours = managed && owner_id.as_deref() == Some(client_id);
            if !ours {
                let kind = if managed {
                    let tag = owner_id
                        .as_deref()
                        .map_or_else(|| "unknown".to_string(), fnv1a32_hex);
                    format!("managed_{tag}")
                } else {
                    "unmanaged".to_string()
                };
                let backup = with_suffix(game_plugins_dir, &format!("_{kind}_backup_{}", now_ms()));

                status("Isolating FiveM plugins folder for this client...");
                rename_with_retry(game_plugins_dir, &backup).map_err(|err| {
                    format!(
                        "Failed to isolate plugins folder (code={}): {}. Close FiveM/overlays and try again.",
                        err.raw_os_error().map_or_else(|| "unknown".into(), |c| c.to_string()),
                        game_plugins_dir.display()
                    )
                })?;
            }
        } else {
            // Unexpected file at the plugins path; move it aside (best effort).
            let _ = fs::rename(
                game_plugins_dir,
                with_suffix(game_plugins_dir, &format!("_backup_{}", now_ms())),
            );
        }
    }

    let _ = fs::create_dir_all(game_plugins_dir);
    let _ = fs::write(managed_marker_path(game_plugins_dir), "managed\n");
    write_plugins_owner_marker(game_plugins_dir, client_id, "sync");
    Ok(())
}

/// Launch-time client→game mirror with the persisted mtime cache.
/// `caches` is the in-memory per-client cache map that survives across
/// launches within one app session (v1 `pluginsMirrorCache`).
pub fn initial_sync_client_to_game(
    client_id: &str,
    client_path: &Path,
    client_plugins_dir: &Path,
    game_plugins_dir: &Path,
    caches: &mut HashMap<String, HashMap<String, f64>>,
    status: &mut dyn FnMut(&str),
) {
    status("Syncing plugins (copy mode)...");

    let cache_key = format!("{client_id}:client->game");
    let cache_path = mirror_cache_file(client_path, MirrorDirection::ClientToGame);
    let cache = caches
        .entry(cache_key)
        .or_insert_with(|| load_mirror_cache(&cache_path));

    let mut last_progress = Instant::now() - Duration::from_secs(10);
    let mut on_progress = |p: &MirrorProgress| {
        if last_progress.elapsed() >= Duration::from_millis(750) {
            last_progress = Instant::now();
            // Streamed to the UI via the injected status callback.
        }
        let _ = p;
    };

    let progress = mirror_folder_source_wins_one_way(
        client_plugins_dir,
        game_plugins_dir,
        None,
        None,
        Some(cache),
        Some(&mut on_progress),
    );
    status(&format!(
        "Syncing plugins (copy mode)... {} scanned, {} updated",
        progress.processed, progress.copied
    ));

    save_mirror_cache(&cache_path, cache);
}

// ---------------------------------------------------------------------------
// Runtime loop (background thread) + finalization
// ---------------------------------------------------------------------------

pub struct RuntimeSyncConfig {
    pub tick: Duration,
    pub max_duration: Duration,
    pub running_max_files: usize,
    pub finalize_max_files: usize,
}

impl Default for RuntimeSyncConfig {
    fn default() -> Self {
        Self {
            tick: Duration::from_secs(10),        // v1: 10_000ms
            max_duration: Duration::from_secs(21_600), // v1: 6h
            running_max_files: 350,
            finalize_max_files: 5000,
        }
    }
}

/// Blocking runtime-sync loop; run it on a dedicated thread.
///
/// While the game runs: conservative game→client mirror of safe file types.
/// After the game exits: one finalizing pass (larger cap), `finalizing` held
/// true for the duration so launches can gate on it. If the game never ran,
/// stops quietly (v1 behavior).
pub fn run_plugins_runtime_sync(
    game_plugins_dir: &Path,
    client_plugins_dir: &Path,
    config: &RuntimeSyncConfig,
    is_game_running: &(dyn Fn() -> bool + Sync),
    stop: &AtomicBool,
    finalizing: &AtomicBool,
    status: &(dyn Fn(&str) + Sync),
) {
    let started = Instant::now();
    let mut was_running = false;
    let filter: &dyn Fn(&str) -> bool = &is_safe_runtime_plugin_file;

    loop {
        if stop.load(Ordering::SeqCst) || started.elapsed() > config.max_duration {
            return;
        }

        let running = is_game_running();
        if running {
            was_running = true;
            let _ = mirror_folder_prefer_newest_one_way(
                game_plugins_dir,
                client_plugins_dir,
                Some(filter),
                Some(config.running_max_files),
                None,
                None,
            );
        } else {
            if was_running {
                finalizing.store(true, Ordering::SeqCst);
                status("Finalizing plugins sync...");
                let progress = mirror_folder_prefer_newest_one_way(
                    game_plugins_dir,
                    client_plugins_dir,
                    Some(filter),
                    Some(config.finalize_max_files),
                    None,
                    None,
                );
                status(&format!(
                    "Plugins sync complete. ({} scanned, {} updated)",
                    progress.processed, progress.copied
                ));
                finalizing.store(false, Ordering::SeqCst);
            }
            return;
        }

        // Sleep one tick, but stay responsive to the stop flag.
        let tick_started = Instant::now();
        while tick_started.elapsed() < config.tick {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50).min(config.tick));
        }
    }
}

/// Handle for a spawned runtime-sync thread.
pub struct RuntimeSyncHandle {
    pub stop: Arc<AtomicBool>,
    pub finalizing: Arc<AtomicBool>,
    pub thread: Option<std::thread::JoinHandle<()>>,
}

impl RuntimeSyncHandle {
    pub fn is_finalizing(&self) -> bool {
        self.finalizing.load(Ordering::SeqCst)
    }

    /// Signal stop and wait for the thread to end (finalization, if running,
    /// completes first — the loop only checks `stop` between operations).
    pub fn stop_and_join(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

pub fn spawn_runtime_sync(
    game_plugins_dir: PathBuf,
    client_plugins_dir: PathBuf,
    config: RuntimeSyncConfig,
    is_game_running: Arc<dyn Fn() -> bool + Send + Sync>,
    status: Arc<dyn Fn(&str) + Send + Sync>,
) -> RuntimeSyncHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let finalizing = Arc::new(AtomicBool::new(false));

    let thread = {
        let stop = stop.clone();
        let finalizing = finalizing.clone();
        std::thread::spawn(move || {
            run_plugins_runtime_sync(
                &game_plugins_dir,
                &client_plugins_dir,
                &config,
                is_game_running.as_ref(),
                &stop,
                &finalizing,
                status.as_ref(),
            );
        })
    };

    RuntimeSyncHandle {
        stop,
        finalizing,
        thread: Some(thread),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trip_matches_v1_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings").join("plugins-cache-client-to-game.json");

        // v1-written cache: object of backslash rel paths -> float mtimes.
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"ReShade.ini":1719849600000.123,"sub\\a.dll":1719849601111.5}"#)
            .unwrap();

        let cache = load_mirror_cache(&path);
        assert_eq!(cache.len(), 2);
        assert_eq!(cache["ReShade.ini"], 1719849600000.123);
        assert_eq!(cache["sub\\a.dll"], 1719849601111.5);

        save_mirror_cache(&path, &cache);
        let reloaded = load_mirror_cache(&path);
        assert_eq!(reloaded, cache);
    }

    #[test]
    fn prepare_rotates_unmanaged_dir() {
        let dir = tempfile::tempdir().unwrap();
        let plugins = dir.path().join("plugins");
        fs::create_dir_all(&plugins).unwrap();
        fs::write(plugins.join("user.dll"), b"precious user plugin").unwrap();

        prepare_game_plugins_dir_for_sync_mode(&plugins, "client-a", &mut |_| {}).unwrap();

        // Original content rotated away, not deleted.
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("plugins_unmanaged_backup_"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(dir
            .path()
            .join(&backups[0])
            .join("user.dll")
            .exists());

        // Fresh managed dir with both markers.
        assert!(managed_marker_path(&plugins).exists());
        let owner = read_plugins_owner_marker(&plugins).unwrap();
        assert_eq!(owner.client_id, "client-a");
        assert_eq!(owner.mode, "sync");
    }

    #[test]
    fn prepare_rotates_other_clients_dir_with_hash_tag() {
        let dir = tempfile::tempdir().unwrap();
        let plugins = dir.path().join("plugins");
        fs::create_dir_all(&plugins).unwrap();
        fs::write(managed_marker_path(&plugins), "managed\n").unwrap();
        write_plugins_owner_marker(&plugins, "client-b", "sync");

        prepare_game_plugins_dir_for_sync_mode(&plugins, "client-a", &mut |_| {}).unwrap();

        let expected_tag = fnv1a32_hex("client-b");
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(&format!("plugins_managed_{expected_tag}_backup_")))
            .collect();
        assert_eq!(backups.len(), 1, "other client's dir must rotate with its hash tag");
        assert_eq!(read_plugins_owner_marker(&plugins).unwrap().client_id, "client-a");
    }

    #[test]
    fn prepare_keeps_own_dir() {
        let dir = tempfile::tempdir().unwrap();
        let plugins = dir.path().join("plugins");
        fs::create_dir_all(&plugins).unwrap();
        fs::write(plugins.join("mine.dll"), b"keep me").unwrap();
        fs::write(managed_marker_path(&plugins), "managed\n").unwrap();
        write_plugins_owner_marker(&plugins, "client-a", "sync");

        prepare_game_plugins_dir_for_sync_mode(&plugins, "client-a", &mut |_| {}).unwrap();

        assert!(plugins.join("mine.dll").exists(), "own dir must be kept in place");
        let rotated = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(rotated, 1, "no backup rotation for our own dir");
    }

    #[test]
    fn prepare_removes_stale_junction() {
        let dir = tempfile::tempdir().unwrap();
        let somewhere = dir.path().join("somewhere");
        fs::create_dir_all(&somewhere).unwrap();
        let plugins = dir.path().join("plugins");
        junction::create(&somewhere, &plugins).unwrap();

        prepare_game_plugins_dir_for_sync_mode(&plugins, "client-a", &mut |_| {}).unwrap();

        let meta = fs::symlink_metadata(&plugins).unwrap();
        assert!(!meta.file_type().is_symlink(), "junction must be replaced by a real dir");
        assert!(managed_marker_path(&plugins).exists());
    }

    #[test]
    fn initial_sync_populates_game_dir_and_persists_cache() {
        let dir = tempfile::tempdir().unwrap();
        let client_path = dir.path().join("client");
        let client_plugins = client_path.join("plugins");
        let game_plugins = dir.path().join("game_plugins");
        fs::create_dir_all(&client_plugins).unwrap();
        fs::write(client_plugins.join("mod.dll"), b"binary").unwrap();
        fs::write(client_plugins.join("ReShade.ini"), b"[general]").unwrap();

        let mut caches = HashMap::new();
        initial_sync_client_to_game(
            "client-a",
            &client_path,
            &client_plugins,
            &game_plugins,
            &mut caches,
            &mut |_| {},
        );

        assert!(game_plugins.join("mod.dll").exists());
        assert!(game_plugins.join("ReShade.ini").exists());
        // Persisted cache exists in the v1 location with entries.
        let cache_path = mirror_cache_file(&client_path, MirrorDirection::ClientToGame);
        let persisted = load_mirror_cache(&cache_path);
        assert_eq!(persisted.len(), 2);
        // In-memory cache retained for the next launch this session.
        assert_eq!(caches["client-a:client->game"].len(), 2);
    }

    #[test]
    fn runtime_loop_syncs_safe_files_then_finalizes() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("game_plugins");
        let client = dir.path().join("client_plugins");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&client).unwrap();
        // Game writes a preset (.ini, safe) and a dll (unsafe) while running.
        fs::write(game.join("ReShadePreset.ini"), b"Techniques=Clarity").unwrap();
        fs::write(game.join("injected.dll"), b"nope").unwrap();

        let game_running = Arc::new(AtomicBool::new(true));
        let stop = AtomicBool::new(false);
        let finalizing = AtomicBool::new(false);
        let statuses = std::sync::Mutex::new(Vec::<String>::new());

        let config = RuntimeSyncConfig {
            tick: Duration::from_millis(30),
            max_duration: Duration::from_secs(10),
            ..Default::default()
        };

        let flag = game_running.clone();
        std::thread::scope(|s| {
            let game_ref = &game;
            let client_ref = &client;
            let stop_ref = &stop;
            let finalizing_ref = &finalizing;
            let statuses_ref = &statuses;
            let config_ref = &config;
            s.spawn(move || {
                run_plugins_runtime_sync(
                    game_ref,
                    client_ref,
                    config_ref,
                    &move || flag.load(Ordering::SeqCst),
                    stop_ref,
                    finalizing_ref,
                    &move |msg: &str| statuses_ref.lock().unwrap().push(msg.to_string()),
                );
            });

            // Let it run a few ticks "while the game is running", then stop the game.
            std::thread::sleep(Duration::from_millis(150));
            game_running.store(false, Ordering::SeqCst);
        });

        // Safe file synced back to client; dll untouched.
        assert_eq!(
            fs::read(client.join("ReShadePreset.ini")).unwrap(),
            b"Techniques=Clarity"
        );
        assert!(!client.join("injected.dll").exists());
        assert!(!finalizing.load(Ordering::SeqCst), "finalizing must be cleared");
        let statuses = statuses.lock().unwrap();
        assert!(statuses.iter().any(|s| s.contains("Finalizing")));
        assert!(statuses.iter().any(|s| s.contains("complete")));
    }

    #[test]
    fn runtime_loop_exits_quietly_if_game_never_ran() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("game");
        let client = dir.path().join("client");

        let stop = AtomicBool::new(false);
        let finalizing = AtomicBool::new(false);
        let config = RuntimeSyncConfig {
            tick: Duration::from_millis(10),
            ..Default::default()
        };

        let started = Instant::now();
        run_plugins_runtime_sync(
            &game,
            &client,
            &config,
            &|| false,
            &stop,
            &finalizing,
            &|_msg: &str| panic!("no status expected when game never ran"),
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn handle_stop_and_join_terminates_thread() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("game");
        let client = dir.path().join("client");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&client).unwrap();

        let mut handle = spawn_runtime_sync(
            game,
            client,
            RuntimeSyncConfig {
                tick: Duration::from_millis(20),
                ..Default::default()
            },
            Arc::new(|| true), // "game running" forever
            Arc::new(|_msg: &str| {}),
        );

        assert!(!handle.is_finalizing());
        handle.stop_and_join(); // must not hang
    }
}

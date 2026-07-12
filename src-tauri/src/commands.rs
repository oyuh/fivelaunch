use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

use crate::core::clients::{ClientProfile, ClientStore, DuplicateOptions, LinkOptions, PluginsMode};
use crate::core::file_sync::BackgroundTask;
use crate::core::gta_settings::{GtaSettingsDocument, GtaSettingsSaveResult};
use crate::core::log_store::{AppLogEntry, LogStore};
use crate::core::paths::{self, AppPaths};
use crate::core::plugins_sync::RuntimeSyncHandle;
use crate::core::settings::{self, AppSettings};
use crate::core::stats::ClientStats;
use crate::core::update_checker::UpdateStatus;

/// Per-client in-memory mirror caches (v1 `pluginsMirrorCache`) — reduce IO
/// on repeat launches within one app session.
pub type MirrorCaches = HashMap<String, HashMap<String, f64>>;

/// All background work owned by the current launch (v1 `RuntimeSync` +
/// plugins bookkeeping). `stop_all` runs between launches.
#[derive(Default)]
pub struct LaunchRuntime {
    pub plugins: Option<RuntimeSyncHandle>,
    pub tasks: Vec<BackgroundTask>,
    /// Restore-on-close watcher. Kept out of `tasks` because it observes the
    /// other tasks' finished-flags — it must be stoppable first so it can't
    /// fire a restore in the middle of a teardown.
    pub restore: Option<BackgroundTask>,
}

impl LaunchRuntime {
    pub fn plugins_finalizing(&self) -> bool {
        self.plugins
            .as_ref()
            .is_some_and(RuntimeSyncHandle::is_finalizing)
    }

    /// True while ANY session work is still in flight — plugins sync/finalize,
    /// GTA settings enforcement, file-sync loops, or the restore-on-close
    /// watcher. The launch button stays disabled until this clears so a new
    /// launch can't interrupt a restore mid-copy.
    pub fn is_busy(&self) -> bool {
        use std::sync::atomic::Ordering;
        let plugins_running = self
            .plugins
            .as_ref()
            .is_some_and(|p| !p.finished_flag().load(Ordering::SeqCst));
        let restore_running = self
            .restore
            .as_ref()
            .is_some_and(|t| !t.finished_flag().load(Ordering::SeqCst));
        let tasks_running = self
            .tasks
            .iter()
            .any(|t| !t.finished_flag().load(Ordering::SeqCst));
        plugins_running || restore_running || tasks_running
    }

    pub fn stop_all(&mut self) {
        if let Some(mut restore) = self.restore.take() {
            restore.stop_and_join();
        }
        if let Some(mut plugins) = self.plugins.take() {
            plugins.stop_and_join();
        }
        for mut task in self.tasks.drain(..) {
            task.stop_and_join();
        }
    }
}

pub struct AppState {
    pub paths: AppPaths,
    pub mirror_caches: Arc<Mutex<MirrorCaches>>,
    pub runtime: Arc<Mutex<LaunchRuntime>>,
    pub log_store: Arc<LogStore>,
    pub update_cache: Arc<Mutex<Option<UpdateStatus>>>,
}

impl AppState {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            mirror_caches: Arc::new(Mutex::new(HashMap::new())),
            runtime: Arc::new(Mutex::new(LaunchRuntime::default())),
            log_store: Arc::new(LogStore::default()),
            update_cache: Arc::new(Mutex::new(None)),
        }
    }
}

impl AppState {
    fn store(&self) -> Result<ClientStore, String> {
        ClientStore::new(&self.paths)
    }

    fn game_path_override(&self) -> Option<String> {
        settings::load(&self.paths.settings_file()).game_path
    }
}

/// Run blocking filesystem work off the main thread. Non-async commands
/// execute on the main thread in Tauri, so anything that walks, copies, or
/// deletes folders must go through here or the whole UI freezes with it.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn open_in_explorer(path: std::path::PathBuf) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_clients(state: State<'_, AppState>) -> Result<Vec<ClientProfile>, String> {
    Ok(state.store()?.get_clients())
}

/// The client most recently launched — used to reselect it on app start.
#[tauri::command]
pub fn get_selected_client_id(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.store()?.get_selected_client_id())
}

#[tauri::command]
pub async fn create_client(
    state: State<'_, AppState>,
    name: String,
    icon: Option<String>,
) -> Result<ClientProfile, String> {
    let paths = state.paths.clone();
    blocking(move || ClientStore::new(&paths)?.create_client(name, icon)).await
}

/// Can copy multi-GB mod folders — must stay off the main thread.
#[tauri::command]
pub async fn duplicate_client(
    state: State<'_, AppState>,
    id: String,
    name: String,
    options: DuplicateOptions,
) -> Result<ClientProfile, String> {
    let paths = state.paths.clone();
    blocking(move || ClientStore::new(&paths)?.duplicate_client(&id, name, options)).await
}

#[tauri::command]
pub fn set_client_icon(
    state: State<'_, AppState>,
    id: String,
    icon: Option<String>,
) -> Result<(), String> {
    state.store()?.set_icon(&id, icon)
}

#[tauri::command]
pub fn set_client_pure_mode(
    state: State<'_, AppState>,
    id: String,
    pure_mode: Option<u8>,
) -> Result<(), String> {
    state.store()?.set_pure_mode(&id, pure_mode)
}

/// Recursively deletes the client's folder — must stay off the main thread.
#[tauri::command]
pub async fn delete_client(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let paths = state.paths.clone();
    blocking(move || {
        ClientStore::new(&paths)?.delete_client(&id)?;
        // Deleting the snapshot client turns restore-on-close off app-wide;
        // drop the dangling reference so the UI offers to create a new one.
        let settings_file = paths.settings_file();
        if settings::load(&settings_file).snapshot_client_id.as_deref() == Some(id.as_str()) {
            settings::set_snapshot_client_id(&settings_file, None)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn set_client_restore_on_close(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    state.store()?.set_restore_on_close(&id, enabled)
}

/// Create the snapshot ("My Setup") client from the current live FiveM state.
#[tauri::command]
pub async fn create_snapshot_client(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<ClientProfile, String> {
    let paths = state.paths.clone();
    // Capture can move/copy multi-GB folders — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        if crate::core::process::is_game_running() {
            return Err("Please close GTA V and FiveM before creating a snapshot.".into());
        }
        let app_settings = settings::load(&paths.settings_file());
        if let Some(existing) = &app_settings.snapshot_client_id {
            if paths.clients_data().join(existing).exists() {
                return Err("A snapshot client already exists.".into());
            }
        }
        let game_path_override = app_settings.game_path;
        let name = name.unwrap_or_else(|| crate::core::snapshot::DEFAULT_SNAPSHOT_NAME.into());
        let targets = crate::core::gta_settings::gta_settings_targets(game_path_override.as_deref());
        let ini = crate::core::paths::citizen_fx_ini_path();
        crate::core::snapshot::capture_snapshot_client(
            &paths,
            game_path_override.as_deref(),
            &name,
            &targets,
            ini.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Manually restore the snapshot baseline (the same thing restore-on-close
/// does after a session). Handy while testing setups.
#[tauri::command]
pub async fn restore_snapshot_now(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Emitter;

        if crate::core::process::is_game_running() {
            return Err("Please close GTA V and FiveM before restoring.".into());
        }

        let state = app.state::<AppState>();
        // Wind down any leftover session work before touching live folders.
        if let Ok(mut guard) = state.runtime.lock() {
            guard.stop_all();
        }

        let app_settings = settings::load(&state.paths.settings_file());
        let snapshot_id = app_settings
            .snapshot_client_id
            .clone()
            .ok_or("No snapshot has been created yet.")?;
        let game_path_override = app_settings.game_path;
        let targets = crate::core::gta_settings::gta_settings_targets(game_path_override.as_deref());
        let ini = crate::core::paths::citizen_fx_ini_path();

        let mut status = |message: &str| {
            let _ = app.emit("launch-status", message);
        };
        crate::core::snapshot::restore_baseline(
            &state.paths,
            &snapshot_id,
            game_path_override.as_deref(),
            &targets,
            ini.as_deref(),
            &mut status,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn rename_client(state: State<'_, AppState>, id: String, name: String) -> Result<(), String> {
    state.store()?.rename_client(&id, name)
}

/// Persist a new client ordering (drag-to-reorder in the list). Small JSON
/// write, so it stays on the main thread like the other list mutations.
#[tauri::command]
pub fn reorder_clients(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    state.store()?.reorder_clients(&ids)
}

#[tauri::command]
pub fn update_client_links(
    state: State<'_, AppState>,
    id: String,
    link_options: LinkOptions,
) -> Result<(), String> {
    state.store()?.update_link_options(&id, link_options)
}

/// Walks the whole client folder — must stay off the main thread.
#[tauri::command]
pub async fn get_client_stats(
    state: State<'_, AppState>,
    id: String,
) -> Result<ClientStats, String> {
    let paths = state.paths.clone();
    blocking(move || Ok(ClientStore::new(&paths)?.client_stats(&id))).await
}

#[tauri::command]
pub async fn list_client_mods(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<String>, String> {
    let paths = state.paths.clone();
    blocking(move || {
        let folder = ClientStore::new(&paths)?
            .client_folder_path(&id)
            .ok_or("Client folder not found.")?;
        let mods_path = folder.join("mods");
        if !mods_path.exists() {
            return Ok(Vec::new());
        }

        let mut entries: Vec<String> = std::fs::read_dir(&mods_path)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    format!("{name}/")
                } else {
                    name
                }
            })
            .collect();
        entries.sort_by_key(|a| a.to_lowercase());
        Ok(entries)
    })
    .await
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

// Explorer opens are quick but can stall on slow disks; `(async)` runs them
// on the async runtime instead of the main thread.

#[tauri::command(async)]
pub fn open_client_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let folder = state
        .store()?
        .client_folder_path(&id)
        .ok_or("Client folder not found.")?;
    open_in_explorer(folder)
}

#[tauri::command(async)]
pub fn open_client_plugins_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let folder = state
        .store()?
        .client_folder_path(&id)
        .ok_or("Client folder not found.")?;
    open_in_explorer(folder.join("plugins"))
}

#[tauri::command(async)]
pub fn open_citizenfx_folder() -> Result<(), String> {
    let dir = paths::citizen_fx_dir().ok_or("CitizenFX folder not found.")?;
    open_in_explorer(dir)
}

#[tauri::command(async)]
pub fn open_fivem_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = paths::five_m_path(state.game_path_override().as_deref())
        .ok_or("FiveM folder not found.")?;
    open_in_explorer(dir)
}

#[tauri::command(async)]
pub fn open_fivem_plugins_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = paths::five_m_path(state.game_path_override().as_deref())
        .ok_or("FiveM folder not found.")?;
    open_in_explorer(dir.join("plugins"))
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    settings::load(&state.paths.settings_file())
}

#[tauri::command]
pub fn set_game_path(state: State<'_, AppState>, game_path: String) -> Result<(), String> {
    settings::set_game_path(&state.paths.settings_file(), game_path)
}

#[tauri::command]
pub fn set_minimize_to_tray_on_game_launch(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    settings::set_minimize_to_tray_on_game_launch(&state.paths.settings_file(), enabled)
}

#[tauri::command]
pub fn set_theme_primary_hex(
    state: State<'_, AppState>,
    hex: Option<String>,
) -> Result<(), String> {
    settings::set_theme_primary_hex(&state.paths.settings_file(), hex)
}

#[tauri::command]
pub fn get_resolved_game_path(state: State<'_, AppState>) -> Option<String> {
    paths::five_m_path(state.game_path_override().as_deref())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn browse_game_path(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    // The dialog blocks until dismissed — keep that wait on a blocking
    // thread, not an async runtime worker.
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Select FiveM.app folder")
            .blocking_pick_folder();

        match picked {
            Some(tauri_plugin_dialog::FilePath::Path(p)) => Some(p.to_string_lossy().to_string()),
            Some(tauri_plugin_dialog::FilePath::Url(u)) => u
                .to_file_path()
                .ok()
                .map(|p| p.to_string_lossy().to_string()),
            None => None,
        }
    })
    .await
    .unwrap_or(None)
}

#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// `%APPDATA%\FiveLaunch` — where clients.json and every client folder live.
/// Exposed so users can copy their clients out before uninstalling.
#[tauri::command(async)]
pub fn open_app_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    open_in_explorer(state.paths.app_data.clone())
}

/// Full uninstall: wipe `%APPDATA%\FiveLaunch` (clients, settings, backups),
/// hand off to the NSIS uninstaller that lives next to the exe, and quit.
/// The wipe can remove GBs of client data — keep it off the main thread so
/// the window stays alive while it runs.
#[tauri::command]
pub async fn uninstall_app(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let runtime = state.runtime.clone();
    let app_data = state.paths.app_data.clone();
    blocking(move || {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let uninstaller = exe
            .parent()
            .map(|dir| dir.join("uninstall.exe"))
            .filter(|p| p.exists())
            .ok_or("Uninstaller not found next to the app — is this a development build?")?;

        // Stop background sync/watcher work so nothing recreates files mid-wipe.
        if let Ok(mut guard) = runtime.lock() {
            guard.stop_all();
        }

        log::info!("Uninstall requested: removing app data and starting uninstaller");
        if app_data.exists() {
            std::fs::remove_dir_all(&app_data)
                .map_err(|e| format!("Could not remove app data: {e}"))?;
        }

        crate::core::process::spawn_detached(&uninstaller, &[]).map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/// The full blocking launch flow. Shared by the `launch_client` command, the
/// single-instance argv handler, and startup `--launch-client` auto-launch.
pub fn run_launch_blocking(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    use tauri::Emitter;

    let state = app.state::<AppState>();
    let client = state.store()?.get_client(id).ok_or("Client not found.")?;
    let paths = state.paths.clone();
    let caches = state.mirror_caches.clone();
    let runtime = state.runtime.clone();

    let app_settings = settings::load(&paths.settings_file());
    let minimize_to_tray = app_settings.minimize_to_tray_on_game_launch;
    let is_junction_plugins_mode = client.link_options.plugins
        && client.link_options.plugins_mode.unwrap_or(PluginsMode::Sync) == PluginsMode::Junction;

    let emit = |message: &str| {
        let _ = app.emit("launch-status", message);
    };

    // Never launch while a previous finalizing sync is still running —
    // starting a new client mid-finalization can mix files across clients.
    let mut reported_waiting = false;
    loop {
        let finalizing = runtime
            .lock()
            .map(|r| r.plugins_finalizing())
            .unwrap_or(false);
        if !finalizing {
            break;
        }
        if !reported_waiting {
            emit("Waiting for plugins sync to finish...");
            reported_waiting = true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    // Stop ALL background work from the previous launch before relinking.
    if let Ok(mut guard) = runtime.lock() {
        guard.stop_all();
    }

    // v1 hides the window before linking begins.
    if minimize_to_tray {
        crate::tray::minimize_to_tray(app);
        crate::tray::set_tray_status(Some(&format!("Launching {}…", client.name)));
    }

    // Production launch dependencies. FiveM pure-mode args are baked into the
    // spawn closure so the launch pipeline's spawn stays argument-free.
    let pure_args: Vec<String> = match client.pure_mode {
        Some(level @ 1..=2) => vec![format!("-pure_{level}")],
        _ => Vec::new(),
    };
    let spawn_fn =
        move |exe: &std::path::Path| crate::core::process::spawn_detached(exe, &pure_args);
    let gta_targets_fn = |o: Option<&str>| crate::core::gta_settings::gta_settings_targets(o);
    let gta_repair_sources_fn =
        |o: Option<&str>| crate::core::gta_settings::resolve_external_repair_sources(o);
    let deps = crate::core::launch::LaunchDeps {
        is_game_running: &crate::core::process::is_game_running,
        spawn: &spawn_fn,
        gta_targets: &gta_targets_fn,
        gta_repair_sources: &gta_repair_sources_fn,
        citizen_fx_ini: &crate::core::paths::citizen_fx_ini_path,
    };

    let launch_result = {
        let mut caches = caches.lock().map_err(|e| e.to_string())?;
        let mut status = |message: &str| emit(message);
        crate::core::launch::launch_client(
            &paths,
            id,
            &client.link_options,
            &mut caches,
            &deps,
            &mut status,
        )
    };

    let outcome = match launch_result {
        Ok(outcome) => outcome,
        Err(err) => {
            // v1: restore the window so the user sees the error.
            crate::tray::restore_from_tray(app);
            crate::tray::set_tray_status(None);
            return Err(err);
        }
    };

    // The game spawned: record it as last played and remember the selection so
    // the UI reselects this client on the next app start. Best-effort — a
    // bookkeeping failure must not abort a successful launch.
    if let Ok(store) = state.store() {
        if let Err(err) = store.mark_launched(id) {
            log::warn!("Could not update last-played for {id}: {err}");
        }
    }

    let mut new_runtime = LaunchRuntime::default();

    // Sync-mode plugins: keep syncing safe files while the game runs,
    // finalize after exit.
    if let Some(plan) = outcome.runtime_sync {
        let status_emitter: Arc<dyn Fn(&str) + Send + Sync> = {
            let app = app.clone();
            Arc::new(move |message: &str| {
                let _ = app.emit("launch-status", message);
            })
        };
        new_runtime.plugins = Some(crate::core::plugins_sync::spawn_runtime_sync(
            plan.game_plugins_dir,
            plan.client_plugins_dir,
            crate::core::plugins_sync::RuntimeSyncConfig::default(),
            Arc::new(crate::core::process::is_game_running),
            status_emitter,
        ));
    }

    // ReShade shadow copies + CitizenFX.ini: prefer-newest loop while the
    // game runs, final pass after exit.
    if !outcome.file_sync_pairs.is_empty() {
        let pairs = outcome.file_sync_pairs;
        new_runtime.tasks.push(BackgroundTask::spawn(move |stop| {
            crate::core::file_sync::run_prefer_newest_sync_loop(
                &pairs,
                &crate::core::file_sync::FileSyncConfig::default(),
                &crate::core::process::is_game_running,
                &stop,
            );
        }));
    }

    // GTA settings enforcement: fight FiveM's profile sync for a few
    // minutes after spawn. The restore watcher cancels it as soon as the
    // game exits (it has no final pass to protect), so a short session
    // doesn't hold the restore hostage for the full enforcement window.
    let mut session_end_stops: Vec<Arc<AtomicBool>> = Vec::new();
    if let Some(plan) = outcome.gta_enforcement {
        let task = BackgroundTask::spawn(move |stop| {
            crate::core::gta_settings::run_gta_settings_enforcement(
                &plan,
                &crate::core::gta_settings::EnforcementConfig::default(),
                &stop,
            );
        });
        session_end_stops.push(task.stop.clone());
        new_runtime.tasks.push(task);
    }

    // Restore from tray when the game exits (v1 startRestoreOnGameExit).
    // The watcher also keeps the tray status line fresh ("Playing X — N min").
    // Junction plugins mode runs no background processes while the game is
    // open, so the user restores manually via the tray.
    if minimize_to_tray {
        if is_junction_plugins_mode {
            crate::tray::set_tray_status(Some(&format!("Playing {}", client.name)));
        } else {
            let app = app.clone();
            let client_name = client.name.clone();
            new_runtime.tasks.push(BackgroundTask::spawn(move |stop| {
                restore_on_game_exit(&app, &client_name, &stop);
            }));
        }
    }

    // Restore-on-close: once this session fully winds down (game exits AND
    // every sync/finalize pass completes), point the live FiveM state back at
    // the snapshot baseline. Skipped when the client opted out or when no
    // snapshot client exists yet.
    if client.restore_on_close_enabled() {
        let snapshot = app_settings
            .snapshot_client_id
            .clone()
            .filter(|sid| paths.clients_data().join(sid).exists());
        if let Some(snapshot_id) = snapshot {
            let wait_for: Vec<Arc<AtomicBool>> = new_runtime
                .tasks
                .iter()
                .map(BackgroundTask::finished_flag)
                .chain(new_runtime.plugins.as_ref().map(RuntimeSyncHandle::finished_flag))
                .collect();
            // If the game never actually starts there is no session work to
            // finalize — everything can be stopped before restoring.
            let mut never_ran_stops: Vec<Arc<AtomicBool>> =
                new_runtime.tasks.iter().map(|t| t.stop.clone()).collect();
            if let Some(p) = &new_runtime.plugins {
                never_ran_stops.push(p.stop.clone());
            }

            let app = app.clone();
            let game_path_override = app_settings.game_path;
            new_runtime.restore = Some(BackgroundTask::spawn(move |stop| {
                run_restore_watcher(
                    &app,
                    &paths,
                    &snapshot_id,
                    game_path_override.as_deref(),
                    &wait_for,
                    &session_end_stops,
                    &never_ran_stops,
                    &stop,
                );
            }));
        }
    }

    if let Ok(mut guard) = runtime.lock() {
        *guard = new_runtime;
    }

    Ok(())
}

/// Wait for the launched session to end, let every background sync task
/// drain, then restore the snapshot baseline. Never locks the LaunchRuntime —
/// it only reads the shared flags captured at spawn time, so `stop_all` can
/// join it without deadlocking.
#[allow(clippy::too_many_arguments)]
fn run_restore_watcher(
    app: &tauri::AppHandle,
    paths: &AppPaths,
    snapshot_id: &str,
    game_path_override: Option<&str>,
    wait_for: &[Arc<AtomicBool>],
    session_end_stops: &[Arc<AtomicBool>],
    never_ran_stops: &[Arc<AtomicBool>],
    stop: &AtomicBool,
) {
    use tauri::Emitter;

    let emit = |message: &str| {
        let _ = app.emit("launch-status", message);
    };
    let sleep_responsive = |total_ms: u64| -> bool {
        // Returns false when stopped mid-sleep.
        for _ in 0..(total_ms / 50).max(1) {
            if stop.load(Ordering::SeqCst) {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        true
    };

    // Phase 1: track the session (60s grace for the game to appear, like the
    // tray watcher).
    let started = std::time::Instant::now();
    let mut game_seen = false;
    loop {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let running = crate::core::process::is_game_running();
        if running {
            game_seen = true;
        } else if game_seen {
            break; // session over
        } else if started.elapsed() > std::time::Duration::from_secs(60) {
            break; // game never started; links were applied, still restore
        }
        if !sleep_responsive(1_000) {
            return;
        }
    }

    // Phase 2: wind down. Enforcement has no final pass — cancel it now.
    // When the game never ran there are no session changes to finalize, so
    // everything can be cancelled.
    let stops = if game_seen { session_end_stops } else { never_ran_stops };
    for flag in stops {
        flag.store(true, Ordering::SeqCst);
    }

    // Phase 3: wait for every sync/finalize pass to complete. Restoring while
    // a prefer-newest pass is still running would copy snapshot files into the
    // just-closed client, so on timeout we skip the restore instead.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
    while !wait_for.iter().all(|f| f.load(Ordering::SeqCst)) {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        if std::time::Instant::now() > deadline {
            log::warn!("Restore-on-close skipped: background sync still busy after 10 minutes");
            emit("WARNING: Restore skipped — background sync still busy.");
            return;
        }
        if !sleep_responsive(100) {
            return;
        }
    }

    // Phase 4: restore the baseline.
    let targets = crate::core::gta_settings::gta_settings_targets(game_path_override);
    let ini = crate::core::paths::citizen_fx_ini_path();
    let mut status = |message: &str| emit(message);
    match crate::core::snapshot::restore_baseline(
        paths,
        snapshot_id,
        game_path_override,
        &targets,
        ini.as_deref(),
        &mut status,
    ) {
        Ok(()) => log::info!("Restored snapshot baseline after session"),
        Err(err) => {
            log::error!("Restore-on-close failed: {err}");
            emit(&format!("WARNING: Could not restore your setup: {err}"));
        }
    }
}

/// Wait for the game to appear (60s grace) and then exit; restore the window.
/// While the game runs, keeps the tray status line updated with the client
/// name and elapsed play time.
fn restore_on_game_exit(
    app: &tauri::AppHandle,
    client_name: &str,
    stop: &std::sync::atomic::AtomicBool,
) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    let started = std::time::Instant::now();
    let mut playing_since: Option<std::time::Instant> = None;

    loop {
        if stop.load(Ordering::SeqCst) {
            return;
        }

        let running = crate::core::process::is_game_running();
        match playing_since {
            None => {
                if running {
                    playing_since = Some(std::time::Instant::now());
                } else if started.elapsed() > std::time::Duration::from_secs(60) {
                    // Game never started; give up quietly (v1 behavior).
                    crate::tray::set_tray_status(None);
                    return;
                }
            }
            Some(since) => {
                if running {
                    let mins = since.elapsed().as_secs() / 60;
                    let text = if mins < 1 {
                        format!("Playing {client_name} — just started")
                    } else {
                        format!("Playing {client_name} — {mins} min")
                    };
                    crate::tray::set_tray_status(Some(&text));
                } else {
                    crate::tray::set_tray_status(None);
                    crate::tray::restore_from_tray(app);
                    let _ = app.emit("launch-status", "Game closed.");
                    return;
                }
            }
        }

        // ~1s tick, responsive to stop.
        for _ in 0..20 {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

// ---------------------------------------------------------------------------
// Backup history
// ---------------------------------------------------------------------------

/// Walks every backup folder for sizes — must stay off the main thread.
#[tauri::command]
pub async fn list_backups(
    state: State<'_, AppState>,
) -> Result<Vec<crate::core::backups::BackupEntry>, String> {
    let root = crate::core::backups::backups_root(&state.paths);
    blocking(move || Ok(crate::core::backups::list_backups(&root))).await
}

#[tauri::command(async)]
pub fn open_backups_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = crate::core::backups::backups_root(&state.paths);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_in_explorer(dir)
}

/// Recursively deletes a backup folder — must stay off the main thread.
#[tauri::command]
pub async fn delete_backup(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let root = crate::core::backups::backups_root(&state.paths);
    blocking(move || crate::core::backups::delete_backup(&root, &name)).await
}

#[tauri::command]
pub async fn launch_client(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // The pipeline does blocking filesystem work — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || run_launch_blocking(&app, &id))
        .await
        .map_err(|e| e.to_string())?
}

/// Process-table scan — `(async)` keeps it off the main thread.
#[tauri::command(async)]
pub fn is_game_running() -> bool {
    crate::core::process::is_game_running()
}

/// Same shape as v1's `get-game-busy-state` response, plus `busy` which
/// covers ALL in-flight session work (restore-on-close included).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBusyState {
    /// Plugins sync is finalizing — drives the "plugins sync running" badge.
    pub plugins_sync_busy: bool,
    /// Any session work is still running; the launch button stays disabled.
    pub busy: bool,
}

#[tauri::command]
pub fn get_game_busy_state(state: State<'_, AppState>) -> GameBusyState {
    let (plugins_sync_busy, busy) = state
        .runtime
        .lock()
        .map(|r| (r.plugins_finalizing(), r.is_busy()))
        .unwrap_or((false, false));
    GameBusyState {
        plugins_sync_busy,
        busy,
    }
}

// ---------------------------------------------------------------------------
// Window / tray
// ---------------------------------------------------------------------------

/// Setting-aware minimize (v1 `window-minimize`): with minimize-to-tray
/// enabled, the titlebar minimize button hides to the tray instead.
#[tauri::command]
pub fn window_minimize(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) {
    let app_settings = settings::load(&state.paths.settings_file());
    if app_settings.minimize_to_tray_on_game_launch {
        crate::tray::minimize_to_tray(&app);
    } else {
        let _ = window.minimize();
    }
}

// ---------------------------------------------------------------------------
// Updates / logs / shortcuts
// ---------------------------------------------------------------------------

const UPDATE_CACHE_TTL_MS: u64 = 15 * 60 * 1000;
const GITHUB_REPO: &str = "oyuh/fivelaunch";

#[tauri::command]
pub async fn get_update_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateStatus, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if let Ok(cache) = state.update_cache.lock() {
        if let Some(cached) = cache.as_ref() {
            if now_ms.saturating_sub(cached.checked_at) < UPDATE_CACHE_TTL_MS {
                return Ok(cached.clone());
            }
        }
    }

    let current_version = app.package_info().version.to_string();
    let cache = state.update_cache.clone();

    // Network call — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let status = crate::core::update_checker::check_for_updates_on_github(
            GITHUB_REPO,
            &current_version,
            &crate::core::update_checker::fetch_json_ureq,
        );
        if let Ok(mut guard) = cache.lock() {
            *guard = Some(status.clone());
        }
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_app_logs(state: State<'_, AppState>) -> Vec<AppLogEntry> {
    state.log_store.get_logs()
}

#[tauri::command]
pub fn clear_app_logs(state: State<'_, AppState>) {
    state.log_store.clear();
}

#[tauri::command(async)]
pub fn create_client_shortcut(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let client = state.store()?.get_client(&id).ok_or("Client not found.")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let desktop = dirs::desktop_dir().ok_or("Desktop folder not found.")?;

    let path = crate::core::shortcut::create_client_shortcut(&exe, &desktop, &id, &client.name)?;
    log::info!("Created desktop shortcut: {}", path.display());
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https URLs can be opened.".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// GTA settings (editor UI)
// ---------------------------------------------------------------------------

// XML parse/serialize + file IO — `(async)` keeps them off the main thread.

#[tauri::command(async)]
pub fn get_client_gta_settings(
    state: State<'_, AppState>,
    id: String,
) -> Result<GtaSettingsDocument, String> {
    Ok(crate::core::gta_settings::get_client_settings(
        &state.paths.clients_data(),
        &id,
    ))
}

#[tauri::command(async)]
pub fn save_client_gta_settings(
    state: State<'_, AppState>,
    id: String,
    doc: GtaSettingsDocument,
) -> Result<GtaSettingsSaveResult, String> {
    // Prefer the user's authoritative GTA V settings (the real
    // Documents\Rockstar Games file, with the GPU) and, failing that, the
    // OS-detected GPU when repairing gaps — the template is only the last resort.
    let external = crate::core::gta_settings::resolve_external_repair_sources(
        state.game_path_override().as_deref(),
    );
    let external_refs: Vec<&GtaSettingsDocument> = external.iter().collect();
    crate::core::gta_settings::save_client_settings(
        &state.paths.clients_data(),
        &id,
        &doc,
        &external_refs,
    )
}

#[tauri::command(async)]
pub fn import_gta_settings_from_documents(
    state: State<'_, AppState>,
    id: String,
) -> Result<GtaSettingsDocument, String> {
    crate::core::gta_settings::import_from_documents(
        &state.paths.clients_data(),
        &id,
        state.game_path_override().as_deref(),
    )
}

#[tauri::command(async)]
pub fn import_gta_settings_from_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<GtaSettingsDocument, String> {
    crate::core::gta_settings::import_from_template(&state.paths.clients_data(), &id)
}

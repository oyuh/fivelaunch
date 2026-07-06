use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

use crate::core::clients::{ClientProfile, ClientStore, LinkOptions, PluginsMode};
use crate::core::file_sync::BackgroundTask;
use crate::core::gta_settings::GtaSettingsDocument;
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
}

impl LaunchRuntime {
    pub fn plugins_finalizing(&self) -> bool {
        self.plugins
            .as_ref()
            .is_some_and(RuntimeSyncHandle::is_finalizing)
    }

    pub fn stop_all(&mut self) {
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

#[tauri::command]
pub fn create_client(
    state: State<'_, AppState>,
    name: String,
    icon: Option<String>,
) -> Result<ClientProfile, String> {
    state.store()?.create_client(name, icon)
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

#[tauri::command]
pub fn delete_client(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store()?.delete_client(&id)
}

#[tauri::command]
pub fn rename_client(state: State<'_, AppState>, id: String, name: String) -> Result<(), String> {
    state.store()?.rename_client(&id, name)
}

#[tauri::command]
pub fn update_client_links(
    state: State<'_, AppState>,
    id: String,
    link_options: LinkOptions,
) -> Result<(), String> {
    state.store()?.update_link_options(&id, link_options)
}

#[tauri::command]
pub fn get_client_stats(state: State<'_, AppState>, id: String) -> Result<ClientStats, String> {
    Ok(state.store()?.client_stats(&id))
}

#[tauri::command]
pub fn list_client_mods(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let folder = state
        .store()?
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
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_client_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let folder = state
        .store()?
        .client_folder_path(&id)
        .ok_or("Client folder not found.")?;
    open_in_explorer(folder)
}

#[tauri::command]
pub fn open_client_plugins_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let folder = state
        .store()?
        .client_folder_path(&id)
        .ok_or("Client folder not found.")?;
    open_in_explorer(folder.join("plugins"))
}

#[tauri::command]
pub fn open_citizenfx_folder() -> Result<(), String> {
    let dir = paths::citizen_fx_dir().ok_or("CitizenFX folder not found.")?;
    open_in_explorer(dir)
}

#[tauri::command]
pub fn open_fivem_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = paths::five_m_path(state.game_path_override().as_deref())
        .ok_or("FiveM folder not found.")?;
    open_in_explorer(dir)
}

#[tauri::command]
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
}

#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
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
    let deps = crate::core::launch::LaunchDeps {
        is_game_running: &crate::core::process::is_game_running,
        spawn: &spawn_fn,
        gta_targets: &gta_targets_fn,
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
    // minutes after spawn.
    if let Some(plan) = outcome.gta_enforcement {
        new_runtime.tasks.push(BackgroundTask::spawn(move |stop| {
            crate::core::gta_settings::run_gta_settings_enforcement(
                &plan,
                &crate::core::gta_settings::EnforcementConfig::default(),
                &stop,
            );
        }));
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

    if let Ok(mut guard) = runtime.lock() {
        *guard = new_runtime;
    }

    Ok(())
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

#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Vec<crate::core::backups::BackupEntry> {
    crate::core::backups::list_backups(&crate::core::backups::backups_root(&state.paths))
}

#[tauri::command]
pub fn open_backups_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = crate::core::backups::backups_root(&state.paths);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_in_explorer(dir)
}

#[tauri::command]
pub fn delete_backup(state: State<'_, AppState>, name: String) -> Result<(), String> {
    crate::core::backups::delete_backup(&crate::core::backups::backups_root(&state.paths), &name)
}

#[tauri::command]
pub async fn launch_client(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // The pipeline does blocking filesystem work — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || run_launch_blocking(&app, &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn is_game_running() -> bool {
    crate::core::process::is_game_running()
}

/// Same shape as v1's `get-game-busy-state` response.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBusyState {
    pub plugins_sync_busy: bool,
}

#[tauri::command]
pub fn get_game_busy_state(state: State<'_, AppState>) -> GameBusyState {
    let busy = state
        .runtime
        .lock()
        .map(|r| r.plugins_finalizing())
        .unwrap_or(false);
    GameBusyState {
        plugins_sync_busy: busy,
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

#[tauri::command]
pub fn create_client_shortcut(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let client = state.store()?.get_client(&id).ok_or("Client not found.")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let desktop = dirs::desktop_dir().ok_or("Desktop folder not found.")?;

    let path = crate::core::shortcut::create_client_shortcut(&exe, &desktop, &id, &client.name)?;
    log::info!("Created desktop shortcut: {}", path.display());
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https URLs can be opened.".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// GTA settings (editor UI)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_client_gta_settings(
    state: State<'_, AppState>,
    id: String,
) -> Result<GtaSettingsDocument, String> {
    Ok(crate::core::gta_settings::get_client_settings(
        &state.paths.clients_data(),
        &id,
    ))
}

#[tauri::command]
pub fn save_client_gta_settings(
    state: State<'_, AppState>,
    id: String,
    doc: GtaSettingsDocument,
) -> Result<(), String> {
    crate::core::gta_settings::save_client_settings(&state.paths.clients_data(), &id, &doc)
}

#[tauri::command]
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

#[tauri::command]
pub fn import_gta_settings_from_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<GtaSettingsDocument, String> {
    crate::core::gta_settings::import_from_template(&state.paths.clients_data(), &id)
}

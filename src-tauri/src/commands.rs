use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::core::clients::{ClientProfile, ClientStore, LinkOptions};
use crate::core::file_sync::BackgroundTask;
use crate::core::gta_settings::GtaSettingsDocument;
use crate::core::paths::{self, AppPaths};
use crate::core::plugins_sync::RuntimeSyncHandle;
use crate::core::settings::{self, AppSettings};
use crate::core::stats::ClientStats;

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
}

impl AppState {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            mirror_caches: Arc::new(Mutex::new(HashMap::new())),
            runtime: Arc::new(Mutex::new(LaunchRuntime::default())),
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
pub fn create_client(state: State<'_, AppState>, name: String) -> Result<ClientProfile, String> {
    state.store()?.create_client(name)
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

#[tauri::command]
pub async fn launch_client(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let client = state.store()?.get_client(&id).ok_or("Client not found.")?;
    let paths = state.paths.clone();
    let caches = state.mirror_caches.clone();
    let runtime = state.runtime.clone();

    // The pipeline does blocking filesystem work — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
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

        let deps = crate::core::launch::LaunchDeps::real();

        let outcome = {
            let mut caches = caches.lock().map_err(|e| e.to_string())?;
            let mut status = |message: &str| emit(message);
            crate::core::launch::launch_client(
                &paths,
                &id,
                &client.link_options,
                &mut caches,
                &deps,
                &mut status,
            )?
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

        if let Ok(mut guard) = runtime.lock() {
            *guard = new_runtime;
        }

        Ok(())
    })
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

use tauri::State;

use crate::core::clients::{ClientProfile, ClientStore, LinkOptions};
use crate::core::paths::{self, AppPaths};
use crate::core::settings::{self, AppSettings};
use crate::core::stats::ClientStats;

pub struct AppState {
    pub paths: AppPaths,
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

    // The pipeline does blocking filesystem work — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let mut status = |message: &str| {
            let _ = app.emit("launch-status", message);
        };
        let deps = crate::core::launch::LaunchDeps {
            is_game_running: &crate::core::process::is_game_running,
            spawn: &|exe| crate::core::process::spawn_detached(exe),
        };
        crate::core::launch::launch_client(&paths, &id, &client.link_options, &deps, &mut status)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn is_game_running() -> bool {
    crate::core::process::is_game_running()
}

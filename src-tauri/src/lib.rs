mod commands;
pub mod core;

use commands::AppState;
use core::paths::AppPaths;
use core::settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = AppPaths::resolve().expect("failed to resolve app data directory");

    // Cheap, and guarantees the same first-run files v1 creates.
    let _ = settings::ensure_initialized(&paths.settings_file());
    let _ = core::clients::ClientStore::new(&paths);

    let state = AppState::new(paths);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_clients,
            commands::create_client,
            commands::delete_client,
            commands::rename_client,
            commands::update_client_links,
            commands::get_client_stats,
            commands::list_client_mods,
            commands::open_client_folder,
            commands::open_client_plugins_folder,
            commands::open_citizenfx_folder,
            commands::open_fivem_folder,
            commands::open_fivem_plugins_folder,
            commands::get_settings,
            commands::set_game_path,
            commands::set_minimize_to_tray_on_game_launch,
            commands::set_theme_primary_hex,
            commands::get_resolved_game_path,
            commands::browse_game_path,
            commands::get_app_version,
            commands::launch_client,
            commands::is_game_running,
            commands::get_game_busy_state,
            commands::get_client_gta_settings,
            commands::save_client_gta_settings,
            commands::import_gta_settings_from_documents,
            commands::import_gta_settings_from_template,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

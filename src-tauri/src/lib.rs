mod commands;
pub mod core;
mod tray;

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
    let log_store = state.log_store.clone();

    tauri::Builder::default()
        // Must be first: a second instance forwards its argv here and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            tray::restore_from_tray(app);
            if let Some(id) = core::args::get_launch_client_arg(&argv) {
                log::info!("Second instance requested launch of client {id}");
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Err(err) = commands::run_launch_blocking(&app, &id) {
                        log::error!("Shortcut launch error: {err}");
                    }
                });
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            // Global logger: stderr + ring buffer + live `app-log` events.
            let handle = app.handle().clone();
            core::log_store::StoreLogger::install(
                log_store.clone(),
                Box::new(move |entry| {
                    use tauri::Emitter;
                    let _ = handle.emit("app-log", entry.clone());
                }),
            );
            log::info!("FiveLaunch v{} started", app.package_info().version);

            // Desktop shortcut launch: FiveLaunch.exe --launch-client=<id>
            let argv: Vec<String> = std::env::args().collect();
            if let Some(id) = core::args::get_launch_client_arg(&argv) {
                log::info!("Auto-launching client {id} from command line");
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    // Small delay so the window is up first (v1: 750ms).
                    std::thread::sleep(std::time::Duration::from_millis(750));
                    if let Err(err) = commands::run_launch_blocking(&handle, &id) {
                        log::error!("Auto-launch error: {err}");
                    }
                });
            }

            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_clients,
            commands::get_selected_client_id,
            commands::create_client,
            commands::duplicate_client,
            commands::set_client_icon,
            commands::set_client_pure_mode,
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
            commands::window_minimize,
            commands::get_update_status,
            commands::get_app_logs,
            commands::clear_app_logs,
            commands::create_client_shortcut,
            commands::open_url,
            commands::list_backups,
            commands::open_backups_folder,
            commands::delete_backup,
            commands::open_app_data_folder,
            commands::uninstall_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

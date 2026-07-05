use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use super::clients::{LinkOptions, PluginsMode};
use super::linking::link_folder;
use super::paths::{self, AppPaths};
use super::plugins_sync::{
    initial_sync_client_to_game, prepare_game_plugins_dir_for_sync_mode,
    write_plugins_owner_marker,
};
use super::settings;

/// External effects injected for testability.
pub struct LaunchDeps<'a> {
    /// Is GTA5.exe / FiveM.exe currently running?
    pub is_game_running: &'a dyn Fn() -> bool,
    /// Spawn the FiveM executable detached.
    pub spawn: &'a dyn Fn(&Path) -> io::Result<()>,
}

/// Instructions for the caller after a successful launch.
#[derive(Debug)]
pub struct LaunchOutcome {
    /// When set (plugins sync mode), the caller must run the runtime sync
    /// loop on a background thread for these directories.
    pub runtime_sync: Option<RuntimeSyncPlan>,
}

#[derive(Debug)]
pub struct RuntimeSyncPlan {
    pub game_plugins_dir: PathBuf,
    pub client_plugins_dir: PathBuf,
}

/// Launch pipeline — port of v1 `GameManager.launchClient`.
///
/// Phase 3 state: mods/citizen links, plugins junction AND sync modes.
/// Phase 4 adds: GTA settings apply/enforcement, CitizenFX.ini, ReShade.
pub fn launch_client(
    app_paths: &AppPaths,
    client_id: &str,
    link: &LinkOptions,
    mirror_caches: &mut HashMap<String, HashMap<String, f64>>,
    deps: &LaunchDeps<'_>,
    status: &mut dyn FnMut(&str),
) -> Result<LaunchOutcome, String> {
    let game_path_override = settings::load(&app_paths.settings_file()).game_path;
    let five_m_path = paths::five_m_path(game_path_override.as_deref())
        .ok_or("FiveM installation not found.")?;
    let five_m_exe = paths::five_m_executable(game_path_override.as_deref())
        .ok_or("FiveM installation not found.")?;

    let client_path = app_paths.clients_data().join(client_id);
    if !client_path.exists() {
        return Err(format!("Client data for ID {client_id} not found."));
    }

    status("Preparing launch...");

    if (deps.is_game_running)() {
        return Err("Please close GTA V and FiveM before launching a new client.".into());
    }

    let mut outcome = LaunchOutcome { runtime_sync: None };

    // 1. Mods
    if link.mods {
        status("Linking mods...");
        link_folder(&client_path.join("mods"), &five_m_path.join("mods"), false)?;
    }

    // 2. Plugins
    if link.plugins {
        let client_plugins = client_path.join("plugins");
        let game_plugins = five_m_path.join("plugins");

        match link.plugins_mode.unwrap_or(PluginsMode::Sync) {
            PluginsMode::Junction => {
                status("Linking plugins...");
                link_folder(&client_plugins, &game_plugins, false)?;
                write_plugins_owner_marker(&client_plugins, client_id, "junction");
                status("Note: Plugins are linked (junction). ReShade may open the client plugins folder.");
            }
            PluginsMode::Sync => {
                std::fs::create_dir_all(&client_plugins).map_err(|e| e.to_string())?;
                prepare_game_plugins_dir_for_sync_mode(&game_plugins, client_id, status)?;
                initial_sync_client_to_game(
                    client_id,
                    &client_path,
                    &client_plugins,
                    &game_plugins,
                    mirror_caches,
                    status,
                );
                status("Note: Plugins are in copy/sync mode. ReShade should use the FiveM.app\\plugins path.");
                outcome.runtime_sync = Some(RuntimeSyncPlan {
                    game_plugins_dir: game_plugins,
                    client_plugins_dir: client_plugins,
                });
            }
        }
    }

    // 3. Citizen — links even when the client folder is sparse, same as v1
    // (user-provided citizen files replace the game's; that's on the user).
    if link.citizen {
        status("Linking citizen...");
        link_folder(&client_path.join("citizen"), &five_m_path.join("citizen"), false)?;
    }

    // 4/5. GTA settings + CitizenFX.ini land in Phase 4.
    if link.gta_settings {
        status("Note: GTA settings apply is not ported yet (Phase 4) — skipped.");
    }
    if link.citizen_fx_ini {
        status("Note: CitizenFX.ini sync is not ported yet (Phase 4) — skipped.");
    }

    status("Starting FiveM...");
    (deps.spawn)(&five_m_exe).map_err(|e| format!("Failed to start FiveM: {e}"))?;

    status("Launched!");
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::plugins_sync::{read_plugins_owner_marker, PluginsOwnerMarker};
    use std::cell::{Cell, RefCell};
    use std::fs;

    struct Harness {
        dir: tempfile::TempDir,
        app_paths: AppPaths,
        client_id: String,
    }

    /// Fake layout: app data + a client + a FiveM install (FiveM.app + FiveM.exe).
    fn setup() -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let app_data = dir.path().join("appdata");
        let app_paths = AppPaths::from_app_data(&app_data);

        let store = super::super::clients::ClientStore::new(&app_paths).unwrap();
        let client = store.create_client("Test".into()).unwrap();

        // Fake FiveM install; gamePath override points the resolver at it.
        let fivem_app = dir.path().join("FiveM").join("FiveM.app");
        fs::create_dir_all(fivem_app.join("mods")).unwrap();
        fs::write(fivem_app.join("mods").join("stock.rpf"), b"stock").unwrap();
        fs::write(dir.path().join("FiveM").join("FiveM.exe"), b"fake exe").unwrap();
        settings::set_game_path(
            &app_paths.settings_file(),
            fivem_app.to_string_lossy().to_string(),
        )
        .unwrap();

        Harness {
            dir,
            app_paths,
            client_id: client.id,
        }
    }

    fn link_all(mode: PluginsMode) -> LinkOptions {
        LinkOptions {
            mods: true,
            plugins: true,
            plugins_mode: Some(mode),
            citizen: false,
            gta_settings: false,
            citizen_fx_ini: false,
        }
    }

    #[test]
    fn happy_path_junction_links_and_spawns() {
        let h = setup();
        let spawned = RefCell::new(Vec::<PathBuf>::new());
        let statuses = RefCell::new(Vec::<String>::new());
        let not_running = || false;
        let record_spawn = |exe: &Path| -> io::Result<()> {
            spawned.borrow_mut().push(exe.to_path_buf());
            Ok(())
        };
        let deps = LaunchDeps {
            is_game_running: &not_running,
            spawn: &record_spawn,
        };

        let outcome = launch_client(
            &h.app_paths,
            &h.client_id,
            &link_all(PluginsMode::Junction),
            &mut HashMap::new(),
            &deps,
            &mut |s| statuses.borrow_mut().push(s.to_string()),
        )
        .unwrap();

        assert!(outcome.runtime_sync.is_none(), "junction mode has no runtime sync");
        assert_eq!(spawned.borrow().len(), 1);
        assert!(spawned.borrow()[0].ends_with("FiveM.exe"));

        // mods junction in place, original backed up
        let fivem_app = h.dir.path().join("FiveM").join("FiveM.app");
        assert!(fs::symlink_metadata(fivem_app.join("mods"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(fivem_app.join("mods_original").join("stock.rpf").exists());

        // plugins junction + owner marker
        assert!(fs::symlink_metadata(fivem_app.join("plugins"))
            .unwrap()
            .file_type()
            .is_symlink());
        let marker_path = h
            .app_paths
            .clients_data()
            .join(&h.client_id)
            .join("plugins")
            .join(".fivelaunch-plugins-owner.json");
        let marker: PluginsOwnerMarker =
            serde_json::from_str(&fs::read_to_string(marker_path).unwrap()).unwrap();
        assert_eq!(marker.client_id, h.client_id);
        assert_eq!(marker.mode, "junction");

        assert_eq!(statuses.borrow().last().map(String::as_str), Some("Launched!"));
    }

    #[test]
    fn sync_mode_mirrors_plugins_and_requests_runtime_sync() {
        let h = setup();
        let spawned = RefCell::new(Vec::<PathBuf>::new());
        let not_running = || false;
        let record_spawn = |exe: &Path| -> io::Result<()> {
            spawned.borrow_mut().push(exe.to_path_buf());
            Ok(())
        };
        let deps = LaunchDeps {
            is_game_running: &not_running,
            spawn: &record_spawn,
        };

        // Client has a plugin; game plugins dir has foreign content that must
        // be isolated, not merged.
        let client_plugins = h
            .app_paths
            .clients_data()
            .join(&h.client_id)
            .join("plugins");
        fs::create_dir_all(&client_plugins).unwrap();
        fs::write(client_plugins.join("ReShade.ini"), b"[GENERAL]").unwrap();
        let fivem_app = h.dir.path().join("FiveM").join("FiveM.app");
        fs::create_dir_all(fivem_app.join("plugins")).unwrap();
        fs::write(fivem_app.join("plugins").join("foreign.dll"), b"other").unwrap();

        let mut caches = HashMap::new();
        let outcome = launch_client(
            &h.app_paths,
            &h.client_id,
            &link_all(PluginsMode::Sync),
            &mut caches,
            &deps,
            &mut |_| {},
        )
        .unwrap();

        // Runtime sync requested with the right paths.
        let plan = outcome.runtime_sync.expect("sync mode must request runtime sync");
        assert_eq!(plan.client_plugins_dir, client_plugins);
        assert_eq!(plan.game_plugins_dir, fivem_app.join("plugins"));

        // Game plugins dir is a real, owned dir containing the client's files.
        let game_plugins = fivem_app.join("plugins");
        assert!(!fs::symlink_metadata(&game_plugins).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(game_plugins.join("ReShade.ini")).unwrap(), b"[GENERAL]");
        assert_eq!(
            read_plugins_owner_marker(&game_plugins).unwrap().client_id,
            h.client_id
        );
        // Foreign content rotated away, not present.
        assert!(!game_plugins.join("foreign.dll").exists());

        // Mirror cache warm in memory and persisted.
        assert!(caches
            .get(&format!("{}:client->game", h.client_id))
            .is_some_and(|c| !c.is_empty()));
    }

    #[test]
    fn refuses_when_game_running() {
        let h = setup();
        let spawned = Cell::new(0u32);

        let deps = LaunchDeps {
            is_game_running: &|| true,
            spawn: &|_| {
                spawned.set(spawned.get() + 1);
                Ok(())
            },
        };

        let err = launch_client(
            &h.app_paths,
            &h.client_id,
            &link_all(PluginsMode::Junction),
            &mut HashMap::new(),
            &deps,
            &mut |_| {},
        )
        .unwrap_err();

        assert!(err.contains("close GTA V and FiveM"), "got: {err}");
        assert_eq!(spawned.get(), 0, "must not spawn while game is running");
    }

    #[test]
    fn unknown_client_errors() {
        let h = setup();
        let deps = LaunchDeps {
            is_game_running: &|| false,
            spawn: &|_| Ok(()),
        };

        let err = launch_client(
            &h.app_paths,
            "nope",
            &link_all(PluginsMode::Junction),
            &mut HashMap::new(),
            &deps,
            &mut |_| {},
        )
        .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }
}

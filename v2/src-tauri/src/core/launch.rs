use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::clients::{LinkOptions, PluginsMode};
use super::linking::link_folder;
use super::paths::{self, AppPaths};
use super::settings;

/// `.fivelaunch-plugins-owner.json` payload — same shape as v1 for
/// cross-version debugging (`clientId`, `mode`, `at`).
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

/// External effects injected for testability.
pub struct LaunchDeps<'a> {
    /// Is GTA5.exe / FiveM.exe currently running?
    pub is_game_running: &'a dyn Fn() -> bool,
    /// Spawn the FiveM executable detached.
    pub spawn: &'a dyn Fn(&Path) -> io::Result<()>,
}

/// Launch pipeline (Phase 2 subset of v1 `GameManager.launchClient`):
/// mods/citizen linking, junction-mode plugins, detached spawn.
///
/// Phase 3 adds: sync-mode plugins + runtime sync.
/// Phase 4 adds: GTA settings apply/enforcement, CitizenFX.ini, ReShade.
pub fn launch_client(
    app_paths: &AppPaths,
    client_id: &str,
    link: &LinkOptions,
    deps: &LaunchDeps<'_>,
    status: &mut dyn FnMut(&str),
) -> Result<(), String> {
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

    // 1. Mods
    if link.mods {
        status("Linking mods...");
        link_folder(&client_path.join("mods"), &five_m_path.join("mods"), false)?;
    }

    // 2. Plugins
    if link.plugins {
        match link.plugins_mode.unwrap_or(PluginsMode::Sync) {
            PluginsMode::Junction => {
                status("Linking plugins...");
                let client_plugins = client_path.join("plugins");
                link_folder(&client_plugins, &five_m_path.join("plugins"), false)?;
                write_plugins_owner_marker(&client_plugins, client_id, "junction");
                status("Note: Plugins are linked (junction). ReShade may open the client plugins folder.");
            }
            PluginsMode::Sync => {
                // Phase 3 ports the full copy/sync engine. Be explicit rather
                // than silently doing nothing.
                status(
                    "WARNING: Plugins sync (copy) mode is not ported yet — plugins were NOT applied. Switch this client to junction mode for now.",
                );
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

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

    fn link_all_junction() -> LinkOptions {
        LinkOptions {
            mods: true,
            plugins: true,
            plugins_mode: Some(PluginsMode::Junction),
            citizen: false,
            gta_settings: false,
            citizen_fx_ini: false,
        }
    }

    #[test]
    fn happy_path_links_and_spawns() {
        let h = setup();
        let spawned = RefCell::new(Vec::<PathBuf>::new());
        let statuses = RefCell::new(Vec::<String>::new());

        let deps = LaunchDeps {
            is_game_running: &|| false,
            spawn: &|exe| {
                spawned.borrow_mut().push(exe.to_path_buf());
                Ok(())
            },
        };

        launch_client(
            &h.app_paths,
            &h.client_id,
            &link_all_junction(),
            &deps,
            &mut |s| statuses.borrow_mut().push(s.to_string()),
        )
        .unwrap();

        // FiveM.exe spawned
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
            &link_all_junction(),
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

        let err = launch_client(&h.app_paths, "nope", &link_all_junction(), &deps, &mut |_| {})
            .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn sync_mode_warns_and_does_not_link_plugins() {
        let h = setup();
        let statuses = RefCell::new(Vec::<String>::new());
        let deps = LaunchDeps {
            is_game_running: &|| false,
            spawn: &|_| Ok(()),
        };

        let mut link = link_all_junction();
        link.plugins_mode = Some(PluginsMode::Sync);

        launch_client(&h.app_paths, &h.client_id, &link, &deps, &mut |s| {
            statuses.borrow_mut().push(s.to_string())
        })
        .unwrap();

        assert!(statuses.borrow().iter().any(|s| s.contains("not ported")));
        let fivem_plugins = h.dir.path().join("FiveM").join("FiveM.app").join("plugins");
        assert!(
            !fivem_plugins.exists(),
            "sync mode must not touch game plugins yet"
        );
    }
}

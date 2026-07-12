use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use super::clients::{LinkOptions, PluginsMode};
use super::file_sync::SyncPair;
use super::gta_settings::{self, GtaEnforcementPlan};
use super::linking::link_folder;
use super::mirror::{copy_file_best_effort, ensure_file_exists};
use super::paths::{self, AppPaths};
use super::plugins_sync::{
    initial_sync_client_to_game, prepare_game_plugins_dir_for_sync_mode,
    write_plugins_owner_marker,
};
use super::reshade;
use super::settings;

/// External effects injected for testability. Production values live in the
/// command layer; tests substitute temp paths so no real user files are
/// touched.
pub struct LaunchDeps<'a> {
    /// Is GTA5.exe / FiveM.exe currently running?
    pub is_game_running: &'a dyn Fn() -> bool,
    /// Spawn the FiveM executable detached.
    pub spawn: &'a dyn Fn(&Path) -> io::Result<()>,
    /// Resolve the GTA settings target files (real: `gta_settings_targets`).
    pub gta_targets: &'a dyn Fn(Option<&str>) -> Vec<PathBuf>,
    /// Resolve external repair sources for the applied settings — the user's
    /// authoritative GTA settings plus the OS-detected GPU (real:
    /// `gta_settings::resolve_external_repair_sources`). These do real file/OS
    /// I/O, so they are injected to keep the launch pipeline testable.
    pub gta_repair_sources: &'a dyn Fn(Option<&str>) -> Vec<gta_settings::GtaSettingsDocument>,
    /// Resolve the real CitizenFX.ini path (real: `paths::citizen_fx_ini_path`).
    pub citizen_fx_ini: &'a dyn Fn() -> Option<PathBuf>,
}

/// Instructions for the caller after a successful launch.
#[derive(Debug, Default)]
pub struct LaunchOutcome {
    /// When set (plugins sync mode), the caller must run the runtime sync
    /// loop on a background thread for these directories.
    pub runtime_sync: Option<RuntimeSyncPlan>,
    /// File pairs (client shadow <-> real file) for the runtime sync loop:
    /// ReShade configs/presets + CitizenFX.ini. Empty in junction plugins
    /// mode (v1: no background processes while the game is open).
    pub file_sync_pairs: Vec<SyncPair>,
    /// When set, run the GTA settings enforcement loop after spawn.
    pub gta_enforcement: Option<GtaEnforcementPlan>,
}

#[derive(Debug)]
pub struct RuntimeSyncPlan {
    pub game_plugins_dir: PathBuf,
    pub client_plugins_dir: PathBuf,
}

/// Launch pipeline — port of v1 `GameManager.launchClient`.
///
/// Order (same as v1): mods -> plugins -> ReShade discovery -> citizen ->
/// GTA settings -> CitizenFX.ini -> spawn. Background work (plugins runtime
/// sync, file sync loop, GTA enforcement) is returned in the outcome for the
/// caller to run on threads.
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

    let mut outcome = LaunchOutcome::default();
    let is_junction_plugins_mode =
        link.plugins && link.plugins_mode.unwrap_or(PluginsMode::Sync) == PluginsMode::Junction;

    // Everything moved aside lands in the central backup store (History
    // dialog) — FiveM.app stays clean.
    let backups_dir = super::backups::backups_root(app_paths);

    // 1. Mods
    if link.mods {
        status("Linking mods...");
        link_folder(
            &client_path.join("mods"),
            &five_m_path.join("mods"),
            &backups_dir,
            false,
        )?;
    }

    // 2. Plugins
    if link.plugins {
        let client_plugins = client_path.join("plugins");
        let game_plugins = five_m_path.join("plugins");

        match link.plugins_mode.unwrap_or(PluginsMode::Sync) {
            PluginsMode::Junction => {
                status("Linking plugins...");
                link_folder(&client_plugins, &game_plugins, &backups_dir, false)?;
                write_plugins_owner_marker(&client_plugins, client_id, "junction");
                status("Note: Plugins are linked (junction). ReShade may open the client plugins folder.");
            }
            PluginsMode::Sync => {
                std::fs::create_dir_all(&client_plugins).map_err(|e| e.to_string())?;
                prepare_game_plugins_dir_for_sync_mode(
                    &game_plugins,
                    client_id,
                    &backups_dir,
                    status,
                )?;
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

    // ReShade: sync config/preset files that live outside the plugins folder
    // (next to FiveM.exe, GTA dir, AppData). Junction mode runs no background
    // processes, so discovery is skipped entirely (v1 behavior).
    if !is_junction_plugins_mode {
        let pairs = reshade::run_reshade_discovery(&five_m_exe, &five_m_path, &client_path, status);
        outcome.file_sync_pairs.extend(pairs);
    }

    // 3. Citizen — links even when the client folder is sparse, same as v1
    // (user-provided citizen files replace the game's; that's on the user).
    if link.citizen {
        status("Linking citizen...");
        link_folder(
            &client_path.join("citizen"),
            &five_m_path.join("citizen"),
            &backups_dir,
            false,
        )?;
    }

    // 4. GTA settings — FiveM reads from BOTH CitizenFX AppData AND FiveM.app.
    if link.gta_settings {
        let targets = (deps.gta_targets)(game_path_override.as_deref());
        let external = (deps.gta_repair_sources)(game_path_override.as_deref());
        let external_refs: Vec<&gta_settings::GtaSettingsDocument> = external.iter().collect();
        let plan = gta_settings::apply_gta_settings(
            &client_path,
            targets,
            &backups_dir,
            &external_refs,
            status,
        )?;
        // Enforcement only when we're allowed background processes.
        if !is_junction_plugins_mode {
            outcome.gta_enforcement = Some(plan);
        }
    }

    // 5. CitizenFX.ini — seed the real INI from the client (client is the
    // intentional source of truth), keep both in sync while the game runs.
    if link.citizen_fx_ini {
        let client_ini = client_path.join("settings").join("CitizenFX.ini");
        ensure_file_exists(&client_ini, "");
        match (deps.citizen_fx_ini)() {
            None => log::warn!("CitizenFX.ini target not found (APPDATA missing?)"),
            Some(target_ini) => {
                status("Syncing CitizenFX.ini...");
                ensure_file_exists(&target_ini, "");
                copy_file_best_effort(&client_ini, &target_ini);
                if !is_junction_plugins_mode {
                    outcome.file_sync_pairs.push(SyncPair {
                        a: client_ini,
                        b: target_ini,
                    });
                }
            }
        }
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
        let client = store.create_client("Test".into(), None).unwrap();

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

    /// Test deps that never resolve real user paths.
    macro_rules! test_deps {
        ($spawned:ident) => {{
            LaunchDeps {
                is_game_running: &|| false,
                spawn: &|exe: &Path| -> io::Result<()> {
                    $spawned.borrow_mut().push(exe.to_path_buf());
                    Ok(())
                },
                gta_targets: &|_| Vec::new(),
                gta_repair_sources: &|_| Vec::new(),
                citizen_fx_ini: &|| None,
            }
        }};
    }

    #[test]
    fn happy_path_junction_links_and_spawns() {
        let h = setup();
        let spawned = RefCell::new(Vec::<PathBuf>::new());
        let statuses = RefCell::new(Vec::<String>::new());
        let deps = test_deps!(spawned);

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
        assert!(
            outcome.file_sync_pairs.is_empty(),
            "junction mode must not schedule background file sync"
        );
        assert_eq!(spawned.borrow().len(), 1);
        assert!(spawned.borrow()[0].ends_with("FiveM.exe"));

        // mods junction in place; original moved to the CENTRAL store, and
        // no `_original` sibling dirtying FiveM.app.
        let fivem_app = h.dir.path().join("FiveM").join("FiveM.app");
        assert!(fs::symlink_metadata(fivem_app.join("mods"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!fivem_app.join("mods_original").exists());
        let store = crate::core::backups::backups_root(&h.app_paths);
        let backups = crate::core::backups::list_backups(&store);
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].kind, "mods");
        assert!(std::path::PathBuf::from(&backups[0].path)
            .join("stock.rpf")
            .exists());

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
        let deps = test_deps!(spawned);

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
    fn phase4_gta_settings_and_citizenfx_ini() {
        let h = setup();
        let spawned = RefCell::new(Vec::<PathBuf>::new());

        // Fake "real" targets inside the temp dir.
        let roaming_xml = h.dir.path().join("roaming").join("gta5_settings.xml");
        let app_xml = h.dir.path().join("FiveM").join("FiveM.app").join("settings.xml");
        let real_ini = h.dir.path().join("roaming").join("CitizenFX.ini");
        fs::create_dir_all(roaming_xml.parent().unwrap()).unwrap();

        let targets = vec![roaming_xml.clone(), app_xml.clone()];
        let ini = real_ini.clone();
        let deps = LaunchDeps {
            is_game_running: &|| false,
            spawn: &|exe: &Path| -> io::Result<()> {
                spawned.borrow_mut().push(exe.to_path_buf());
                Ok(())
            },
            gta_targets: &move |_| targets.clone(),
            gta_repair_sources: &|_| Vec::new(),
            citizen_fx_ini: &move || Some(ini.clone()),
        };

        // Client ini has content that must win over the real one.
        let client_dir = h.app_paths.clients_data().join(&h.client_id);
        fs::write(
            client_dir.join("settings").join("CitizenFX.ini"),
            "[Game]\nclient=1\n",
        )
        .unwrap();
        fs::write(&real_ini, "[Game]\nstale=1\n").unwrap();

        let mut link = link_all(PluginsMode::Sync);
        link.gta_settings = true;
        link.citizen_fx_ini = true;

        let outcome = launch_client(
            &h.app_paths,
            &h.client_id,
            &link,
            &mut HashMap::new(),
            &deps,
            &mut |_| {},
        )
        .unwrap();

        // GTA settings applied to both targets (template fallback content).
        let applied = fs::read_to_string(&roaming_xml).unwrap();
        assert!(applied.contains("<Settings"));
        assert_eq!(fs::read_to_string(&app_xml).unwrap(), applied);

        // Enforcement plan returned (sync mode allows background work).
        let plan = outcome.gta_enforcement.expect("enforcement plan expected");
        assert_eq!(plan.targets, vec![roaming_xml, app_xml]);

        // CitizenFX.ini seeded client -> real.
        assert_eq!(fs::read_to_string(&real_ini).unwrap(), "[Game]\nclient=1\n");

        // The ini pair is scheduled for runtime sync.
        assert!(outcome
            .file_sync_pairs
            .iter()
            .any(|p| p.b == real_ini && p.a.ends_with("CitizenFX.ini")));
    }

    #[test]
    fn junction_mode_applies_settings_but_skips_background_work() {
        let h = setup();
        let spawned = RefCell::new(Vec::<PathBuf>::new());

        let roaming_xml = h.dir.path().join("roaming").join("gta5_settings.xml");
        let targets = vec![roaming_xml.clone()];
        let real_ini = h.dir.path().join("roaming").join("CitizenFX.ini");
        let ini = real_ini.clone();

        let deps = LaunchDeps {
            is_game_running: &|| false,
            spawn: &|exe: &Path| -> io::Result<()> {
                spawned.borrow_mut().push(exe.to_path_buf());
                Ok(())
            },
            gta_targets: &move |_| targets.clone(),
            gta_repair_sources: &|_| Vec::new(),
            citizen_fx_ini: &move || Some(ini.clone()),
        };

        let mut link = link_all(PluginsMode::Junction);
        link.gta_settings = true;
        link.citizen_fx_ini = true;

        let outcome = launch_client(
            &h.app_paths,
            &h.client_id,
            &link,
            &mut HashMap::new(),
            &deps,
            &mut |_| {},
        )
        .unwrap();

        // Settings still applied once...
        assert!(fs::read_to_string(&roaming_xml).unwrap().contains("<Settings"));
        assert!(real_ini.exists());
        // ...but no background enforcement or sync in junction mode.
        assert!(outcome.gta_enforcement.is_none());
        assert!(outcome.file_sync_pairs.is_empty());
        assert!(outcome.runtime_sync.is_none());
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
            gta_targets: &|_| Vec::new(),
            gta_repair_sources: &|_| Vec::new(),
            citizen_fx_ini: &|| None,
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
            gta_targets: &|_| Vec::new(),
            gta_repair_sources: &|_| Vec::new(),
            citizen_fx_ini: &|| None,
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

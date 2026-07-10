//! Snapshot ("My Setup") — the baseline client that live FiveM state returns
//! to after every session.
//!
//! Capture adopts the user's current live files into a brand-new client:
//! real folders are MOVED in (fast rename, no duplication) and the live
//! location becomes a junction pointing back at the snapshot, so from that
//! moment on "editing FiveM.app/mods" edits the snapshot client. Settings
//! files (gta5_settings.xml, CitizenFX.ini) are copied in.
//!
//! Restore re-points the live folders at the snapshot and copies the settings
//! files back out. It deliberately creates NO backups for junction targets —
//! the pre-restore content is client data that already lives in the client's
//! own folder, so steady-state sessions produce zero backup churn.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::backups;
use super::clients::{ClientProfile, ClientStore, LinkOptions, PluginsMode};
use super::fs_retry::rename_with_retry;
use super::gta_settings::looks_like_gta_settings_xml;
use super::linking::link_folder;
use super::mirror::copy_file_best_effort;
use super::paths::{self, AppPaths};
use super::plugins_sync::write_plugins_owner_marker;
use super::settings;

pub const DEFAULT_SNAPSHOT_NAME: &str = "My Setup";
pub const SNAPSHOT_ICON: &str = "shield";
const SNAPSHOT_FOLDERS: [&str; 3] = ["mods", "plugins", "citizen"];

/// Copy the children of `dir` into `dest`. Reads THROUGH a junction at `dir`
/// without draining its target (used when the live folder is already mounted
/// on another client — capture must not steal that client's files).
fn copy_children(dir: &Path, dest: &Path) -> io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        backups::copy_recursive(&entry.path(), &dest.join(entry.file_name()))?;
    }
    Ok(())
}

/// Overwrite `target` with `source`, clearing read-only and creating parent
/// directories. Best-effort — restore never aborts over a single stubborn file.
fn restore_file(source: &Path, target: &Path) {
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(meta) = fs::metadata(target) {
        let mut perms = meta.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        let _ = fs::set_permissions(target, perms);
    }
    copy_file_best_effort(source, target);
}

/// The snapshot's settings XML, if it has a real one (never the template —
/// a user who had no settings file gets none restored either).
fn snapshot_settings_xml(client_path: &Path) -> Option<PathBuf> {
    let dir = client_path.join("settings");
    ["gta5_settings.xml", "settings.xml"]
        .into_iter()
        .map(|name| dir.join(name))
        .find(|p| looks_like_gta_settings_xml(p))
}

/// Create the snapshot client from the current live FiveM state.
///
/// `settings_sources` are the candidate live settings.xml locations in
/// priority order (production: `gta_settings_targets`); `real_ini` is the
/// live CitizenFX.ini (production: `paths::citizen_fx_ini_path()`). Injected
/// so tests never touch real user files.
pub fn capture_snapshot_client(
    app_paths: &AppPaths,
    game_path_override: Option<&str>,
    name: &str,
    settings_sources: &[PathBuf],
    real_ini: Option<&Path>,
) -> Result<ClientProfile, String> {
    let five_m = paths::five_m_path(game_path_override)
        .ok_or("FiveM installation not found. Set the FiveM.app path in settings first.")?;

    let store = ClientStore::new(app_paths)?;
    let client = store.create_client(name.to_string(), Some(SNAPSHOT_ICON.to_string()))?;
    let client_path = app_paths.clients_data().join(&client.id);
    let backups_dir = backups::backups_root(app_paths);

    for folder in SNAPSHOT_FOLDERS {
        let game_dir = five_m.join(folder);
        let client_dir = client_path.join(folder);

        match fs::symlink_metadata(&game_dir) {
            Err(_) => {} // nothing live; the junction below mounts an empty folder
            Ok(meta) if meta.file_type().is_symlink() => {
                // Already a junction: the mounted content belongs to another
                // client. Copy through it — moving would drain that client.
                copy_children(&game_dir, &client_dir)
                    .map_err(|e| format!("Could not copy live {folder} into snapshot: {e}"))?;
            }
            Ok(meta) if meta.is_dir() => {
                // Real folder: adopt it wholesale. The scaffolded client dir is
                // empty; clear it so the rename can land. If the rename fails
                // (cross-volume, locks) fall back to copying — link_folder then
                // moves the original into the backup store, so nothing is lost.
                let _ = fs::remove_dir(&client_dir);
                if client_dir.exists() || rename_with_retry(&game_dir, &client_dir).is_err() {
                    copy_children(&game_dir, &client_dir)
                        .map_err(|e| format!("Could not copy live {folder} into snapshot: {e}"))?;
                }
            }
            Ok(_) => {} // a stray FILE at the folder path; link_folder backs it up
        }

        link_folder(&client_dir, &game_dir, &backups_dir, false)?;
    }
    write_plugins_owner_marker(&client_path.join("plugins"), &client.id, "junction");

    // Adopt the first real-looking live settings XML as the baseline.
    if let Some(live_xml) = settings_sources
        .iter()
        .find(|p| looks_like_gta_settings_xml(p))
    {
        let _ = fs::copy(live_xml, client_path.join("settings").join("gta5_settings.xml"));
    }

    if let Some(ini) = real_ini {
        if ini.is_file() {
            let _ = fs::copy(ini, client_path.join("settings").join("CitizenFX.ini"));
        }
    }

    // The snapshot links everything; junction plugins keeps its own launches
    // free of background sync (the live folders already point at it anyway).
    store.update_link_options(
        &client.id,
        LinkOptions {
            mods: true,
            plugins: true,
            plugins_mode: Some(PluginsMode::Junction),
            citizen: true,
            gta_settings: true,
            citizen_fx_ini: true,
        },
    )?;
    settings::set_snapshot_client_id(&app_paths.settings_file(), Some(client.id.clone()))?;

    store.get_client(&client.id).ok_or("Snapshot client vanished after creation.".into())
}

/// Point the live FiveM state back at the snapshot client.
///
/// `settings_targets` / `real_ini` mirror the capture parameters (production:
/// `gta_settings_targets` / `citizen_fx_ini_path`).
pub fn restore_baseline(
    app_paths: &AppPaths,
    snapshot_id: &str,
    game_path_override: Option<&str>,
    settings_targets: &[PathBuf],
    real_ini: Option<&Path>,
    status: &mut dyn FnMut(&str),
) -> Result<(), String> {
    let five_m = paths::five_m_path(game_path_override).ok_or("FiveM installation not found.")?;
    let client_path = app_paths.clients_data().join(snapshot_id);
    if !client_path.exists() {
        return Err("Snapshot client data not found.".into());
    }
    let backups_dir = backups::backups_root(app_paths);

    status("Restoring your setup...");
    for folder in SNAPSHOT_FOLDERS {
        link_folder(&client_path.join(folder), &five_m.join(folder), &backups_dir, false)?;
    }
    write_plugins_owner_marker(&client_path.join("plugins"), snapshot_id, "junction");

    if let Some(snap_xml) = snapshot_settings_xml(&client_path) {
        for target in settings_targets {
            restore_file(&snap_xml, target);
        }
    }

    // v1 treats an empty CitizenFX.ini as absent — don't blank the real one.
    let snap_ini = client_path.join("settings").join("CitizenFX.ini");
    if fs::metadata(&snap_ini).map(|m| m.is_file() && m.len() > 0).unwrap_or(false) {
        if let Some(ini) = real_ini {
            restore_file(&snap_ini, ini);
        }
    }

    status("Your setup is restored.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::backups::list_backups;

    const REAL_XML: &str = "<?xml version=\"1.0\"?>\n<Settings>\n  <video w=\"2560\"/>\n</Settings>\n";

    struct Harness {
        _dir: tempfile::TempDir,
        app_paths: AppPaths,
        five_m: PathBuf,
        override_str: String,
    }

    fn setup() -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let app_paths = AppPaths::from_app_data(dir.path().join("appdata"));
        let five_m = dir.path().join("FiveM").join("FiveM.app");
        fs::create_dir_all(&five_m).unwrap();
        let override_str = five_m.to_string_lossy().to_string();
        Harness { _dir: dir, app_paths, five_m, override_str }
    }

    #[test]
    fn capture_moves_real_folders_and_junctions_back() {
        let h = setup();
        fs::create_dir_all(h.five_m.join("mods").join("sub")).unwrap();
        fs::write(h.five_m.join("mods").join("a.rpf"), b"mod-a").unwrap();
        fs::write(h.five_m.join("mods").join("sub").join("b.rpf"), b"mod-b").unwrap();
        let live_xml = h.five_m.join("settings.xml");
        fs::write(&live_xml, REAL_XML).unwrap();
        let live_ini = h.five_m.join("CitizenFX.ini");
        fs::write(&live_ini, "[Game]\nmine=1\n").unwrap();

        let client = capture_snapshot_client(
            &h.app_paths,
            Some(&h.override_str),
            DEFAULT_SNAPSHOT_NAME,
            &[live_xml],
            Some(&live_ini),
        )
        .unwrap();

        // Content moved into the snapshot client.
        let snap = h.app_paths.clients_data().join(&client.id);
        assert_eq!(fs::read(snap.join("mods").join("a.rpf")).unwrap(), b"mod-a");
        assert_eq!(fs::read(snap.join("mods").join("sub").join("b.rpf")).unwrap(), b"mod-b");

        // Live folders are junctions at the snapshot — a write through the
        // live path lands in the client.
        for folder in ["mods", "plugins", "citizen"] {
            assert!(
                fs::symlink_metadata(h.five_m.join(folder)).unwrap().file_type().is_symlink(),
                "{folder} must be a junction"
            );
        }
        fs::write(h.five_m.join("mods").join("new.rpf"), b"live write").unwrap();
        assert!(snap.join("mods").join("new.rpf").exists());

        // Settings adopted; link options all-on with junction plugins; id saved.
        assert_eq!(
            fs::read_to_string(snap.join("settings").join("gta5_settings.xml")).unwrap(),
            REAL_XML
        );
        assert_eq!(
            fs::read_to_string(snap.join("settings").join("CitizenFX.ini")).unwrap(),
            "[Game]\nmine=1\n"
        );
        assert!(client.link_options.mods && client.link_options.citizen);
        assert_eq!(client.link_options.plugins_mode, Some(PluginsMode::Junction));
        assert!(client.link_options.gta_settings && client.link_options.citizen_fx_ini);
        let loaded = settings::load(&h.app_paths.settings_file());
        assert_eq!(loaded.snapshot_client_id.as_deref(), Some(client.id.as_str()));

        // Moves, not copies: no backup entries for adopted real folders.
        assert!(list_backups(&backups::backups_root(&h.app_paths)).is_empty());
    }

    #[test]
    fn capture_copies_through_existing_junction_without_draining_it() {
        let h = setup();

        // Another client's plugins are mounted at the live location.
        let store = ClientStore::new(&h.app_paths).unwrap();
        let other = store.create_client("Other".into(), None).unwrap();
        let other_plugins = h.app_paths.clients_data().join(&other.id).join("plugins");
        fs::write(other_plugins.join("ReShade.ini"), b"[GENERAL]").unwrap();
        junction::create(&other_plugins, h.five_m.join("plugins")).unwrap();

        let client = capture_snapshot_client(
            &h.app_paths,
            Some(&h.override_str),
            DEFAULT_SNAPSHOT_NAME,
            &[],
            None,
        )
        .unwrap();

        // The other client keeps its file; the snapshot got a copy.
        assert!(other_plugins.join("ReShade.ini").exists(), "must not drain the mounted client");
        let snap_plugins = h.app_paths.clients_data().join(&client.id).join("plugins");
        assert_eq!(fs::read(snap_plugins.join("ReShade.ini")).unwrap(), b"[GENERAL]");

        // The live junction now points at the snapshot.
        fs::write(h.five_m.join("plugins").join("probe.txt"), b"x").unwrap();
        assert!(snap_plugins.join("probe.txt").exists());
        assert!(!other_plugins.join("probe.txt").exists());
    }

    #[test]
    fn restore_relinks_settings_and_creates_no_backups() {
        let h = setup();

        // Snapshot client with content + settings.
        let store = ClientStore::new(&h.app_paths).unwrap();
        let snap = store.create_client("My Setup".into(), None).unwrap();
        let snap_path = h.app_paths.clients_data().join(&snap.id);
        fs::write(snap_path.join("mods").join("base.rpf"), b"baseline").unwrap();
        fs::write(snap_path.join("settings").join("gta5_settings.xml"), REAL_XML).unwrap();
        fs::write(snap_path.join("settings").join("CitizenFX.ini"), "[Game]\nbase=1\n").unwrap();

        // Live state: folders junctioned at some other client (post-session),
        // settings files holding that client's values.
        let other = store.create_client("Other".into(), None).unwrap();
        let other_path = h.app_paths.clients_data().join(&other.id);
        for folder in ["mods", "plugins", "citizen"] {
            junction::create(other_path.join(folder), h.five_m.join(folder)).unwrap();
        }
        let target_xml = h.five_m.join("settings.xml");
        fs::write(&target_xml, "<Settings>other client</Settings>").unwrap();
        let real_ini = h.five_m.join("CitizenFX.ini");
        fs::write(&real_ini, "[Game]\nother=1\n").unwrap();

        let mut statuses = Vec::new();
        restore_baseline(
            &h.app_paths,
            &snap.id,
            Some(&h.override_str),
            std::slice::from_ref(&target_xml),
            Some(&real_ini),
            &mut |s| statuses.push(s.to_string()),
        )
        .unwrap();

        // Live folders now mount the snapshot.
        assert!(h.five_m.join("mods").join("base.rpf").exists());
        fs::write(h.five_m.join("mods").join("probe.rpf"), b"x").unwrap();
        assert!(snap_path.join("mods").join("probe.rpf").exists());
        assert!(!other_path.join("mods").join("probe.rpf").exists());

        // Settings copied back to baseline.
        assert_eq!(fs::read_to_string(&target_xml).unwrap(), REAL_XML);
        assert_eq!(fs::read_to_string(&real_ini).unwrap(), "[Game]\nbase=1\n");

        // Swapping junctions must not spam the backup store.
        assert!(list_backups(&backups::backups_root(&h.app_paths)).is_empty());
        assert_eq!(statuses.last().map(String::as_str), Some("Your setup is restored."));
    }

    #[test]
    fn restore_skips_settings_when_snapshot_has_none() {
        let h = setup();
        let store = ClientStore::new(&h.app_paths).unwrap();
        let snap = store.create_client("My Setup".into(), None).unwrap();
        // Scaffolded settings.xml is an empty placeholder — must NOT be
        // treated as a real settings file, and must never write the template.

        let target_xml = h.five_m.join("settings.xml");
        fs::write(&target_xml, "<Settings>in-game tweaks</Settings>").unwrap();
        let real_ini = h.five_m.join("CitizenFX.ini");
        fs::write(&real_ini, "[Game]\nkeep=1\n").unwrap();

        restore_baseline(
            &h.app_paths,
            &snap.id,
            Some(&h.override_str),
            std::slice::from_ref(&target_xml),
            Some(&real_ini),
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(&target_xml).unwrap(),
            "<Settings>in-game tweaks</Settings>",
            "no snapshot settings -> live settings untouched"
        );
        // The scaffolded empty ini must not blank the real one either.
        assert_eq!(fs::read_to_string(&real_ini).unwrap(), "[Game]\nkeep=1\n");
    }

    #[test]
    fn restore_errors_on_missing_snapshot_folder() {
        let h = setup();
        let err = restore_baseline(
            &h.app_paths,
            "gone",
            Some(&h.override_str),
            &[],
            None,
            &mut |_| {},
        )
        .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }
}

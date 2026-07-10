use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::paths::AppPaths;
use super::stats::{folder_stats, ClientStats};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginsMode {
    Junction,
    Sync,
}

/// Per-client linking preferences. Serialized shape must match v1 `LinkOptions`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LinkOptions {
    pub mods: bool,
    pub plugins: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugins_mode: Option<PluginsMode>,
    pub citizen: bool,
    pub gta_settings: bool,
    pub citizen_fx_ini: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClientProfile {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Icon key from the frontend client icon set. Optional and skipped when
    /// absent so existing clients.json files round-trip byte-identically.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// FiveM pure-mode level to launch with (1 or 2). None/absent = off.
    /// Skipped when absent to keep clients.json byte-identical.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pure_mode: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
    pub link_options: LinkOptions,
}

/// What to carry over when duplicating a client. Folder flags copy the
/// matching subfolder; `config` copies linking options and pure mode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DuplicateOptions {
    pub mods: bool,
    pub plugins: bool,
    pub citizen: bool,
    pub settings: bool,
    pub config: bool,
}

/// Top-level `clients.json`. Note: v1 always writes `selectedClientId`,
/// including an explicit `null` — so no skip_serializing_if here.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClientConfig {
    pub clients: Vec<ClientProfile>,
    pub selected_client_id: Option<String>,
}

pub struct ClientStore {
    config_path: PathBuf,
    data_path: PathBuf,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl ClientStore {
    pub fn new(paths: &AppPaths) -> Result<Self, String> {
        let store = Self {
            config_path: paths.client_config(),
            data_path: paths.clients_data(),
        };
        store.ensure_initialized().map_err(|e| e.to_string())?;
        Ok(store)
    }

    fn ensure_initialized(&self) -> io::Result<()> {
        if !self.data_path.exists() {
            fs::create_dir_all(&self.data_path)?;
        }
        if !self.config_path.exists() {
            self.save_config(&ClientConfig::default())?;
        }
        Ok(())
    }

    /// v1 behavior: any read/parse error yields an empty config.
    fn get_config(&self) -> ClientConfig {
        let Ok(data) = fs::read_to_string(&self.config_path) else {
            return ClientConfig::default();
        };
        serde_json::from_str(&data).unwrap_or_default()
    }

    fn save_config(&self, config: &ClientConfig) -> io::Result<()> {
        let json = serde_json::to_string_pretty(config)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&self.config_path, json)
    }

    pub fn get_clients(&self) -> Vec<ClientProfile> {
        self.get_config().clients
    }

    pub fn get_client(&self, id: &str) -> Option<ClientProfile> {
        self.get_config().clients.into_iter().find(|c| c.id == id)
    }

    /// The client that was most recently launched (persisted across restarts).
    pub fn get_selected_client_id(&self) -> Option<String> {
        self.get_config().selected_client_id
    }

    /// Record a launch: bump the client's `last_played` timestamp and remember
    /// it as the selected client so the UI can reselect it on next start.
    /// No-ops on an unknown id (v1-style tolerance).
    pub fn mark_launched(&self, id: &str) -> Result<(), String> {
        let mut config = self.get_config();
        let Some(client) = config.clients.iter_mut().find(|c| c.id == id) else {
            return Ok(());
        };
        client.last_played = Some(now_ms());
        config.selected_client_id = Some(id.to_string());
        self.save_config(&config).map_err(|e| e.to_string())
    }

    /// Returns the client's data folder only if it exists (v1 behavior).
    pub fn client_folder_path(&self, id: &str) -> Option<PathBuf> {
        let path = self.data_path.join(id);
        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    /// Folder scaffolding, identical to v1 (including the legacy empty
    /// settings.xml placeholder — the GTA settings code treats it as absent).
    fn scaffold_client_dirs(&self, id: &str) -> Result<(), String> {
        let client_path = self.data_path.join(id);
        let settings_path = client_path.join("settings");
        for dir in ["mods", "plugins", "citizen"] {
            fs::create_dir_all(client_path.join(dir)).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&settings_path).map_err(|e| e.to_string())?;
        for file in ["settings.xml", "CitizenFX.ini"] {
            let p = settings_path.join(file);
            if !p.exists() {
                fs::write(&p, "").map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn create_client(&self, name: String, icon: Option<String>) -> Result<ClientProfile, String> {
        let mut config = self.get_config();
        let id = uuid::Uuid::new_v4().to_string();

        let new_client = ClientProfile {
            id: id.clone(),
            name,
            description: None,
            icon,
            pure_mode: None,
            last_played: Some(now_ms()),
            link_options: LinkOptions {
                mods: true,
                plugins: true,
                plugins_mode: Some(PluginsMode::Sync),
                citizen: false,
                gta_settings: false,
                citizen_fx_ini: false,
            },
        };

        self.scaffold_client_dirs(&id)?;

        config.clients.push(new_client.clone());
        self.save_config(&config).map_err(|e| e.to_string())?;
        Ok(new_client)
    }

    /// Create a new client as a copy of `source_id`, carrying over only the
    /// folders/config selected in `options`.
    pub fn duplicate_client(
        &self,
        source_id: &str,
        name: String,
        options: DuplicateOptions,
    ) -> Result<ClientProfile, String> {
        let mut config = self.get_config();
        let source = config
            .clients
            .iter()
            .find(|c| c.id == source_id)
            .cloned()
            .ok_or("Client not found.")?;

        let id = uuid::Uuid::new_v4().to_string();
        let new_client = ClientProfile {
            id: id.clone(),
            name,
            description: source.description.clone(),
            icon: source.icon.clone(),
            pure_mode: if options.config { source.pure_mode } else { None },
            last_played: Some(now_ms()),
            link_options: if options.config {
                source.link_options.clone()
            } else {
                LinkOptions {
                    mods: true,
                    plugins: true,
                    plugins_mode: Some(PluginsMode::Sync),
                    citizen: false,
                    gta_settings: false,
                    citizen_fx_ini: false,
                }
            },
        };

        self.scaffold_client_dirs(&id)?;

        let source_path = self.data_path.join(source_id);
        let dest_path = self.data_path.join(&id);
        let folders: [(&str, bool); 4] = [
            ("mods", options.mods),
            ("plugins", options.plugins),
            ("citizen", options.citizen),
            ("settings", options.settings),
        ];
        for (folder, wanted) in folders {
            if !wanted {
                continue;
            }
            let from = source_path.join(folder);
            if from.is_dir() {
                super::backups::copy_recursive(&from, &dest_path.join(folder))
                    .map_err(|e| e.to_string())?;
            }
        }

        config.clients.push(new_client.clone());
        self.save_config(&config).map_err(|e| e.to_string())?;
        Ok(new_client)
    }

    pub fn delete_client(&self, id: &str) -> Result<(), String> {
        let mut config = self.get_config();
        config.clients.retain(|c| c.id != id);
        if config.selected_client_id.as_deref() == Some(id) {
            config.selected_client_id = None;
        }

        let client_path = self.data_path.join(id);
        if client_path.exists() {
            fs::remove_dir_all(&client_path).map_err(|e| e.to_string())?;
        }

        self.save_config(&config).map_err(|e| e.to_string())
    }

    pub fn rename_client(&self, id: &str, name: String) -> Result<(), String> {
        let mut config = self.get_config();
        let Some(client) = config.clients.iter_mut().find(|c| c.id == id) else {
            return Ok(()); // v1 silently no-ops on unknown id
        };
        client.name = name;
        self.save_config(&config).map_err(|e| e.to_string())
    }

    pub fn set_icon(&self, id: &str, icon: Option<String>) -> Result<(), String> {
        let mut config = self.get_config();
        let Some(client) = config.clients.iter_mut().find(|c| c.id == id) else {
            return Ok(());
        };
        client.icon = icon;
        self.save_config(&config).map_err(|e| e.to_string())
    }

    pub fn set_pure_mode(&self, id: &str, pure_mode: Option<u8>) -> Result<(), String> {
        let mut config = self.get_config();
        let Some(client) = config.clients.iter_mut().find(|c| c.id == id) else {
            return Ok(());
        };
        // Only 1 and 2 are valid pure levels; anything else clears it.
        client.pure_mode = pure_mode.filter(|n| (1..=2).contains(n));
        self.save_config(&config).map_err(|e| e.to_string())
    }

    pub fn update_link_options(&self, id: &str, link_options: LinkOptions) -> Result<(), String> {
        let mut config = self.get_config();
        let Some(client) = config.clients.iter_mut().find(|c| c.id == id) else {
            return Ok(());
        };
        client.link_options = link_options;
        self.save_config(&config).map_err(|e| e.to_string())
    }

    pub fn client_stats(&self, id: &str) -> ClientStats {
        match self.client_folder_path(id) {
            Some(path) => folder_stats(&path),
            None => ClientStats::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden fixture in the exact shape v1 ClientManager writes.
    const V1_CLIENTS_JSON: &str = r#"{
  "clients": [
    {
      "id": "0b5e9f6e-8f4a-4c8e-9d3b-2a1f0c9d8e7f",
      "name": "Main RP",
      "lastPlayed": 1719849600000,
      "linkOptions": {
        "mods": true,
        "plugins": true,
        "pluginsMode": "sync",
        "citizen": false,
        "gtaSettings": false,
        "citizenFxIni": false
      }
    },
    {
      "id": "1c6fa07f-9a5b-4d9f-8e4c-3b201dae9f80",
      "name": "Junction client",
      "description": "test",
      "linkOptions": {
        "mods": false,
        "plugins": true,
        "pluginsMode": "junction",
        "citizen": true,
        "gtaSettings": true,
        "citizenFxIni": true
      }
    }
  ],
  "selectedClientId": null
}"#;

    fn store_in(dir: &std::path::Path) -> ClientStore {
        let paths = AppPaths::from_app_data(dir);
        ClientStore::new(&paths).unwrap()
    }

    #[test]
    fn parses_v1_clients_file() {
        let config: ClientConfig = serde_json::from_str(V1_CLIENTS_JSON).unwrap();
        assert_eq!(config.clients.len(), 2);
        assert_eq!(config.selected_client_id, None);

        let first = &config.clients[0];
        assert_eq!(first.name, "Main RP");
        assert_eq!(first.last_played, Some(1_719_849_600_000));
        assert_eq!(first.link_options.plugins_mode, Some(PluginsMode::Sync));
        assert!(first.description.is_none());

        let second = &config.clients[1];
        assert_eq!(second.link_options.plugins_mode, Some(PluginsMode::Junction));
        assert!(second.link_options.citizen_fx_ini);
        assert_eq!(second.last_played, None);
    }

    #[test]
    fn round_trip_is_byte_identical_to_v1() {
        let config: ClientConfig = serde_json::from_str(V1_CLIENTS_JSON).unwrap();
        let out = serde_json::to_string_pretty(&config).unwrap();
        assert_eq!(out, V1_CLIENTS_JSON);
    }

    #[test]
    fn create_client_scaffolds_v1_folder_structure() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

        let client = store.create_client("Test".into(), None).unwrap();
        assert!(uuid::Uuid::parse_str(&client.id).is_ok());
        assert_eq!(client.link_options.plugins_mode, Some(PluginsMode::Sync));
        assert!(client.link_options.mods && client.link_options.plugins);
        assert!(client.last_played.is_some());

        let base = dir.path().join("clients").join(&client.id);
        for sub in ["mods", "plugins", "citizen", "settings"] {
            assert!(base.join(sub).is_dir(), "missing {sub}");
        }
        assert!(base.join("settings").join("settings.xml").is_file());
        assert!(base.join("settings").join("CitizenFX.ini").is_file());

        assert_eq!(store.get_clients().len(), 1);
    }

    #[test]
    fn delete_removes_folder_and_selection() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let client = store.create_client("Doomed".into(), None).unwrap();

        let base = dir.path().join("clients").join(&client.id);
        assert!(base.exists());

        store.delete_client(&client.id).unwrap();
        assert!(!base.exists());
        assert!(store.get_clients().is_empty());
    }

    #[test]
    fn rename_and_update_links_persist() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let client = store.create_client("Old".into(), None).unwrap();

        store.rename_client(&client.id, "New".into()).unwrap();
        assert_eq!(store.get_client(&client.id).unwrap().name, "New");

        let mut opts = client.link_options.clone();
        opts.plugins_mode = Some(PluginsMode::Junction);
        opts.citizen = true;
        store.update_link_options(&client.id, opts).unwrap();

        let updated = store.get_client(&client.id).unwrap();
        assert_eq!(updated.link_options.plugins_mode, Some(PluginsMode::Junction));
        assert!(updated.link_options.citizen);
    }

    #[test]
    fn duplicate_copies_selected_folders_and_config() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let source = store
            .create_client("Source".into(), Some("car".into()))
            .unwrap();

        let base = dir.path().join("clients").join(&source.id);
        fs::write(base.join("mods").join("a.rpf"), b"mod").unwrap();
        fs::write(base.join("plugins").join("p.asi"), b"plugin").unwrap();
        fs::write(base.join("settings").join("settings.xml"), b"<x/>").unwrap();
        let mut opts = source.link_options.clone();
        opts.plugins_mode = Some(PluginsMode::Junction);
        store.update_link_options(&source.id, opts).unwrap();
        store.set_pure_mode(&source.id, Some(2)).unwrap();

        let copy = store
            .duplicate_client(
                &source.id,
                "Copy".into(),
                DuplicateOptions {
                    mods: true,
                    plugins: false,
                    citizen: false,
                    settings: true,
                    config: true,
                },
            )
            .unwrap();

        assert_ne!(copy.id, source.id);
        assert_eq!(copy.name, "Copy");
        assert_eq!(copy.icon.as_deref(), Some("car"));
        assert_eq!(copy.pure_mode, Some(2));
        assert_eq!(copy.link_options.plugins_mode, Some(PluginsMode::Junction));

        let copy_base = dir.path().join("clients").join(&copy.id);
        assert!(copy_base.join("mods").join("a.rpf").is_file());
        assert!(!copy_base.join("plugins").join("p.asi").exists());
        assert_eq!(
            fs::read(copy_base.join("settings").join("settings.xml")).unwrap(),
            b"<x/>"
        );
        assert_eq!(store.get_clients().len(), 2);
    }

    #[test]
    fn duplicate_without_config_uses_create_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let source = store.create_client("Source".into(), None).unwrap();
        let mut opts = source.link_options.clone();
        opts.citizen = true;
        store.update_link_options(&source.id, opts).unwrap();
        store.set_pure_mode(&source.id, Some(1)).unwrap();

        let copy = store
            .duplicate_client(&source.id, "Copy".into(), DuplicateOptions::default())
            .unwrap();

        assert_eq!(copy.pure_mode, None);
        assert!(!copy.link_options.citizen);
        assert_eq!(copy.link_options.plugins_mode, Some(PluginsMode::Sync));

        // Nothing selected — the copy still gets the full empty scaffold.
        let copy_base = dir.path().join("clients").join(&copy.id);
        for sub in ["mods", "plugins", "citizen", "settings"] {
            assert!(copy_base.join(sub).is_dir(), "missing {sub}");
        }
    }

    #[test]
    fn duplicate_unknown_source_errors() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        assert!(store
            .duplicate_client("nope", "Copy".into(), DuplicateOptions::default())
            .is_err());
    }

    #[test]
    fn mark_launched_bumps_last_played_and_selection() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let a = store.create_client("A".into(), None).unwrap();
        let b = store.create_client("B".into(), None).unwrap();
        assert_eq!(store.get_selected_client_id(), None);

        // Force an older timestamp so the launch bump is observable.
        {
            let mut config = store.get_config();
            config.clients.iter_mut().for_each(|c| c.last_played = Some(1_000));
            store.save_config(&config).unwrap();
        }

        store.mark_launched(&b.id).unwrap();
        assert_eq!(store.get_selected_client_id().as_deref(), Some(b.id.as_str()));
        assert!(store.get_client(&b.id).unwrap().last_played.unwrap() > 1_000);
        // The other client is untouched.
        assert_eq!(store.get_client(&a.id).unwrap().last_played, Some(1_000));

        // Unknown id is a tolerated no-op that keeps the prior selection.
        store.mark_launched("nope").unwrap();
        assert_eq!(store.get_selected_client_id().as_deref(), Some(b.id.as_str()));
    }

    #[test]
    fn deleting_selected_client_clears_selection() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let c = store.create_client("C".into(), None).unwrap();
        store.mark_launched(&c.id).unwrap();
        assert_eq!(store.get_selected_client_id().as_deref(), Some(c.id.as_str()));

        store.delete_client(&c.id).unwrap();
        assert_eq!(store.get_selected_client_id(), None);
    }

    #[test]
    fn corrupt_config_yields_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        fs::write(dir.path().join("clients.json"), "definitely { not json").unwrap();
        assert!(store.get_clients().is_empty());
    }

    #[test]
    fn stats_count_real_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let client = store.create_client("Stats".into(), None).unwrap();

        let mods = dir
            .path()
            .join("clients")
            .join(&client.id)
            .join("mods");
        fs::write(mods.join("x.rpf"), vec![1u8; 128]).unwrap();

        let stats = store.client_stats(&client.id);
        // 128-byte mod + two empty placeholder settings files.
        assert_eq!(stats.total_bytes, 128);
        assert_eq!(stats.file_count, 3);
    }

    #[test]
    fn icon_persists_and_is_omitted_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

        let with_icon = store
            .create_client("Iconic".into(), Some("gamepad".into()))
            .unwrap();
        assert_eq!(with_icon.icon.as_deref(), Some("gamepad"));

        let without = store.create_client("Plain".into(), None).unwrap();
        assert!(without.icon.is_none());

        // Set + clear the icon on the plain client.
        store.set_icon(&without.id, Some("car".into())).unwrap();
        assert_eq!(
            store.get_client(&without.id).unwrap().icon.as_deref(),
            Some("car")
        );
        store.set_icon(&without.id, None).unwrap();
        assert!(store.get_client(&without.id).unwrap().icon.is_none());

        // Pure mode: set a valid level, an invalid one clears it.
        store.set_pure_mode(&without.id, Some(1)).unwrap();
        assert_eq!(store.get_client(&without.id).unwrap().pure_mode, Some(1));
        store.set_pure_mode(&without.id, Some(9)).unwrap();
        assert_eq!(store.get_client(&without.id).unwrap().pure_mode, None);

        // A client with neither an icon nor pure_mode must serialize neither
        // key (byte-compat with v1 clients.json).
        let json = serde_json::to_string(&store.get_client(&without.id).unwrap()).unwrap();
        assert!(!json.contains("icon"), "unexpected icon key: {json}");
        assert!(!json.contains("pureMode"), "unexpected pureMode key: {json}");
    }
}

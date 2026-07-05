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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
    pub link_options: LinkOptions,
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

    /// Returns the client's data folder only if it exists (v1 behavior).
    pub fn client_folder_path(&self, id: &str) -> Option<PathBuf> {
        let path = self.data_path.join(id);
        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    pub fn create_client(&self, name: String) -> Result<ClientProfile, String> {
        let mut config = self.get_config();
        let id = uuid::Uuid::new_v4().to_string();

        let new_client = ClientProfile {
            id: id.clone(),
            name,
            description: None,
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

        // Folder scaffolding, identical to v1 (including the legacy empty
        // settings.xml placeholder — the GTA settings code treats it as absent).
        let client_path = self.data_path.join(&id);
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

        let client = store.create_client("Test".into()).unwrap();
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
        let client = store.create_client("Doomed".into()).unwrap();

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
        let client = store.create_client("Old".into()).unwrap();

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
        let client = store.create_client("Stats".into()).unwrap();

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
}

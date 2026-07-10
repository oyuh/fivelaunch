use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// App settings stored in `settings.json`.
///
/// Field names and normalization rules mirror v1 `SettingsManager` exactly:
/// - `gamePath` present only when set
/// - `minimizeToTrayOnGameLaunch` always written as a boolean
/// - `themePrimaryHex` present only when it is a valid `#rrggbb` (lowercased)
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_path: Option<String>,
    pub minimize_to_tray_on_game_launch: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_primary_hex: Option<String>,
    /// The snapshot ("My Setup") client that live FiveM state returns to
    /// after each session. Absent until the user creates one, so pre-snapshot
    /// settings.json files round-trip unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_client_id: Option<String>,
}

/// v1 `isHexColor`: trimmed `#` + exactly 6 hex digits.
pub fn is_hex_color(value: &str) -> bool {
    let v = value.trim();
    let Some(rest) = v.strip_prefix('#') else {
        return false;
    };
    rest.len() == 6 && rest.chars().all(|c| c.is_ascii_hexdigit())
}

fn normalize(mut settings: AppSettings) -> AppSettings {
    settings.theme_primary_hex = settings
        .theme_primary_hex
        .filter(|hex| is_hex_color(hex))
        .map(|hex| hex.trim().to_lowercase());
    settings
}

/// Read + normalize settings; any error yields normalized defaults (v1 behavior).
pub fn load(path: &Path) -> AppSettings {
    let Ok(data) = fs::read_to_string(path) else {
        return AppSettings::default();
    };
    match serde_json::from_str::<AppSettings>(&data) {
        Ok(parsed) => normalize(parsed),
        Err(_) => AppSettings::default(),
    }
}

/// Write normalized settings as pretty JSON (2-space indent, like v1).
pub fn save(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let normalized = normalize(settings.clone());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Create the file with defaults if missing (v1 `ensureInitialized`).
pub fn ensure_initialized(path: &Path) -> Result<(), String> {
    if !path.exists() {
        save(path, &AppSettings::default())?;
    }
    Ok(())
}

pub fn set_game_path(path: &Path, game_path: String) -> Result<(), String> {
    let mut settings = load(path);
    settings.game_path = Some(game_path);
    save(path, &settings)
}

pub fn set_minimize_to_tray_on_game_launch(path: &Path, enabled: bool) -> Result<(), String> {
    let mut settings = load(path);
    settings.minimize_to_tray_on_game_launch = enabled;
    save(path, &settings)
}

pub fn set_snapshot_client_id(path: &Path, id: Option<String>) -> Result<(), String> {
    let mut settings = load(path);
    settings.snapshot_client_id = id;
    save(path, &settings)
}

/// v1 semantics: `None`/empty clears the value; an invalid hex is silently
/// ignored (previous value kept); a valid hex is stored lowercased.
pub fn set_theme_primary_hex(path: &Path, hex: Option<String>) -> Result<(), String> {
    let mut settings = load(path);

    match hex {
        None => settings.theme_primary_hex = None,
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                settings.theme_primary_hex = None;
            } else if is_hex_color(&trimmed) {
                settings.theme_primary_hex = Some(trimmed.to_lowercase());
            } else {
                // Invalid: keep existing value, still persist (v1 returns early
                // without saving; saving unchanged data is equivalent on disk).
                return Ok(());
            }
        }
    }

    save(path, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden fixture produced by v1 SettingsManager.
    const V1_SETTINGS_JSON: &str = r##"{
  "gamePath": "C:\\Users\\Lawson\\AppData\\Local\\FiveM\\FiveM.app",
  "minimizeToTrayOnGameLaunch": true,
  "themePrimaryHex": "#f59e0b"
}"##;

    #[test]
    fn parses_v1_settings_file() {
        let parsed: AppSettings = serde_json::from_str(V1_SETTINGS_JSON).unwrap();
        assert_eq!(
            parsed.game_path.as_deref(),
            Some(r"C:\Users\Lawson\AppData\Local\FiveM\FiveM.app")
        );
        assert!(parsed.minimize_to_tray_on_game_launch);
        assert_eq!(parsed.theme_primary_hex.as_deref(), Some("#f59e0b"));
    }

    #[test]
    fn round_trip_preserves_v1_shape() {
        let parsed: AppSettings = serde_json::from_str(V1_SETTINGS_JSON).unwrap();
        let out = serde_json::to_string_pretty(&parsed).unwrap();
        assert_eq!(out, V1_SETTINGS_JSON);
    }

    #[test]
    fn parses_minimal_v1_file() {
        // v1 initial file: normalize({}) => only the boolean is written.
        let parsed: AppSettings =
            serde_json::from_str(r#"{ "minimizeToTrayOnGameLaunch": false }"#).unwrap();
        assert_eq!(parsed, AppSettings::default());
    }

    #[test]
    fn hex_validation_matches_v1() {
        assert!(is_hex_color("#f59e0b"));
        assert!(is_hex_color("  #F59E0B  "));
        assert!(!is_hex_color("#f59"));
        assert!(!is_hex_color("f59e0b"));
        assert!(!is_hex_color("#f59e0g"));
        assert!(!is_hex_color("#f59e0b0"));
    }

    #[test]
    fn normalize_drops_invalid_hex_and_lowercases() {
        let s = normalize(AppSettings {
            theme_primary_hex: Some("#ABCDEF".into()),
            ..Default::default()
        });
        assert_eq!(s.theme_primary_hex.as_deref(), Some("#abcdef"));

        let s = normalize(AppSettings {
            theme_primary_hex: Some("not-a-color".into()),
            ..Default::default()
        });
        assert_eq!(s.theme_primary_hex, None);
    }

    #[test]
    fn setters_persist_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");

        ensure_initialized(&file).unwrap();
        set_game_path(&file, r"D:\FiveM\FiveM.app".into()).unwrap();
        set_minimize_to_tray_on_game_launch(&file, true).unwrap();
        set_theme_primary_hex(&file, Some("#FF00AA".into())).unwrap();

        let loaded = load(&file);
        assert_eq!(loaded.game_path.as_deref(), Some(r"D:\FiveM\FiveM.app"));
        assert!(loaded.minimize_to_tray_on_game_launch);
        assert_eq!(loaded.theme_primary_hex.as_deref(), Some("#ff00aa"));

        // Invalid hex is ignored, value kept.
        set_theme_primary_hex(&file, Some("nope".into())).unwrap();
        assert_eq!(load(&file).theme_primary_hex.as_deref(), Some("#ff00aa"));

        // Empty clears.
        set_theme_primary_hex(&file, Some("".into())).unwrap();
        assert_eq!(load(&file).theme_primary_hex, None);
    }

    #[test]
    fn corrupt_file_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(&file, "{ this is not json").unwrap();
        assert_eq!(load(&file), AppSettings::default());
    }
}

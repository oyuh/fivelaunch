use std::path::{Path, PathBuf};

/// Root paths for FiveLaunch's own data.
///
/// v1 (Electron) stored everything under `%APPDATA%\FiveLaunch` (userData).
/// We resolve the exact same directory so v2 is a drop-in upgrade.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub app_data: PathBuf,
}

impl AppPaths {
    pub fn resolve() -> Result<Self, String> {
        let roaming = std::env::var_os("APPDATA").ok_or("APPDATA environment variable not set")?;
        Ok(Self {
            app_data: PathBuf::from(roaming).join("FiveLaunch"),
        })
    }

    pub fn from_app_data(app_data: impl Into<PathBuf>) -> Self {
        Self {
            app_data: app_data.into(),
        }
    }

    /// `%APPDATA%\FiveLaunch\clients`
    pub fn clients_data(&self) -> PathBuf {
        self.app_data.join("clients")
    }

    /// `%APPDATA%\FiveLaunch\clients.json`
    pub fn client_config(&self) -> PathBuf {
        self.app_data.join("clients.json")
    }

    /// `%APPDATA%\FiveLaunch\settings.json`
    pub fn settings_file(&self) -> PathBuf {
        self.app_data.join("settings.json")
    }
}

/// Resolve the FiveM.app folder: explicit settings override first, then the
/// standard `%LOCALAPPDATA%\FiveM\FiveM.app` install location.
pub fn five_m_path(game_path_override: Option<&str>) -> Option<PathBuf> {
    if let Some(gp) = game_path_override {
        let p = PathBuf::from(gp);
        if p.exists() {
            return Some(p);
        }
    }

    let local = std::env::var_os("LOCALAPPDATA")?;
    let standard = PathBuf::from(local).join("FiveM").join("FiveM.app");
    if standard.exists() {
        Some(standard)
    } else {
        None
    }
}

/// FiveM.exe lives next to (one level above) FiveM.app.
pub fn five_m_executable(game_path_override: Option<&str>) -> Option<PathBuf> {
    let app = five_m_path(game_path_override)?;
    let exe = app.parent()?.join("FiveM.exe");
    if exe.exists() {
        Some(exe)
    } else {
        None
    }
}

/// `%APPDATA%\CitizenFX`
pub fn citizen_fx_dir() -> Option<PathBuf> {
    let roaming = std::env::var_os("APPDATA")?;
    Some(PathBuf::from(roaming).join("CitizenFX"))
}

/// `%APPDATA%\CitizenFX\CitizenFX.ini`
pub fn citizen_fx_ini_path() -> Option<PathBuf> {
    Some(citizen_fx_dir()?.join("CitizenFX.ini"))
}

/// Primary gta5_settings.xml location (CitizenFX Roaming).
pub fn gta_settings_path() -> Option<PathBuf> {
    Some(citizen_fx_dir()?.join("gta5_settings.xml"))
}

/// All locations FiveM/GTA may read settings XML from, in priority order.
///
/// The **authoritative** source is `Documents\Rockstar Games\GTA V\settings.xml`
/// — the file GTA V itself writes and the only one guaranteed to carry the full
/// graphics config *and* `<VideoCardDescription>` (the detected GPU name). GTA
/// compares that GPU name against the hardware it finds at boot; if it is
/// missing or doesn't match, the game throws the graphics settings away and
/// re-runs auto-detection. So this file (and its OneDrive-redirected twin) is
/// checked BEFORE the CitizenFX/FiveM copies, which are often sparser or stale.
pub fn gta_settings_candidates(game_path_override: Option<&str>) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Authoritative: the real GTA V settings the game writes (with the GPU).
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        candidates.push(
            PathBuf::from(profile)
                .join("Documents")
                .join("Rockstar Games")
                .join("GTA V")
                .join("settings.xml"),
        );
    }

    if let Some(onedrive) = std::env::var_os("OneDrive") {
        candidates.push(
            PathBuf::from(onedrive)
                .join("Documents")
                .join("Rockstar Games")
                .join("GTA V")
                .join("settings.xml"),
        );
    }

    // FiveM / CitizenFX copies (fallbacks if the real file isn't present).
    if let Some(roaming) = std::env::var_os("APPDATA") {
        candidates.push(
            PathBuf::from(roaming)
                .join("CitizenFX")
                .join("gta5_settings.xml"),
        );
    }

    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        candidates.push(local.join("CitizenFX").join("gta5_settings.xml"));
        candidates.push(
            local
                .join("FiveM")
                .join("FiveM.app")
                .join("settings.xml"),
        );
    }

    // A configured FiveM.app can also carry its own settings.xml.
    if let Some(app) = five_m_path(game_path_override) {
        candidates.push(app.join("settings.xml"));
    }

    candidates.dedup();
    candidates
}

/// True if `path` exists and is a directory (helper shared by commands).
pub fn existing_dir(path: &Path) -> Option<PathBuf> {
    if path.is_dir() {
        Some(path.to_path_buf())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_paths_layout_matches_v1() {
        let paths = AppPaths::from_app_data(r"C:\Users\test\AppData\Roaming\FiveLaunch");
        assert!(paths.client_config().ends_with("FiveLaunch\\clients.json"));
        assert!(paths.settings_file().ends_with("FiveLaunch\\settings.json"));
        assert!(paths.clients_data().ends_with("FiveLaunch\\clients"));
    }

    #[test]
    fn five_m_path_prefers_existing_override() {
        let dir = tempfile::tempdir().unwrap();
        let override_path = dir.path().to_string_lossy().to_string();
        let resolved = five_m_path(Some(&override_path)).unwrap();
        assert_eq!(resolved, dir.path());
    }

    #[test]
    fn five_m_path_ignores_missing_override() {
        // A nonexistent override must fall through to the standard location
        // (which may or may not exist on the test machine — either way it
        // must not return the bogus override).
        let resolved = five_m_path(Some(r"C:\definitely\not\a\real\path\FiveM.app"));
        if let Some(p) = resolved {
            assert!(p.exists());
            assert!(!p.ends_with(r"not\a\real\path\FiveM.app"));
        }
    }
}

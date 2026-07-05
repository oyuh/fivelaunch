//! Desktop shortcut creation — port of v1 `create-client-shortcut`.
//!
//! Creates `FiveM - <client name>.lnk` on the Desktop pointing at the
//! launcher exe with `--launch-client=<id>`; the single-instance handler and
//! startup argv parsing turn that into an auto-launch.

use std::path::{Path, PathBuf};

use super::args::sanitize_windows_file_name;

pub fn create_client_shortcut(
    exe: &Path,
    desktop_dir: &Path,
    client_id: &str,
    client_name: &str,
) -> Result<PathBuf, String> {
    let file_name = sanitize_windows_file_name(&format!("FiveM - {client_name}.lnk"));
    let shortcut_path = desktop_dir.join(file_name);

    let mut link = mslnk::ShellLink::new(exe).map_err(|e| format!("Failed to create shortcut: {e}"))?;
    link.set_arguments(Some(format!("--launch-client={client_id}")));
    link.set_name(Some(format!("Launch {client_name}")));
    // The exe carries the app icon.
    link.set_icon_location(Some(exe.to_string_lossy().to_string()));

    link.create_lnk(&shortcut_path)
        .map_err(|e| format!("Failed to create shortcut: {e}"))?;

    Ok(shortcut_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_lnk_with_sanitized_name() {
        let dir = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap();

        let path = create_client_shortcut(&exe, dir.path(), "abc-123", "Main / RP?").unwrap();

        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "FiveM - Main - RP-.lnk"
        );
        let meta = std::fs::metadata(&path).unwrap();
        assert!(meta.len() > 0, "lnk file must not be empty");
    }
}

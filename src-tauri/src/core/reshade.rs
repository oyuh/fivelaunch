//! ReShade config/preset discovery + sync planning — port of v1
//! `reshadeSync.ts` (+ `reshadeLogging.ts`).
//!
//! ReShade installs vary wildly (files next to the exe, inside plugins,
//! per-exe INI names, presets anywhere). This module discovers the likely
//! config/preset/log files with the same heuristics as v1, seeds client-owned
//! shadow copies under `settings/reshade/sources/<fnv1a32>/`, and returns the
//! file pairs for the runtime sync loop.
//!
//! v2 trims (documented in PERF.md): v1's 15s live INI snapshot interval and
//! per-file change monitors were diagnostics-only and are not ported. The
//! `diagnostics.log` + `last-scan.json` support artifacts are kept.

use indexmap::IndexSet;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use super::file_sync::{seed_pair, SyncPair};
use super::hash::fnv1a32_hex;
use super::paths;

// ---------------------------------------------------------------------------
// Diagnostics logging (per-client, v1 format)
// ---------------------------------------------------------------------------

pub fn reshade_client_dir(client_path: &Path) -> PathBuf {
    client_path.join("settings").join("reshade")
}

/// Append a `[ReShade] <timestamp> message` line to the per-client
/// diagnostics.log (best-effort), mirroring v1 `reshadeLog`.
pub fn reshade_log(reshade_dir: &Path, message: &str) {
    let _ = fs::create_dir_all(reshade_dir);
    let ts = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let line = format!("[ReShade] {ts} {message}\n");
    log::info!("{}", line.trim_end());

    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(reshade_dir.join("diagnostics.log"))
    {
        let _ = f.write_all(line.as_bytes());
    }
}

// ---------------------------------------------------------------------------
// INI helpers
// ---------------------------------------------------------------------------

/// Lowercase key -> unquoted value map (v1 `parseIniKeyValues`).
pub fn parse_ini_key_values(ini_text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in ini_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            continue;
        }
        let Some(eq) = trimmed.find('=') else { continue };
        if eq == 0 {
            continue;
        }
        let key = trimmed[..eq].trim().to_lowercase();
        let value = trimmed[eq + 1..].trim().trim_matches('"').to_string();
        if !key.is_empty() {
            out.insert(key, value);
        }
    }
    out
}

/// v1 `looksLikeReShadeConfigIni`: cheap content heuristic for per-exe
/// config names (reads at most 32KB).
pub fn looks_like_reshade_config_ini(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() < 16 {
        return false;
    }

    let Ok(mut f) = fs::File::open(path) else {
        return false;
    };
    let mut buf = vec![0u8; 32_768.min(meta.len() as usize)];
    let Ok(n) = f.read(&mut buf) else {
        return false;
    };
    let head = String::from_utf8_lossy(&buf[..n]).to_lowercase();

    if !head.contains("presetpath")
        && !head.contains("currentpresetpath")
        && !head.contains("performancemode")
        && !head.contains("[general]")
    {
        return false;
    }
    head.contains("reshade") || head.contains("presetpath") || head.contains("performancemode")
}

/// `PresetPath` / `CurrentPresetPath` values from a ReShade config INI.
pub fn parse_reshade_ini_preset_paths(ini_text: &str) -> Vec<String> {
    let mut results = IndexSet::new();
    for line in ini_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        let Some(eq) = trimmed.find('=') else { continue };
        if eq == 0 {
            continue;
        }
        let key = trimmed[..eq].trim().to_lowercase();
        let value = trimmed[eq + 1..].trim().trim_matches('"');
        if value.is_empty() {
            continue;
        }
        if key == "presetpath" || key == "currentpresetpath" {
            results.insert(value.to_string());
        }
    }
    results.into_iter().collect()
}

/// v1 `resolveMaybeRelativePath`: absolute as-is; otherwise try relative to
/// the INI's dir first, then the exe base dir.
pub fn resolve_maybe_relative_path(base_dir: &Path, ini_dir: &Path, value: &str) -> PathBuf {
    let normalized = value.replace('/', "\\");
    let p = PathBuf::from(&normalized);
    if p.is_absolute() {
        return p;
    }
    let from_ini = ini_dir.join(&normalized);
    if from_ini.exists() {
        return from_ini;
    }
    base_dir.join(&normalized)
}

/// Best-effort extraction of `X:\...\file.ini|.log` paths from log text
/// (v1 regex `[A-Za-z]:\\[^\r\n"']+?\.(?:ini|log)`, non-greedy).
pub fn extract_windows_file_paths(text: &str) -> Vec<String> {
    const TRAILERS: &[char] = &[']', ')', '}', '>', ',', ';'];
    let bytes: Vec<char> = text.chars().collect();
    let mut results = IndexSet::new();

    let mut i = 0;
    while i + 2 < bytes.len() {
        // Match "X:\"
        if bytes[i].is_ascii_alphabetic() && bytes[i + 1] == ':' && bytes[i + 2] == '\\' {
            let mut j = i + 3;
            let mut end: Option<usize> = None;
            while j < bytes.len() {
                let c = bytes[j];
                if c == '\r' || c == '\n' || c == '"' || c == '\'' {
                    break;
                }
                j += 1;
                // Non-greedy: stop at the FIRST .ini / .log suffix.
                if j >= i + 7 {
                    let tail: String = bytes[j - 4..j].iter().collect();
                    if tail == ".ini" || tail == ".log" {
                        end = Some(j);
                        break;
                    }
                }
            }
            if let Some(end) = end {
                let matched: String = bytes[i..end].iter().collect();
                let cleaned = matched.trim().trim_end_matches(TRAILERS).to_string();
                results.insert(cleaned);
                i = end;
                continue;
            }
        }
        i += 1;
    }

    results.into_iter().collect()
}

/// Files named `name_lower` up to ~3 directory levels deep (v1 depth limit).
pub fn find_files_by_name(root: &Path, name_lower: &str, ) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !e.path_is_symlink())
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .to_lowercase()
                == name_lower
        })
        .map(|e| e.into_path())
        .collect()
}

/// All `.ini` files up to ~3 directory levels deep.
pub fn find_ini_files(root: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !e.path_is_symlink())
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .to_lowercase()
                .ends_with(".ini")
        })
        .map(|e| e.into_path())
        .collect()
}

fn read_file_tail(path: &Path, max_bytes: u64) -> String {
    let Ok(meta) = fs::metadata(path) else {
        return String::new();
    };
    if !meta.is_file() || meta.len() == 0 {
        return String::new();
    }
    let Ok(mut f) = fs::File::open(path) else {
        return String::new();
    };
    let start = meta.len().saturating_sub(max_bytes);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).to_string()
}

/// GTA V install dir candidates (CitizenFX.ini hints + common locations).
pub fn gta_install_dir_candidates(citizen_fx_ini: Option<&Path>) -> Vec<PathBuf> {
    let mut results = IndexSet::new();

    if let Some(ini) = citizen_fx_ini {
        if let Ok(text) = fs::read_to_string(ini) {
            for value in parse_ini_key_values(&text).values() {
                if value.is_empty() {
                    continue;
                }
                let normalized = value.replace('/', "\\");
                let maybe_exe = if normalized.to_lowercase().ends_with("gta5.exe") {
                    PathBuf::from(&normalized)
                } else {
                    PathBuf::from(&normalized).join("GTA5.exe")
                };
                if maybe_exe.exists() {
                    if let Some(dir) = maybe_exe.parent() {
                        results.insert(dir.to_path_buf());
                    }
                }
            }
        }
    }

    let mut common: Vec<PathBuf> = Vec::new();
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        let pf = PathBuf::from(pf);
        common.push(pf.join("Rockstar Games").join("Grand Theft Auto V"));
        common.push(pf.join("Epic Games").join("GTAV"));
    }
    if let Some(pfx86) = std::env::var_os("ProgramFiles(x86)") {
        common.push(
            PathBuf::from(pfx86)
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Grand Theft Auto V"),
        );
    }
    common.push(PathBuf::from(r"C:\Games\Grand Theft Auto V"));
    common.push(PathBuf::from(r"C:\Games\GTAV"));
    common.push(PathBuf::from(r"D:\Games\Grand Theft Auto V"));
    common.push(PathBuf::from(r"D:\Games\GTAV"));

    for dir in common {
        if dir.join("GTA5.exe").exists() {
            results.insert(dir);
        }
    }

    results.into_iter().collect()
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct LastScan {
    at: String,
    #[serde(rename = "fiveMExe")]
    five_m_exe: String,
    #[serde(rename = "fiveMPath")]
    five_m_path: String,
    #[serde(rename = "pluginsDir")]
    plugins_dir: String,
    #[serde(rename = "gtaDirs")]
    gta_dirs: Vec<String>,
    configs: Vec<String>,
    #[serde(rename = "presetInis")]
    preset_inis: Vec<String>,
    logs: Vec<String>,
}

fn shadow_id_for(path: &Path) -> String {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    fnv1a32_hex(&absolute.to_string_lossy().to_lowercase())
}

fn is_under(path: &Path, dir: &Path) -> bool {
    let p = path.to_string_lossy().to_lowercase();
    let d = format!("{}\\", dir.to_string_lossy().to_lowercase());
    p.starts_with(&d)
}

/// Discover ReShade config/preset/log files and seed shadow-copy sync pairs.
///
/// Returns the (client_shadow, real_file) pairs the runtime loop must keep in
/// sync. Files that live inside `FiveM.app/plugins` are excluded — the plugins
/// sync/junction already covers them.
pub fn run_reshade_discovery(
    five_m_exe: &Path,
    five_m_path: &Path,
    client_path: &Path,
    status: &mut dyn FnMut(&str),
) -> Vec<SyncPair> {
    let base_dir = five_m_exe.parent().unwrap_or(five_m_path).to_path_buf();
    let reshade_dir = reshade_client_dir(client_path);
    let plugins_dir = five_m_path.join("plugins");
    let _ = fs::create_dir_all(&reshade_dir);

    reshade_log(
        &reshade_dir,
        &format!(
            "Scan start: baseDir={}; fiveMPath={}; pluginsDir={}",
            base_dir.display(),
            five_m_path.display(),
            plugins_dir.display()
        ),
    );

    let gta_dirs = gta_install_dir_candidates(paths::citizen_fx_ini_path().as_deref());

    let mut roots: Vec<PathBuf> = vec![base_dir.clone(), five_m_path.to_path_buf(), plugins_dir.clone()];
    roots.extend(gta_dirs.iter().cloned());
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("ReShade"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("ReShade"));
    }

    let mut configs: IndexSet<PathBuf> = IndexSet::new();
    let mut preset_inis: IndexSet<PathBuf> = IndexSet::new();
    let mut logs: IndexSet<PathBuf> = IndexSet::new();

    for dir in &roots {
        for direct in [
            ("ReShade.ini", &mut configs),
            ("ReShadePreset.ini", &mut preset_inis),
            ("ReShade.log", &mut logs),
        ] {
            let p = dir.join(direct.0);
            if p.exists() {
                direct.1.insert(p);
            }
        }

        for found in find_files_by_name(dir, "reshade.ini") {
            configs.insert(found);
        }
        for found in find_files_by_name(dir, "reshadepreset.ini") {
            preset_inis.insert(found);
        }
        for found in find_files_by_name(dir, "reshade.log") {
            logs.insert(found);
        }

        // Per-exe config names: any INI that smells like a ReShade config.
        for ini in find_ini_files(dir) {
            let lower = ini.to_string_lossy().to_lowercase();
            if lower.ends_with("reshade.ini") || lower.ends_with("reshadepreset.ini") {
                continue;
            }
            if looks_like_reshade_config_ini(&ini) {
                configs.insert(ini);
            }
        }
    }

    // Use log tails to find the paths ReShade actually loaded.
    for log_path in logs.clone() {
        let tail = read_file_tail(&log_path, 96 * 1024);
        if tail.is_empty() {
            continue;
        }
        let extracted = extract_windows_file_paths(&tail);
        if extracted.is_empty() {
            continue;
        }
        reshade_log(
            &reshade_dir,
            &format!(
                "Log hints from {}: {}",
                log_path.display(),
                extracted
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" | ")
            ),
        );
        for hint in extracted {
            let p = PathBuf::from(&hint);
            if !p.exists() {
                continue;
            }
            let lower = hint.to_lowercase();
            if lower.ends_with("reshadepreset.ini") {
                preset_inis.insert(p);
            } else if lower.ends_with("reshade.ini") {
                configs.insert(p);
            } else if lower.ends_with(".ini") && looks_like_reshade_config_ini(&p) {
                configs.insert(p);
            }
        }
    }

    status(&format!("ReShade: found {} config file(s)", configs.len()));
    status(&format!("ReShade: found {} preset-ini file(s)", preset_inis.len()));
    if !logs.is_empty() {
        status(&format!("ReShade: found {} log file(s)", logs.len()));
    }

    // Support artifact: what did we detect this launch?
    let scan = LastScan {
        at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        five_m_exe: five_m_exe.display().to_string(),
        five_m_path: five_m_path.display().to_string(),
        plugins_dir: plugins_dir.display().to_string(),
        gta_dirs: gta_dirs.iter().map(|p| p.display().to_string()).collect(),
        configs: configs.iter().map(|p| p.display().to_string()).collect(),
        preset_inis: preset_inis.iter().map(|p| p.display().to_string()).collect(),
        logs: logs.iter().map(|p| p.display().to_string()).collect(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&scan) {
        let _ = fs::write(reshade_dir.join("last-scan.json"), json);
    }

    // Build + seed sync pairs. Plugins-dir files are handled by plugins sync.
    let mut pairs: Vec<SyncPair> = Vec::new();
    let mut add_pair = |shadow: PathBuf, real: &Path, reshade_dir: &Path| {
        seed_pair(&shadow, real);
        reshade_log(
            reshade_dir,
            &format!("Sync pair: client={} <-> real={}", shadow.display(), real.display()),
        );
        pairs.push(SyncPair {
            a: shadow,
            b: real.to_path_buf(),
        });
    };

    for ini_path in configs.iter().chain(preset_inis.iter()) {
        if is_under(ini_path, &plugins_dir) {
            reshade_log(
                &reshade_dir,
                &format!("Using plugins-linked file (no extra sync): {}", ini_path.display()),
            );
            continue;
        }
        let id = shadow_id_for(ini_path);
        let file_name = ini_path.file_name().unwrap_or_default();
        let shadow = reshade_dir.join("sources").join(&id).join(file_name);
        add_pair(shadow, ini_path, &reshade_dir);
    }

    // Follow the active preset from the most authoritative config.
    let config_for_presets = {
        let plugins_config = plugins_dir.join("ReShade.ini");
        if plugins_config.exists() {
            Some(plugins_config)
        } else {
            configs.first().cloned()
        }
    };

    if let Some(config_path) = config_for_presets {
        let ini_text = fs::read_to_string(&config_path).unwrap_or_default();
        let ini_dir = config_path.parent().unwrap_or(&base_dir).to_path_buf();
        let preset_values = parse_reshade_ini_preset_paths(&ini_text);
        if !preset_values.is_empty() {
            reshade_log(
                &reshade_dir,
                &format!(
                    "Preset discovery: from={} -> {}",
                    config_path.display(),
                    preset_values.join(" | ")
                ),
            );
        }

        for value in preset_values {
            let preset_abs = resolve_maybe_relative_path(&base_dir, &ini_dir, &value);
            reshade_log(
                &reshade_dir,
                &format!(
                    "Preset resolved: value={value} -> abs={} exists={}",
                    preset_abs.display(),
                    if preset_abs.exists() { "yes" } else { "no" }
                ),
            );
            if !preset_abs.exists() || is_under(&preset_abs, &plugins_dir) {
                continue;
            }
            let id = shadow_id_for(&preset_abs);
            let file_name = preset_abs.file_name().unwrap_or_default().to_os_string();
            let shadow = reshade_dir
                .join("sources")
                .join(&id)
                .join("presets")
                .join(file_name);
            add_pair(shadow, &preset_abs, &reshade_dir);
        }
    } else {
        reshade_log(
            &reshade_dir,
            "Preset discovery: no readable config path found to parse PresetPath.",
        );
    }

    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_windows_paths_from_log_text() {
        let text = "Loading config from \"C:\\Games\\GTAV\\ReShade.ini\" ...\r\n\
                    preset at D:\\Presets\\My Preset.ini, log: C:\\Games\\GTAV\\ReShade.log];\n\
                    no path here";
        let found = extract_windows_file_paths(text);
        assert!(found.contains(&r"C:\Games\GTAV\ReShade.ini".to_string()), "{found:?}");
        assert!(found.contains(&r"D:\Presets\My Preset.ini".to_string()), "{found:?}");
        assert!(found.contains(&r"C:\Games\GTAV\ReShade.log".to_string()), "{found:?}");
        assert_eq!(found.len(), 3);
    }

    #[test]
    fn ini_key_values_and_preset_paths() {
        let ini = "[GENERAL]\r\nPresetPath=.\\Presets\\Cine.ini\r\n; comment\r\nPerformanceMode=1\r\nCurrentPresetPath=\"C:\\R\\Other.ini\"\r\n";
        let kv = parse_ini_key_values(ini);
        assert_eq!(kv["presetpath"], ".\\Presets\\Cine.ini");
        assert_eq!(kv["performancemode"], "1");

        let presets = parse_reshade_ini_preset_paths(ini);
        assert_eq!(presets, vec![".\\Presets\\Cine.ini".to_string(), "C:\\R\\Other.ini".to_string()]);
    }

    #[test]
    fn config_heuristic_accepts_reshade_rejects_random() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("dxgi.ini");
        fs::write(&good, "[GENERAL]\nEffectSearchPaths=.\\\nPresetPath=.\\p.ini\n").unwrap();
        assert!(looks_like_reshade_config_ini(&good));

        let bad = dir.path().join("random.ini");
        fs::write(&bad, "[Display]\nWidth=1920\nHeight=1080\nFullscreen=1\n").unwrap();
        assert!(!looks_like_reshade_config_ini(&bad));
    }

    #[test]
    fn resolves_relative_preset_paths_ini_dir_first() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("base");
        let ini_dir = dir.path().join("ini");
        fs::create_dir_all(ini_dir.join("Presets")).unwrap();
        fs::create_dir_all(&base).unwrap();
        fs::write(ini_dir.join("Presets").join("x.ini"), "Techniques=Clarity").unwrap();

        let resolved = resolve_maybe_relative_path(&base, &ini_dir, "./Presets/x.ini");
        assert_eq!(resolved, ini_dir.join("Presets").join("x.ini"));

        // Missing relative -> falls back to base dir join.
        let fallback = resolve_maybe_relative_path(&base, &ini_dir, "nope\\y.ini");
        assert_eq!(fallback, base.join("nope").join("y.ini"));
    }

    #[test]
    fn discovery_finds_configs_seeds_shadows_and_skips_plugins() {
        let dir = tempfile::tempdir().unwrap();

        // Fake FiveM: FiveM.exe next to FiveM.app; ReShade.ini beside the exe.
        let fivem_base = dir.path().join("FiveM");
        let fivem_app = fivem_base.join("FiveM.app");
        let plugins = fivem_app.join("plugins");
        fs::create_dir_all(&plugins).unwrap();
        let exe = fivem_base.join("FiveM.exe");
        fs::write(&exe, "exe").unwrap();

        let config = fivem_base.join("ReShade.ini");
        fs::write(
            &config,
            "[GENERAL]\nPresetPath=.\\MyPreset.ini\nPerformanceMode=0\nreshade stuff\n",
        )
        .unwrap();
        // The active preset lives next to the exe too.
        fs::write(fivem_base.join("MyPreset.ini"), "Techniques=Clarity@Clarity.fx").unwrap();
        // A plugins-dir config must be excluded from extra sync.
        fs::write(plugins.join("ReShade.ini"), "[GENERAL]\nPresetPath=.\\p.ini\nreshade\n").unwrap();

        let client = dir.path().join("client");
        let mut statuses = Vec::new();
        let pairs = run_reshade_discovery(&exe, &fivem_app, &client, &mut |s| {
            statuses.push(s.to_string())
        });

        // Base-dir config gets a shadow pair; plugins config does not.
        let reshade_dir = reshade_client_dir(&client);
        assert!(pairs.iter().any(|p| p.b == config), "config pair missing: {pairs:?}");
        assert!(
            !pairs.iter().any(|p| p.b.starts_with(&plugins)),
            "plugins files must not get extra sync pairs"
        );

        // Shadow was seeded from the real file (real existed, shadow didn't).
        let config_pair = pairs.iter().find(|p| p.b == config).unwrap();
        assert!(config_pair.a.starts_with(reshade_dir.join("sources")));
        assert_eq!(
            fs::read_to_string(&config_pair.a).unwrap(),
            fs::read_to_string(&config).unwrap()
        );

        // Preset discovery followed the plugins config first (it exists), so
        // presets from base config are not required — but the base preset is
        // still reachable when plugins config is absent. Re-run without it:
        fs::remove_file(plugins.join("ReShade.ini")).unwrap();
        let client2 = dir.path().join("client2");
        let pairs2 = run_reshade_discovery(&exe, &fivem_app, &client2, &mut |_| {});
        let preset_real = fivem_base.join("MyPreset.ini");
        assert!(
            pairs2.iter().any(|p| p.b == preset_real),
            "active preset must get a sync pair: {pairs2:?}"
        );

        // Diagnostics artifacts exist.
        assert!(reshade_client_dir(&client).join("last-scan.json").exists());
        assert!(reshade_client_dir(&client).join("diagnostics.log").exists());
        assert!(statuses.iter().any(|s| s.contains("config file(s)")));
    }
}

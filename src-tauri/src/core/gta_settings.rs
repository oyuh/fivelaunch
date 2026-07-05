//! GTA settings XML engine — port of v1 `GtaSettingsManager.ts` +
//! `gameManager/gtaSettings.ts`.
//!
//! The document model (`GtaSettingsDocument`) is the JSON contract with the
//! settings editor UI and must keep v1's exact shape:
//! `{ rootName, items: [{ path: "Settings/graphics/Tessellation",
//!    attributes: { "value": "2" } }] }` with `#text` for text content.
//!
//! Critical v1 behaviors preserved:
//! - `configSource = SMC_USER` is always injected on build (stops GTA from
//!   auto-detecting and clobbering settings)
//! - empty attribute values are stripped (they make GTA reject the XML)
//! - a settings file is only "real" if it looks like GTA XML (`<Settings`,
//!   >= 32 bytes) — empty placeholders are treated as missing
//! - applying copies the client file over every known target with `.backup`
//!   copies, and `fivem_sdk.cfg` (profile console vars that override XML)
//!   is renamed away
//! - an enforcement loop re-applies the file for a few minutes because
//!   FiveM's profile sync can overwrite it during startup

use indexmap::IndexMap;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use super::mirror::copy_file_best_effort;
use super::paths;

/// Embedded default template (v1 shipped this as a resource file).
pub const SETTINGS_TEMPLATE_XML: &str = include_str!("../../resources/settings-template.xml");

pub const MINIMAL_SETTINGS_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Settings>\n  <configSource>SMC_USER</configSource>\n</Settings>\n";

// ---------------------------------------------------------------------------
// Document model (UI contract — camelCase like v1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GtaSettingsItem {
    pub path: String,
    pub attributes: IndexMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GtaSettingsDocument {
    pub root_name: String,
    pub items: Vec<GtaSettingsItem>,
}

impl Default for GtaSettingsDocument {
    fn default() -> Self {
        Self {
            root_name: "Settings".into(),
            items: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// XML <-> document
// ---------------------------------------------------------------------------

/// Parse tree that preserves duplicate sibling names and document order.
#[derive(Debug, Default)]
struct ParsedNode {
    attrs: IndexMap<String, String>,
    text: String,
    children: Vec<(String, ParsedNode)>,
}

fn parse_tree(xml: &str) -> Option<(String, ParsedNode)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<(String, ParsedNode)> = Vec::new();
    let mut root: Option<(String, ParsedNode)> = None;

    let read_attrs = |e: &BytesStart| -> IndexMap<String, String> {
        let mut attrs = IndexMap::new();
        for attr in e.attributes().flatten() {
            let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
            let value = attr
                .unescape_value()
                .map(|v| v.to_string())
                .unwrap_or_default();
            attrs.insert(key, value);
        }
        attrs
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let node = ParsedNode {
                    attrs: read_attrs(&e),
                    ..Default::default()
                };
                stack.push((name, node));
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let node = ParsedNode {
                    attrs: read_attrs(&e),
                    ..Default::default()
                };
                if let Some(parent) = stack.last_mut() {
                    parent.1.children.push((name, node));
                } else if root.is_none() {
                    root = Some((name, node));
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(top) = stack.last_mut() {
                    if let Ok(text) = t.unescape() {
                        top.1.text.push_str(text.trim());
                    }
                }
            }
            Ok(Event::End(_)) => {
                let Some(done) = stack.pop() else {
                    return None;
                };
                if let Some(parent) = stack.last_mut() {
                    parent.1.children.push(done);
                } else if root.is_none() {
                    root = Some(done);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {} // declaration, comments, CDATA, PIs
            Err(_) => return None,
        }
    }

    root
}

/// v1 `walkNode`: pre-order flattening. An element contributes an item when
/// it has non-empty attributes or text; empty values are skipped.
fn walk_node(node: &ParsedNode, path_parts: &[String], items: &mut Vec<GtaSettingsItem>) {
    let mut attributes = IndexMap::new();
    for (key, value) in &node.attrs {
        if !value.is_empty() {
            attributes.insert(key.clone(), value.clone());
        }
    }
    if !node.text.is_empty() {
        attributes.insert("#text".to_string(), node.text.clone());
    }

    if !attributes.is_empty() {
        items.push(GtaSettingsItem {
            path: path_parts.join("/"),
            attributes,
        });
    }

    for (child_name, child) in &node.children {
        let mut child_path = path_parts.to_vec();
        child_path.push(child_name.clone());
        walk_node(child, &child_path, items);
    }
}

/// XML -> document. Empty/invalid input yields the empty default (v1 behavior).
pub fn parse_xml_to_document(xml: &str) -> GtaSettingsDocument {
    let trimmed = xml.trim();
    if trimmed.is_empty() {
        return GtaSettingsDocument::default();
    }

    let Some((root_name, root)) = parse_tree(trimmed) else {
        return GtaSettingsDocument::default();
    };

    let mut items = Vec::new();
    walk_node(&root, &[root_name.clone()], &mut items);

    GtaSettingsDocument { root_name, items }
}

/// Build tree (collapses duplicate paths, like v1's object-based builder).
#[derive(Debug, Default)]
struct BuildNode {
    attrs: IndexMap<String, String>,
    text: Option<String>,
    children: IndexMap<String, BuildNode>,
}

fn apply_attributes(node: &mut BuildNode, attributes: &IndexMap<String, String>) -> bool {
    let mut has_valid = false;
    for (key, value) in attributes {
        if value.is_empty() {
            continue; // empty values make GTA reject/reset settings
        }
        has_valid = true;
        if key == "#text" {
            node.text = Some(value.clone());
        } else {
            node.attrs.insert(key.clone(), value.clone());
        }
    }
    has_valid
}

fn write_node(writer: &mut Writer<Vec<u8>>, name: &str, node: &BuildNode) {
    let mut start = BytesStart::new(name);
    for (key, value) in &node.attrs {
        start.push_attribute((key.as_str(), value.as_str()));
    }

    let has_children = !node.children.is_empty();
    let has_text = node.text.as_deref().is_some_and(|t| !t.is_empty());

    if !has_children && !has_text {
        // Self-closing, like v1's suppressEmptyNode.
        let _ = writer.write_event(Event::Empty(start));
        return;
    }

    let _ = writer.write_event(Event::Start(start));
    if let Some(text) = &node.text {
        if !text.is_empty() {
            let _ = writer.write_event(Event::Text(BytesText::new(text)));
        }
    }
    for (child_name, child) in &node.children {
        write_node(writer, child_name, child);
    }
    let _ = writer.write_event(Event::End(BytesEnd::new(name)));
}

/// Document -> XML. Always injects `configSource = SMC_USER` first.
pub fn build_xml_from_document(doc: &GtaSettingsDocument) -> String {
    let root_name = if doc.root_name.is_empty() {
        "Settings"
    } else {
        &doc.root_name
    };

    let mut root = BuildNode::default();
    root.children.insert(
        "configSource".to_string(),
        BuildNode {
            text: Some("SMC_USER".to_string()),
            ..Default::default()
        },
    );

    for item in &doc.items {
        let parts: Vec<&str> = item.path.split('/').filter(|p| !p.is_empty()).collect();
        let normalized: Vec<&str> = if parts.first() == Some(&root_name) {
            parts
        } else {
            let mut v = vec![root_name];
            v.extend(parts);
            v
        };

        if normalized.len() <= 1 {
            // Attributes on the root element itself.
            apply_attributes(&mut root, &item.attributes);
            continue;
        }

        let mut node = &mut root;
        for (i, key) in normalized.iter().enumerate().skip(1) {
            let is_leaf = i == normalized.len() - 1;
            node = node.children.entry((*key).to_string()).or_default();
            if is_leaf {
                let has_valid = apply_attributes(node, &item.attributes);
                if !has_valid {
                    // All values empty: v1 removes the node again.
                    // (Only safe when we just created it empty.)
                    if node.attrs.is_empty() && node.text.is_none() && node.children.is_empty() {
                        let key_owned = (*key).to_string();
                        // Re-borrow parent chain is awkward; mark for removal
                        // by leaving the empty node — the writer will emit a
                        // self-closing empty element. To match v1 (which
                        // deletes it), prune empty leaves after the loop.
                        let _ = key_owned;
                    }
                }
            }
        }
    }

    prune_empty_leaves(&mut root);

    let mut writer = Writer::new_with_indent(Vec::new(), b' ', 4);
    let _ = writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)));
    write_node(&mut writer, root_name, &root);

    let body = String::from_utf8(writer.into_inner()).unwrap_or_default();
    // quick-xml puts the declaration and root on one line without a break.
    body.replacen("?>", "?>\n", 1)
}

/// Remove attribute-less, text-less, child-less nodes (v1 deletes leaves whose
/// attributes were all empty).
fn prune_empty_leaves(node: &mut BuildNode) {
    for (_, child) in node.children.iter_mut() {
        prune_empty_leaves(child);
    }
    node.children
        .retain(|_, c| !(c.attrs.is_empty() && c.text.is_none() && c.children.is_empty()));
}

// ---------------------------------------------------------------------------
// Client settings files
// ---------------------------------------------------------------------------

fn client_settings_dir(clients_data: &Path, client_id: &str) -> PathBuf {
    clients_data.join(client_id).join("settings")
}

pub fn client_settings_path_for_write(clients_data: &Path, client_id: &str) -> PathBuf {
    client_settings_dir(clients_data, client_id).join("gta5_settings.xml")
}

pub fn client_settings_path_for_read(clients_data: &Path, client_id: &str) -> PathBuf {
    let dir = client_settings_dir(clients_data, client_id);
    let preferred = dir.join("gta5_settings.xml");
    if preferred.exists() {
        return preferred;
    }
    let legacy = dir.join("settings.xml");
    if legacy.exists() {
        return legacy;
    }
    preferred
}

pub fn get_client_settings(clients_data: &Path, client_id: &str) -> GtaSettingsDocument {
    let path = client_settings_path_for_read(clients_data, client_id);
    let xml = fs::read_to_string(path).unwrap_or_default();
    parse_xml_to_document(&xml)
}

pub fn save_client_settings(
    clients_data: &Path,
    client_id: &str,
    doc: &GtaSettingsDocument,
) -> Result<(), String> {
    let path = client_settings_path_for_write(clients_data, client_id);
    let xml = build_xml_from_document(doc);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, xml).map_err(|e| e.to_string())
}

pub fn import_from_documents(
    clients_data: &Path,
    client_id: &str,
    game_path_override: Option<&str>,
) -> Result<GtaSettingsDocument, String> {
    let candidates = paths::gta_settings_candidates(game_path_override);
    let source = candidates.iter().find(|c| c.exists()).ok_or_else(|| {
        format!(
            "GTA settings.xml not found. Checked: {}",
            candidates
                .iter()
                .map(|c| c.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;

    let xml = fs::read_to_string(source).map_err(|e| e.to_string())?;
    let doc = parse_xml_to_document(&xml);
    save_client_settings(clients_data, client_id, &doc)?;
    Ok(doc)
}

pub fn import_from_template(
    clients_data: &Path,
    client_id: &str,
) -> Result<GtaSettingsDocument, String> {
    let doc = parse_xml_to_document(SETTINGS_TEMPLATE_XML);
    save_client_settings(clients_data, client_id, &doc)?;
    Ok(doc)
}

// ---------------------------------------------------------------------------
// Launch-time apply + enforcement
// ---------------------------------------------------------------------------

/// v1 `looksLikeGtaSettingsXml`: real settings XML, not an empty placeholder.
pub fn looks_like_gta_settings_xml(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() < 32 {
        return false;
    }
    let Ok(head) = fs::read_to_string(path) else {
        return false;
    };
    head.chars().take(2048).collect::<String>().contains("<Settings")
}

/// Ensure a real per-client settings file exists; returns its path.
/// Preference: existing gta5_settings.xml -> legacy settings.xml migration ->
/// embedded template -> minimal fallback.
pub fn ensure_client_gta_settings_file(client_path: &Path) -> Result<PathBuf, String> {
    let settings_dir = client_path.join("settings");
    let target = settings_dir.join("gta5_settings.xml");
    let legacy = settings_dir.join("settings.xml");

    if looks_like_gta_settings_xml(&target) {
        return Ok(target);
    }

    fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;

    if looks_like_gta_settings_xml(&legacy) {
        fs::copy(&legacy, &target).map_err(|e| e.to_string())?;
        return Ok(target);
    }

    fs::write(&target, SETTINGS_TEMPLATE_XML).map_err(|e| e.to_string())?;
    Ok(target)
}

/// All locations FiveM/GTA reads settings from (v1 `getGtaSettingsTargets`).
pub fn gta_settings_targets(game_path_override: Option<&str>) -> Vec<PathBuf> {
    let mut targets = Vec::new();

    // CitizenFX Roaming (PRIMARY)
    if let Some(p) = paths::gta_settings_path() {
        targets.push(p);
    }
    // FiveM.app settings.xml
    if let Some(app) = paths::five_m_path(game_path_override) {
        targets.push(app.join("settings.xml"));
    }
    // CitizenFX LocalAppData
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        targets.push(
            PathBuf::from(local)
                .join("CitizenFX")
                .join("gta5_settings.xml"),
        );
    }

    targets
}

/// v1 `replaceFile` semantics, but the pre-overwrite backup goes to the
/// central store instead of a `.backup` sibling.
fn replace_file(source: &Path, target: &Path, backups_dir: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err(format!(
            "Settings file not found: {}. Please save settings first.",
            source.display()
        ));
    }

    if target.exists() {
        // Clear read-only best-effort so the delete/copy can't be blocked.
        if let Ok(meta) = fs::metadata(target) {
            let mut perms = meta.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            let _ = fs::set_permissions(target, perms);
        }
        let kind = target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "settings".into());
        let _ = super::backups::copy_into_backups(backups_dir, target, &kind);
        let _ = fs::remove_file(target);
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;

    if let Ok(f) = fs::OpenOptions::new().write(true).open(target) {
        let _ = f.sync_all();
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct GtaEnforcementPlan {
    pub source: PathBuf,
    pub targets: Vec<PathBuf>,
}

/// Apply the client's settings to every target (originals preserved in the
/// central backup store) and neutralize `fivem_sdk.cfg`. Returns the
/// enforcement plan to run after the game spawns.
pub fn apply_gta_settings(
    client_path: &Path,
    targets: Vec<PathBuf>,
    backups_dir: &Path,
    status: &mut dyn FnMut(&str),
) -> Result<GtaEnforcementPlan, String> {
    status("Applying GTA settings...");
    let source = ensure_client_gta_settings_file(client_path)?;

    // fivem_sdk.cfg carries profile console variables that override the XML —
    // move it into the store rather than leaving a .backup_<ts> sibling.
    if let Some(citizen_dir) = paths::citizen_fx_dir() {
        let sdk_cfg = citizen_dir.join("fivem_sdk.cfg");
        if sdk_cfg.exists() {
            let _ = super::backups::move_into_backups(backups_dir, &sdk_cfg, "fivem_sdk.cfg");
        }
    }

    for target in &targets {
        replace_file(&source, target, backups_dir)?;
    }

    Ok(GtaEnforcementPlan { source, targets })
}

pub struct EnforcementConfig {
    pub tick: Duration,
    pub max_duration: Duration,
}

impl Default for EnforcementConfig {
    fn default() -> Self {
        Self {
            tick: Duration::from_millis(750),      // v1: 750ms
            max_duration: Duration::from_secs(180), // v1: 3 minutes
        }
    }
}

/// Blocking enforcement loop (run on a background thread): while FiveM boots,
/// its profile sync can overwrite the settings — keep re-applying the desired
/// bytes. Stat-signature fast path avoids re-reading unchanged files.
pub fn run_gta_settings_enforcement(
    plan: &GtaEnforcementPlan,
    config: &EnforcementConfig,
    stop: &AtomicBool,
) {
    let Ok(desired) = fs::read(&plan.source) else {
        return;
    };
    if plan.targets.is_empty() {
        return;
    }

    let started = Instant::now();
    let mut last_seen_sig: IndexMap<PathBuf, String> = IndexMap::new();

    while started.elapsed() < config.max_duration && !stop.load(Ordering::SeqCst) {
        for target in &plan.targets {
            if let Ok(meta) = fs::metadata(target) {
                let sig = format!(
                    "{}:{}",
                    meta.len(),
                    meta.modified()
                        .ok()
                        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_nanos())
                        .unwrap_or(0)
                );
                if last_seen_sig.get(target).is_some_and(|s| *s == sig) {
                    continue;
                }
                last_seen_sig.insert(target.clone(), sig);
            }

            let current = fs::read(target).ok();
            if current.as_deref() != Some(desired.as_slice()) {
                copy_file_best_effort(&plan.source, target);
                // Signature is now stale; refresh next tick.
                last_seen_sig.shift_remove(target);
            }
        }

        // Sleep one tick, responsive to stop.
        let tick_started = Instant::now();
        while tick_started.elapsed() < config.tick {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(25).min(config.tick));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_template_into_v1_item_shape() {
        let doc = parse_xml_to_document(SETTINGS_TEMPLATE_XML);
        assert_eq!(doc.root_name, "Settings");

        let tessellation = doc
            .items
            .iter()
            .find(|i| i.path == "Settings/graphics/Tessellation")
            .expect("Tessellation item");
        assert_eq!(tessellation.attributes.get("value").map(String::as_str), Some("1"));

        let config_source = doc
            .items
            .iter()
            .find(|i| i.path == "Settings/configSource")
            .expect("configSource item");
        assert_eq!(
            config_source.attributes.get("#text").map(String::as_str),
            Some("SMC_USER")
        );

        // Pre-order: configSource (first child) before graphics children.
        let idx_config = doc.items.iter().position(|i| i.path == "Settings/configSource").unwrap();
        let idx_tess = doc.items.iter().position(|i| i.path == "Settings/graphics/Tessellation").unwrap();
        assert!(idx_config < idx_tess);
    }

    #[test]
    fn document_json_matches_v1_ui_contract() {
        let doc = GtaSettingsDocument {
            root_name: "Settings".into(),
            items: vec![GtaSettingsItem {
                path: "Settings/video/ScreenWidth".into(),
                attributes: IndexMap::from([("value".to_string(), "2560".to_string())]),
            }],
        };
        let json = serde_json::to_string(&doc).unwrap();
        assert_eq!(
            json,
            r#"{"rootName":"Settings","items":[{"path":"Settings/video/ScreenWidth","attributes":{"value":"2560"}}]}"#
        );
    }

    #[test]
    fn round_trip_preserves_values() {
        let doc = parse_xml_to_document(SETTINGS_TEMPLATE_XML);
        let xml = build_xml_from_document(&doc);
        let reparsed = parse_xml_to_document(&xml);

        assert_eq!(reparsed.root_name, "Settings");
        // Every original item must survive the round trip with its values.
        for item in &doc.items {
            let found = reparsed
                .items
                .iter()
                .find(|i| i.path == item.path)
                .unwrap_or_else(|| panic!("missing {} after round trip", item.path));
            assert_eq!(found.attributes, item.attributes, "attrs differ at {}", item.path);
        }
    }

    #[test]
    fn build_injects_config_source_and_declaration() {
        let xml = build_xml_from_document(&GtaSettingsDocument::default());
        assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
        assert!(xml.contains("<configSource>SMC_USER</configSource>"));
    }

    #[test]
    fn build_strips_empty_attributes_and_prunes_empty_nodes() {
        let doc = GtaSettingsDocument {
            root_name: "Settings".into(),
            items: vec![
                GtaSettingsItem {
                    path: "Settings/graphics/MSAA".into(),
                    attributes: IndexMap::from([
                        ("value".to_string(), "4".to_string()),
                        ("junk".to_string(), "".to_string()),
                    ]),
                },
                GtaSettingsItem {
                    path: "Settings/graphics/Ghost".into(),
                    attributes: IndexMap::from([("value".to_string(), "".to_string())]),
                },
            ],
        };
        let xml = build_xml_from_document(&doc);
        assert!(xml.contains(r#"<MSAA value="4"/>"#), "got: {xml}");
        assert!(!xml.contains("junk"));
        assert!(!xml.contains("Ghost"), "all-empty node must be pruned: {xml}");
    }

    #[test]
    fn empty_or_garbage_input_yields_default() {
        assert_eq!(parse_xml_to_document(""), GtaSettingsDocument::default());
        assert_eq!(parse_xml_to_document("   "), GtaSettingsDocument::default());
        assert_eq!(
            parse_xml_to_document("<Settings><broken").root_name,
            "Settings"
        );
    }

    #[test]
    fn looks_like_detects_placeholders() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("empty.xml");
        fs::write(&empty, "").unwrap();
        assert!(!looks_like_gta_settings_xml(&empty));

        let tiny = dir.path().join("tiny.xml");
        fs::write(&tiny, "<Settings/>").unwrap();
        assert!(!looks_like_gta_settings_xml(&tiny), "under 32 bytes is placeholder");

        let real = dir.path().join("real.xml");
        fs::write(&real, SETTINGS_TEMPLATE_XML).unwrap();
        assert!(looks_like_gta_settings_xml(&real));
    }

    #[test]
    fn ensure_client_file_migrates_legacy_then_falls_back_to_template() {
        let dir = tempfile::tempdir().unwrap();
        let client = dir.path().join("client");

        // Nothing exists -> template.
        let path = ensure_client_gta_settings_file(&client).unwrap();
        assert!(looks_like_gta_settings_xml(&path));
        assert_eq!(fs::read_to_string(&path).unwrap(), SETTINGS_TEMPLATE_XML);

        // Legacy migration takes precedence over template when target is a placeholder.
        let client2 = dir.path().join("client2");
        let settings2 = client2.join("settings");
        fs::create_dir_all(&settings2).unwrap();
        fs::write(settings2.join("gta5_settings.xml"), "").unwrap(); // placeholder
        let legacy_xml = SETTINGS_TEMPLATE_XML.replace("value=\"27\"", "value=\"26\"");
        fs::write(settings2.join("settings.xml"), &legacy_xml).unwrap();

        let path2 = ensure_client_gta_settings_file(&client2).unwrap();
        assert!(path2.ends_with("gta5_settings.xml"));
        assert_eq!(fs::read_to_string(&path2).unwrap(), legacy_xml);
    }

    #[test]
    fn save_and_get_round_trip_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let clients_data = dir.path().join("clients");
        fs::create_dir_all(clients_data.join("abc")).unwrap();

        let doc = parse_xml_to_document(SETTINGS_TEMPLATE_XML);
        save_client_settings(&clients_data, "abc", &doc).unwrap();

        let loaded = get_client_settings(&clients_data, "abc");
        let width = loaded
            .items
            .iter()
            .find(|i| i.path == "Settings/video/ScreenWidth")
            .unwrap();
        assert_eq!(width.attributes.get("value").map(String::as_str), Some("2560"));
    }

    #[test]
    fn apply_writes_targets_and_backs_up_into_store() {
        let dir = tempfile::tempdir().unwrap();
        let client = dir.path().join("client");
        let store = dir.path().join("backups");
        let target_a = dir.path().join("roaming").join("gta5_settings.xml");
        let target_b = dir.path().join("FiveM.app").join("settings.xml");
        fs::create_dir_all(target_a.parent().unwrap()).unwrap();
        fs::write(&target_a, "old-content-that-should-be-backed-up").unwrap();

        let plan = apply_gta_settings(
            &client,
            vec![target_a.clone(), target_b.clone()],
            &store,
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(plan.targets.len(), 2);
        let applied = fs::read_to_string(&target_a).unwrap();
        assert!(applied.contains("<Settings"));
        assert_eq!(fs::read_to_string(&target_b).unwrap(), applied);

        // No `.backup` sibling next to the target...
        assert!(!PathBuf::from(format!("{}.backup", target_a.display())).exists());
        // ...the original content lives in the central store instead.
        let entries = crate::core::backups::list_backups(&store);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "gta5_settings.xml");
        assert_eq!(
            fs::read_to_string(&entries[0].path).unwrap(),
            "old-content-that-should-be-backed-up"
        );
    }

    #[test]
    fn enforcement_restores_overwritten_target() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.xml");
        let target = dir.path().join("target.xml");
        fs::write(&source, SETTINGS_TEMPLATE_XML).unwrap();
        fs::write(&target, SETTINGS_TEMPLATE_XML).unwrap();

        let plan = GtaEnforcementPlan {
            source: source.clone(),
            targets: vec![target.clone()],
        };
        let config = EnforcementConfig {
            tick: Duration::from_millis(20),
            max_duration: Duration::from_secs(5),
        };
        let stop = std::sync::Arc::new(AtomicBool::new(false));

        let handle = {
            let stop = stop.clone();
            std::thread::spawn(move || run_gta_settings_enforcement(&plan, &config, &stop))
        };

        // Simulate FiveM clobbering the file.
        std::thread::sleep(Duration::from_millis(80));
        fs::write(&target, "CLOBBERED BY GAME").unwrap();

        // Enforcement must restore it within a few ticks.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if fs::read_to_string(&target).unwrap() == SETTINGS_TEMPLATE_XML {
                break;
            }
            assert!(Instant::now() < deadline, "enforcement did not restore the file");
            std::thread::sleep(Duration::from_millis(25));
        }

        stop.store(true, Ordering::SeqCst);
        handle.join().unwrap();
    }
}

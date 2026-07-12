//! Schema validation + repair for GTA settings documents.
//!
//! Why this exists: when the game (or FiveM's loader) finds gta5_settings.xml
//! missing, unparseable, or structurally wrong, it silently throws the file
//! away and regenerates auto-detected DEFAULTS — which users experience as
//! "the launcher reset all my settings". So before a document is ever saved
//! or applied, it is repaired against the known schema:
//!
//! - every setting the game expects is present (missing ones are filled from
//!   fallback documents — the current live game file first, then the
//!   embedded template)
//! - every value is the right shape for its setting (booleans are
//!   `true`/`false`, enums are in range, numbers parse) — invalid values are
//!   replaced from the same fallback chain
//! - unknown extra settings the game wrote (e.g. `VideoCardDescription`) are
//!   preserved as long as their values are non-empty
//!
//! The output is therefore always a complete, well-formed document the game
//! will accept, no matter how sparse or damaged the input was.

use indexmap::IndexMap;

use super::gta_settings::{GtaSettingsDocument, GtaSettingsItem};

/// Result of a repair pass: the repaired document plus human-readable notes
/// about everything that had to be fixed (empty = input was already valid).
#[derive(Debug)]
pub struct RepairOutcome {
    pub document: GtaSettingsDocument,
    pub repairs: Vec<String>,
}

/// Value shape for a known setting.
enum Kind {
    /// Exactly "true" or "false" (the game writes lowercase).
    Bool,
    /// Integer restricted to a sparse set (e.g. MSAA 0/2/4/8).
    IntSet(&'static [i64]),
    /// Numeric within an inclusive range.
    Int(i64, i64),
    /// Float within an inclusive range. Ranges are deliberately generous —
    /// the game clamps in-range values itself; we only reject garbage that
    /// would make it discard the whole file.
    Float(f64, f64),
    /// Any non-empty text.
    Text,
}

fn kind_for(name: &str) -> Kind {
    match name {
        // Boolean toggles
        "UltraShadows_Enabled" | "Shadow_ParticleShadows" | "Shadow_LongShadows"
        | "Shadow_DisableScreenSizeCheck" | "Reflection_MipBlur" | "FXAA_Enabled"
        | "TXAA_Enabled" | "Lighting_FogVolumes" | "Shader_SSA" | "DoF"
        | "HdStreamingInFlight" | "Stereo" | "Audio3d" | "TripleBuffered"
        | "AsyncComputeEnabled" => Kind::Bool,

        // Sparse enums
        "MSAA" | "ReflectionMSAA" => Kind::IntSet(&[0, 2, 4, 8]),
        "AnisotropicFiltering" => Kind::IntSet(&[0, 1, 2, 4, 8, 16]),

        // Contiguous enums (match src/lib/gtaSettingsMap.ts)
        "Tessellation" | "ParticleQuality" | "GrassQuality" | "PostFX" | "SamplingMode" => {
            Kind::Int(0, 3)
        }
        "ShadowQuality" | "ReflectionQuality" => Kind::Int(0, 4),
        "SSAO" | "TextureQuality" | "WaterQuality" | "ShaderQuality" | "MSAAQuality"
        | "DX_Version" | "VSync" | "Windowed" => Kind::Int(0, 2),
        "MSAAFragments" | "PauseOnFocusLoss" => Kind::Int(0, 1),
        "Shadow_SoftShadows" => Kind::Int(0, 5),
        "AspectRatio" => Kind::Int(0, 6),

        // Video / display
        "ScreenWidth" => Kind::Int(320, 15360),
        "ScreenHeight" => Kind::Int(200, 8640),
        "RefreshRate" => Kind::Int(23, 1000),
        "AdapterIndex" | "OutputIndex" => Kind::Int(0, 15),

        // Float scales
        "LodScale" | "PedLodBias" | "VehicleLodBias" | "Shadow_Distance"
        | "Shadow_SplitZStart" | "Shadow_SplitZEnd" | "Shadow_aircraftExpWeight"
        | "CityDensity" | "PedVarietyMultiplier" | "VehicleVarietyMultiplier"
        | "MaxLodScale" | "MotionBlurStrength" | "Convergence" | "Separation" => {
            Kind::Float(0.0, 10.0)
        }

        // Replay / system block
        "numBytesPerReplayBlock" | "numReplayBlocks" | "maxSizeOfStreamingReplay"
        | "maxFileStoreSize" => Kind::Int(1, 999_999_999),

        // Settings schema version — the game regenerates the file on mismatch,
        // so the value from a real game-written file always wins over ours.
        "version" => Kind::Int(1, 999),

        _ => Kind::Text,
    }
}

/// Is `value` acceptable for attribute `key` of setting `name`?
/// Only `value` and `#text` carry typed data; other attributes just need to
/// be non-empty (the game rejects files containing empty attribute values).
pub fn validate_value(name: &str, key: &str, value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    if key != "value" && key != "#text" {
        return true;
    }
    match kind_for(name) {
        Kind::Bool => value == "true" || value == "false",
        Kind::IntSet(allowed) => value
            .parse::<i64>()
            .is_ok_and(|v| allowed.contains(&v)),
        Kind::Int(min, max) => value
            .parse::<f64>()
            .is_ok_and(|v| v.is_finite() && v >= min as f64 && v <= max as f64),
        Kind::Float(min, max) => value
            .parse::<f64>()
            .is_ok_and(|v| v.is_finite() && v >= min && v <= max),
        Kind::Text => true,
    }
}

/// Path relative to the document root ("Settings/video/VSync" -> "video/VSync").
fn rel_path<'a>(root_name: &str, path: &'a str) -> &'a str {
    let trimmed = path.trim_start_matches('/');
    let root = if root_name.is_empty() { "Settings" } else { root_name };
    match trimmed.strip_prefix(root) {
        Some(rest) => rest.trim_start_matches('/'),
        None => trimmed,
    }
}

fn leaf_name(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

fn index_items(doc: &GtaSettingsDocument) -> IndexMap<String, &GtaSettingsItem> {
    let mut map = IndexMap::new();
    for item in &doc.items {
        map.insert(rel_path(&doc.root_name, &item.path).to_string(), item);
    }
    map
}

/// Repair `client` against the known schema.
///
/// `fallbacks` are consulted in order for missing/invalid values; the LAST
/// fallback doubles as the structural skeleton (the complete set of settings
/// the output must contain), so callers must always put the embedded template
/// last — e.g. `[&live_game_doc, &template_doc]` or just `[&template_doc]`.
pub fn repair_document(
    client: &GtaSettingsDocument,
    fallbacks: &[&GtaSettingsDocument],
) -> RepairOutcome {
    let Some(skeleton) = fallbacks.last() else {
        return RepairOutcome {
            document: client.clone(),
            repairs: Vec::new(),
        };
    };

    let client_index = index_items(client);
    let fallback_indexes: Vec<IndexMap<String, &GtaSettingsItem>> =
        fallbacks.iter().map(|d| index_items(d)).collect();

    let mut repairs: Vec<String> = Vec::new();
    let mut filled_missing = 0usize;
    let client_is_empty = client.items.is_empty();
    let mut items: Vec<GtaSettingsItem> = Vec::new();

    for skel_item in &skeleton.items {
        let rel = rel_path(&skeleton.root_name, &skel_item.path);
        // The XML builder always injects configSource=SMC_USER on its own.
        if rel == "configSource" {
            continue;
        }
        let name = leaf_name(rel);
        let client_item = client_index.get(rel);
        let mut attributes: IndexMap<String, String> = IndexMap::new();

        for (key, skel_value) in &skel_item.attributes {
            let client_value = client_item.and_then(|i| i.attributes.get(key));
            let value = match client_value {
                Some(v) if validate_value(name, key, v) => v.clone(),
                other => {
                    // Missing or invalid: first valid fallback value wins,
                    // the skeleton's own value is the terminal default.
                    let fixed = fallback_indexes
                        .iter()
                        .filter_map(|idx| idx.get(rel))
                        .filter_map(|i| i.attributes.get(key))
                        .find(|v| validate_value(name, key, v))
                        .cloned()
                        .unwrap_or_else(|| skel_value.clone());
                    match other {
                        Some(bad) => repairs.push(format!(
                            "{rel}: invalid value \"{bad}\" replaced with \"{fixed}\""
                        )),
                        None => filled_missing += 1,
                    }
                    fixed
                }
            };
            attributes.insert(key.clone(), value);
        }

        // Extra attributes the client carries beyond the skeleton's.
        if let Some(item) = client_item {
            for (key, value) in &item.attributes {
                if attributes.contains_key(key) {
                    continue;
                }
                if validate_value(name, key, value) {
                    attributes.insert(key.clone(), value.clone());
                } else {
                    repairs.push(format!("{rel}: dropped invalid attribute \"{key}\""));
                }
            }
        }

        items.push(GtaSettingsItem {
            path: format!("Settings/{rel}"),
            attributes,
        });
    }

    // Settings the client has beyond the skeleton (e.g. game-written extras
    // like VideoCardDescription) — keep whatever validates.
    let skeleton_index = index_items(skeleton);
    for item in &client.items {
        let rel = rel_path(&client.root_name, &item.path).to_string();
        if rel.is_empty() || rel == "configSource" || skeleton_index.contains_key(rel.as_str()) {
            continue;
        }
        let name = leaf_name(&rel);
        let mut attributes: IndexMap<String, String> = IndexMap::new();
        for (key, value) in &item.attributes {
            if validate_value(name, key, value) {
                attributes.insert(key.clone(), value.clone());
            } else {
                repairs.push(format!("{rel}: dropped invalid attribute \"{key}\""));
            }
        }
        if attributes.is_empty() {
            repairs.push(format!("{rel}: removed (no valid values)"));
        } else {
            items.push(GtaSettingsItem {
                path: format!("Settings/{rel}"),
                attributes,
            });
        }
    }

    // The game records its GPU in VideoCardDescription; carry it over from a
    // fallback (usually the live file) when the client never had one, so the
    // applied file matches what the game itself would write.
    if !items
        .iter()
        .any(|i| rel_path("Settings", &i.path) == "VideoCardDescription")
    {
        if let Some(vcd) = fallback_indexes
            .iter()
            .filter_map(|idx| idx.get("VideoCardDescription"))
            .find(|i| i.attributes.values().any(|v| !v.is_empty()))
        {
            items.push(GtaSettingsItem {
                path: "Settings/VideoCardDescription".to_string(),
                attributes: vcd.attributes.clone(),
            });
        }
    }

    if client_is_empty {
        repairs.push(
            "no usable saved settings — rebuilt from your current game settings / defaults".into(),
        );
    } else if filled_missing > 0 {
        repairs.push(format!(
            "{filled_missing} missing setting(s) filled from your current game settings / defaults"
        ));
    }

    RepairOutcome {
        document: GtaSettingsDocument {
            root_name: "Settings".to_string(),
            items,
        },
        repairs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::gta_settings::{parse_xml_to_document, SETTINGS_TEMPLATE_XML};

    fn template() -> GtaSettingsDocument {
        parse_xml_to_document(SETTINGS_TEMPLATE_XML)
    }

    fn item(path: &str, key: &str, value: &str) -> GtaSettingsItem {
        GtaSettingsItem {
            path: path.into(),
            attributes: IndexMap::from([(key.to_string(), value.to_string())]),
        }
    }

    fn get<'a>(doc: &'a GtaSettingsDocument, rel: &str) -> Option<&'a GtaSettingsItem> {
        doc.items
            .iter()
            .find(|i| rel_path(&doc.root_name, &i.path) == rel)
    }

    #[test]
    fn valid_document_passes_through_unchanged_values() {
        let tpl = template();
        let outcome = repair_document(&tpl, &[&tpl]);
        assert!(outcome.repairs.is_empty(), "repairs: {:?}", outcome.repairs);
        // Every template setting except configSource must be present.
        assert_eq!(outcome.document.items.len(), tpl.items.len() - 1);
        assert_eq!(
            get(&outcome.document, "video/ScreenWidth").unwrap().attributes["value"],
            "2560"
        );
    }

    #[test]
    fn invalid_values_are_replaced_with_fallbacks() {
        let tpl = template();
        let mut client = tpl.clone();
        for i in &mut client.items {
            let rel = rel_path("Settings", &i.path).to_string();
            match rel.as_str() {
                "graphics/MSAA" => {
                    i.attributes.insert("value".into(), "7".into()); // not in {0,2,4,8}
                }
                "graphics/DoF" => {
                    i.attributes.insert("value".into(), "yes".into()); // not a bool
                }
                "video/ScreenWidth" => {
                    i.attributes.insert("value".into(), "NaN".into());
                }
                _ => {}
            }
        }

        // Live doc supplies a good ScreenWidth that must win over the template.
        let mut live = tpl.clone();
        for i in &mut live.items {
            if rel_path("Settings", &i.path) == "video/ScreenWidth" {
                i.attributes.insert("value".into(), "1920".into());
            }
        }

        let outcome = repair_document(&client, &[&live, &tpl]);
        assert_eq!(
            get(&outcome.document, "graphics/MSAA").unwrap().attributes["value"],
            "0",
            "template default restored"
        );
        assert_eq!(
            get(&outcome.document, "graphics/DoF").unwrap().attributes["value"],
            "false"
        );
        assert_eq!(
            get(&outcome.document, "video/ScreenWidth").unwrap().attributes["value"],
            "1920",
            "live value preferred over template"
        );
        assert_eq!(outcome.repairs.len(), 3, "{:?}", outcome.repairs);
    }

    #[test]
    fn sparse_document_is_completed_from_live_then_template() {
        let tpl = template();
        let client = GtaSettingsDocument {
            root_name: "Settings".into(),
            items: vec![item("Settings/graphics/MSAA", "value", "4")],
        };
        let mut live = tpl.clone();
        for i in &mut live.items {
            if rel_path("Settings", &i.path) == "video/ScreenHeight" {
                i.attributes.insert("value".into(), "1080".into());
            }
        }

        let outcome = repair_document(&client, &[&live, &tpl]);
        // Client's own valid value kept.
        assert_eq!(get(&outcome.document, "graphics/MSAA").unwrap().attributes["value"], "4");
        // Missing values filled — live first.
        assert_eq!(
            get(&outcome.document, "video/ScreenHeight").unwrap().attributes["value"],
            "1080"
        );
        // Structural completeness: version node present (game resets without it).
        assert_eq!(get(&outcome.document, "version").unwrap().attributes["value"], "27");
        assert!(outcome
            .repairs
            .iter()
            .any(|r| r.contains("missing setting(s) filled")));
    }

    #[test]
    fn empty_document_rebuilds_completely() {
        let tpl = template();
        let outcome = repair_document(&GtaSettingsDocument::default(), &[&tpl]);
        assert_eq!(outcome.document.items.len(), tpl.items.len() - 1);
        assert!(outcome.repairs.iter().any(|r| r.contains("no usable saved settings")));
    }

    #[test]
    fn unknown_extras_are_preserved() {
        let tpl = template();
        let mut client = tpl.clone();
        client.items.push(item(
            "Settings/VideoCardDescription",
            "#text",
            "NVIDIA GeForce RTX 4090",
        ));
        client.items.push(item("Settings/graphics/FutureSetting", "value", "1"));

        let outcome = repair_document(&client, &[&tpl]);
        assert_eq!(
            get(&outcome.document, "VideoCardDescription").unwrap().attributes["#text"],
            "NVIDIA GeForce RTX 4090"
        );
        assert_eq!(
            get(&outcome.document, "graphics/FutureSetting").unwrap().attributes["value"],
            "1"
        );
    }

    #[test]
    fn video_card_description_carried_from_live() {
        let tpl = template();
        let mut live = tpl.clone();
        live.items.push(item(
            "Settings/VideoCardDescription",
            "#text",
            "AMD Radeon RX 7900",
        ));
        let outcome = repair_document(&tpl, &[&live, &tpl]);
        assert_eq!(
            get(&outcome.document, "VideoCardDescription").unwrap().attributes["#text"],
            "AMD Radeon RX 7900"
        );
    }

    #[test]
    fn game_written_version_wins_over_template() {
        let tpl = template();
        let mut client = tpl.clone();
        for i in &mut client.items {
            if rel_path("Settings", &i.path) == "version" {
                i.attributes.insert("value".into(), "28".into());
            }
        }
        let outcome = repair_document(&client, &[&tpl]);
        assert_eq!(get(&outcome.document, "version").unwrap().attributes["value"], "28");
        assert!(outcome.repairs.is_empty());
    }

    #[test]
    fn validate_value_covers_kinds() {
        assert!(validate_value("DoF", "value", "true"));
        assert!(!validate_value("DoF", "value", "True"));
        assert!(validate_value("MSAA", "value", "8"));
        assert!(!validate_value("MSAA", "value", "3"));
        assert!(validate_value("ScreenWidth", "value", "1920"));
        assert!(!validate_value("ScreenWidth", "value", "0"));
        assert!(!validate_value("ScreenWidth", "value", "banana"));
        assert!(validate_value("LodScale", "value", "0.5"));
        assert!(!validate_value("LodScale", "value", "-1"));
        assert!(!validate_value("anything", "value", ""));
        assert!(validate_value("VideoCardDescription", "#text", "GPU"));
    }
}

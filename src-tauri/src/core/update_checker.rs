//! GitHub release update check — port of v1 `utils/updateChecker.ts`.
//! Notify-only: shows a link in the UI, never auto-installs.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub latest_url: Option<String>,
    pub is_update_available: bool,
    pub checked_at: u64,
    pub source: String, // 'releases-latest' | 'tags-latest' | 'error'
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn normalize_version(v: &str) -> String {
    let t = v.trim();
    t.strip_prefix('v')
        .or_else(|| t.strip_prefix('V'))
        .unwrap_or(t)
        .to_string()
}

#[derive(Debug, PartialEq)]
struct Semver {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

fn parse_semver(v: &str) -> Option<Semver> {
    let cleaned = normalize_version(v);
    let (core, prerelease) = match cleaned.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (cleaned.as_str(), None),
    };

    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(Semver {
        major,
        minor,
        patch,
        prerelease,
    })
}

/// v1 `compareSemver`: unparseable versions compare equal; pre-release is
/// lower than the same stable version.
pub fn compare_semver(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (Some(pa), Some(pb)) = (parse_semver(a), parse_semver(b)) else {
        return Ordering::Equal;
    };

    pa.major
        .cmp(&pb.major)
        .then(pa.minor.cmp(&pb.minor))
        .then(pa.patch.cmp(&pb.patch))
        .then(match (&pa.prerelease, &pb.prerelease) {
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (None, None) => Ordering::Equal,
            (Some(x), Some(y)) => x.cmp(y),
        })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Fetch function type: URL -> parsed JSON. Injected so tests never hit the
/// network; production uses [`fetch_json_ureq`].
pub type FetchJson<'a> = &'a dyn Fn(&str) -> Result<serde_json::Value, String>;

pub fn fetch_json_ureq(url: &str) -> Result<serde_json::Value, String> {
    ureq::get(url)
        .header("User-Agent", "FiveLaunch")
        .header("Accept", "application/vnd.github+json")
        .config()
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .build()
        .call()
        .map_err(|e| e.to_string())?
        .body_mut()
        .read_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

pub fn check_for_updates_on_github(
    repo: &str,
    current_version: &str,
    fetch: FetchJson<'_>,
) -> UpdateStatus {
    let checked_at = now_ms();
    let current = normalize_version(current_version);

    // Prefer releases/latest since it represents the actual published release.
    let release_result = fetch(&format!("https://api.github.com/repos/{repo}/releases/latest"));

    match release_result {
        Ok(release) => {
            let tag = release
                .get("tag_name")
                .and_then(|v| v.as_str())
                .map(String::from);
            let latest_version = tag.as_deref().map(normalize_version);
            let latest_url = release
                .get("html_url")
                .and_then(|v| v.as_str())
                .map(String::from)
                .or_else(|| {
                    tag.as_ref()
                        .map(|t| format!("https://github.com/{repo}/releases/tag/{t}"))
                });

            let is_update_available = latest_version
                .as_deref()
                .is_some_and(|lv| compare_semver(lv, &current) == std::cmp::Ordering::Greater);

            UpdateStatus {
                current_version: current,
                latest_version,
                latest_url,
                is_update_available,
                checked_at,
                source: "releases-latest".into(),
                error: None,
            }
        }
        Err(release_err) => {
            // Fallback: tags list.
            match fetch(&format!("https://api.github.com/repos/{repo}/tags?per_page=1")) {
                Ok(tags) => {
                    let latest_tag = tags
                        .get(0)
                        .and_then(|t| t.get("name"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let latest_version = latest_tag.as_deref().map(normalize_version);
                    let latest_url = latest_tag
                        .as_ref()
                        .map(|t| format!("https://github.com/{repo}/releases/tag/{t}"));
                    let is_update_available = latest_version.as_deref().is_some_and(|lv| {
                        compare_semver(lv, &current) == std::cmp::Ordering::Greater
                    });

                    UpdateStatus {
                        current_version: current,
                        latest_version,
                        latest_url,
                        is_update_available,
                        checked_at,
                        source: "tags-latest".into(),
                        error: None,
                    }
                }
                Err(fallback_err) => UpdateStatus {
                    current_version: current,
                    latest_version: None,
                    latest_url: None,
                    is_update_available: false,
                    checked_at,
                    source: "error".into(),
                    error: Some(if fallback_err.is_empty() {
                        release_err
                    } else {
                        fallback_err
                    }),
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn semver_compare_matches_v1() {
        assert_eq!(compare_semver("2.0.0", "1.9.9"), Ordering::Greater);
        assert_eq!(compare_semver("v2.0.0", "2.0.0"), Ordering::Equal);
        assert_eq!(compare_semver("2.0.0", "2.0.1"), Ordering::Less);
        assert_eq!(compare_semver("2.1.0", "2.0.9"), Ordering::Greater);
        // Pre-release is lower than stable.
        assert_eq!(compare_semver("2.0.0-beta.1", "2.0.0"), Ordering::Less);
        assert_eq!(compare_semver("2.0.0", "2.0.0-rc.1"), Ordering::Greater);
        // Unparseable compares equal (never triggers a false update).
        assert_eq!(compare_semver("garbage", "2.0.0"), Ordering::Equal);
    }

    #[test]
    fn uses_releases_latest_when_available() {
        let fetch = |url: &str| -> Result<serde_json::Value, String> {
            assert!(url.contains("/releases/latest"));
            Ok(serde_json::json!({
                "tag_name": "v9.9.9",
                "html_url": "https://github.com/oyuh/fivelaunch/releases/tag/v9.9.9"
            }))
        };

        let status = check_for_updates_on_github("oyuh/fivelaunch", "2.0.0", &fetch);
        assert_eq!(status.source, "releases-latest");
        assert_eq!(status.latest_version.as_deref(), Some("9.9.9"));
        assert!(status.is_update_available);
        assert_eq!(status.current_version, "2.0.0");
    }

    #[test]
    fn falls_back_to_tags_then_error() {
        let fetch_tags = |url: &str| -> Result<serde_json::Value, String> {
            if url.contains("/releases/latest") {
                Err("HTTP 404".into())
            } else {
                Ok(serde_json::json!([{ "name": "v1.0.0" }]))
            }
        };
        let status = check_for_updates_on_github("oyuh/fivelaunch", "2.0.0", &fetch_tags);
        assert_eq!(status.source, "tags-latest");
        assert_eq!(status.latest_version.as_deref(), Some("1.0.0"));
        assert!(!status.is_update_available, "older tag must not flag an update");

        let fetch_fail = |_: &str| -> Result<serde_json::Value, String> { Err("offline".into()) };
        let status = check_for_updates_on_github("oyuh/fivelaunch", "2.0.0", &fetch_fail);
        assert_eq!(status.source, "error");
        assert!(!status.is_update_available);
        assert_eq!(status.error.as_deref(), Some("offline"));
    }

    #[test]
    fn serializes_camel_case_like_v1() {
        let status = UpdateStatus {
            current_version: "2.0.0".into(),
            latest_version: Some("2.1.0".into()),
            latest_url: Some("https://x".into()),
            is_update_available: true,
            checked_at: 123,
            source: "releases-latest".into(),
            error: None,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"currentVersion\":\"2.0.0\""));
        assert!(json.contains("\"isUpdateAvailable\":true"));
        assert!(json.contains("\"checkedAt\":123"));
        assert!(!json.contains("\"error\""));
    }
}

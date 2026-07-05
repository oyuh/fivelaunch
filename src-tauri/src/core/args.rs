//! Command-line argument + Windows shortcut naming helpers.
//! Port of v1 `app/args.ts`.

/// Sanitize a string for use as a Windows filename (used for Desktop `.lnk`
/// names). Runs of forbidden characters collapse to a single `-`; whitespace
/// runs collapse to a single space.
pub fn sanitize_windows_file_name(name: &str) -> String {
    const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

    let mut out = String::with_capacity(name.len());
    let mut in_forbidden_run = false;
    let mut in_space_run = false;

    for c in name.chars() {
        if FORBIDDEN.contains(&c) {
            if !in_forbidden_run {
                out.push('-');
                in_forbidden_run = true;
            }
            in_space_run = false;
        } else if c.is_whitespace() {
            if !in_space_run {
                out.push(' ');
                in_space_run = true;
            }
            in_forbidden_run = false;
        } else {
            out.push(c);
            in_forbidden_run = false;
            in_space_run = false;
        }
    }

    let trimmed = out.trim();
    if trimmed.is_empty() {
        "shortcut".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Parse `--launch-client=<id>` or `--launch-client <id>` from an argv list.
pub fn get_launch_client_arg<S: AsRef<str>>(argv: &[S]) -> Option<String> {
    for (i, arg) in argv.iter().enumerate() {
        let arg = arg.as_ref();
        if let Some(value) = arg.strip_prefix("--launch-client=") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
        if arg == "--launch-client" {
            if let Some(next) = argv.get(i + 1) {
                let value = next.as_ref().trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_forbidden_characters_like_v1() {
        assert_eq!(sanitize_windows_file_name("FiveM - Main RP.lnk"), "FiveM - Main RP.lnk");
        assert_eq!(sanitize_windows_file_name("a<>:\"/\\|?*b"), "a-b");
        assert_eq!(sanitize_windows_file_name("x: y"), "x- y");
        assert_eq!(sanitize_windows_file_name("  spaced   out  "), "spaced out");
        assert_eq!(sanitize_windows_file_name("***"), "-");
        assert_eq!(sanitize_windows_file_name("   "), "shortcut");
        assert_eq!(sanitize_windows_file_name(""), "shortcut");
    }

    #[test]
    fn parses_launch_client_arg_both_forms() {
        assert_eq!(
            get_launch_client_arg(&["app.exe", "--launch-client=abc-123"]),
            Some("abc-123".to_string())
        );
        assert_eq!(
            get_launch_client_arg(&["app.exe", "--launch-client", "xyz"]),
            Some("xyz".to_string())
        );
        assert_eq!(get_launch_client_arg(&["app.exe", "--launch-client="]), None);
        assert_eq!(get_launch_client_arg(&["app.exe", "--launch-client"]), None);
        assert_eq!(get_launch_client_arg(&["app.exe", "--other"]), None);
        assert_eq!(get_launch_client_arg::<&str>(&[]), None);
    }
}

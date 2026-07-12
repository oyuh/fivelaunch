//! Best-effort detection of the machine's GPU name.
//!
//! Why this exists: GTA records the graphics card in `VideoCardDescription`
//! and compares it against the hardware it detects at boot. A missing or
//! mismatched name makes the game throw the graphics block away and re-run
//! auto-detection — the "I changed my settings but they don't apply" symptom.
//!
//! The best value is the one from the user's real GTA settings (it matches
//! exactly what the game wrote); that is handled by the settings fallback
//! chain. This module is the LAST RESORT: when no existing settings file
//! carries a GPU (a brand-new machine, a freshly reset profile), we ask the OS
//! so a fresh client still gets a plausible, correctly-shaped value instead of
//! nothing.
//!
//! No extra crate dependency: on Windows we query WMI/CIM through PowerShell
//! (`Win32_VideoController`), which every supported Windows ships. The binary
//! stays small (a core part of the v2 pitch).

/// Choose the most likely real GPU from a list of display-adapter names.
///
/// Filters out virtual / basic / remote-session adapters, then picks the
/// highest-priority remaining name: a **discrete** GPU (NVIDIA/AMD Radeon RX/
/// Intel Arc) over an **integrated** one (Intel UHD/Iris, AMD APU) over an
/// unrecognized-but-real device. This matters on the common Intel-iGPU +
/// NVIDIA-dGPU machine, where GTA renders on the discrete card — so that is the
/// name its settings file must carry. Pure, so it can be tested without the OS.
pub fn pick_gpu_name(names: &[String]) -> Option<String> {
    names
        .iter()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty() && !is_placeholder_adapter(n))
        .max_by_key(|n| adapter_priority(n))
        .map(|n| n.to_string())
}

/// Higher = more likely to be the GPU GTA actually renders on. Ties within a
/// tier are unimportant (they're the same class of adapter); the discrete tier
/// is what reliably beats an integrated iGPU on hybrid machines.
fn adapter_priority(name: &str) -> u8 {
    let n = name.to_ascii_lowercase();

    let discrete = ["nvidia", "geforce", "rtx", "gtx", "radeon rx", "radeon pro", "arc"]
        .iter()
        .any(|needle| n.contains(needle));
    if discrete {
        return 3;
    }

    let integrated = ["intel", "uhd", "iris", "hd graphics", "radeon", "amd"]
        .iter()
        .any(|needle| n.contains(needle));
    if integrated {
        return 2;
    }

    // A real, non-placeholder device we just don't recognize.
    1
}

/// Software / virtual / remote-session adapters GTA would never render on.
fn is_placeholder_adapter(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    [
        "basic display",
        "basic render",
        "remote display",
        "remotefx",
        "rdp",
        "virtual",
        "mirage",
        "parsec",
        "citrix",
        "vmware",
        "virtualbox",
        "meta virtual",
    ]
    .iter()
    .any(|needle| n.contains(needle))
}

/// Query the OS for installed display-adapter names. Windows-only; returns an
/// empty list (so no detection) on other platforms.
#[cfg(windows)]
fn query_adapter_names() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // Don't flash a console window when we shell out.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // CIM/WMI is present on every supported Windows; `wmic` is deprecated and
    // absent on newer Windows 11, so we avoid it.
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(not(windows))]
fn query_adapter_names() -> Vec<String> {
    Vec::new()
}

/// The machine's best-guess GPU name, or `None` if it couldn't be determined.
pub fn detect_gpu_description() -> Option<String> {
    pick_gpu_name(&query_adapter_names())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prefers_discrete_gpu_over_basic_adapter() {
        let names = v(&["Microsoft Basic Display Adapter", "NVIDIA GeForce RTX 4090"]);
        assert_eq!(
            pick_gpu_name(&names),
            Some("NVIDIA GeForce RTX 4090".to_string())
        );
    }

    #[test]
    fn prefers_discrete_nvidia_over_integrated_intel() {
        // The real hybrid-desktop case: the integrated iGPU is enumerated first,
        // but GTA renders on the discrete card — so that name must win even
        // though the Intel adapter appears earlier in the list.
        let names = v(&[
            "Meta Virtual Monitor",
            "Intel(R) UHD Graphics 770",
            "NVIDIA GeForce RTX 3080",
        ]);
        assert_eq!(
            pick_gpu_name(&names),
            Some("NVIDIA GeForce RTX 3080".to_string())
        );
    }

    #[test]
    fn keeps_integrated_gpu_when_thats_all_there_is() {
        let names = v(&["Intel(R) Iris(R) Xe Graphics"]);
        assert_eq!(
            pick_gpu_name(&names),
            Some("Intel(R) Iris(R) Xe Graphics".to_string())
        );
    }

    #[test]
    fn prefers_known_vendor_over_unknown() {
        // Order shouldn't matter: the known vendor wins over an unlabeled one.
        let names = v(&["Some OEM Display Device", "AMD Radeon RX 7900 XTX"]);
        assert_eq!(pick_gpu_name(&names), Some("AMD Radeon RX 7900 XTX".to_string()));
    }

    #[test]
    fn filters_virtual_and_remote_adapters() {
        let names = v(&["Parsec Virtual Display Adapter", "RDP Encoder Mirror Driver"]);
        assert_eq!(pick_gpu_name(&names), None);
    }

    #[test]
    fn falls_back_to_first_non_placeholder_when_no_known_vendor() {
        let names = v(&["Microsoft Basic Display Adapter", "Acme GPU 9000"]);
        assert_eq!(pick_gpu_name(&names), Some("Acme GPU 9000".to_string()));
    }

    #[test]
    fn empty_or_all_placeholder_yields_none() {
        assert_eq!(pick_gpu_name(&[]), None);
        assert_eq!(
            pick_gpu_name(&v(&["Microsoft Basic Display Adapter", "  "])),
            None
        );
    }
}

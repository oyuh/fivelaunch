# FiveLaunch

FiveLaunch is a desktop launcher for **FiveM** that manages multiple isolated client profiles by controlling how FiveM reads mods/plugins/settings on disk.

[![Release](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml/badge.svg)](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml)

![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38BDF8?logo=tailwindcss&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10+-F69220?logo=pnpm&logoColor=white)

Stack: **Tauri 2 (Rust) + Svelte 5 + TypeScript + Tailwind**.

Docs: https://fivelaunch.help
Support: https://fivelaunch.help/support
Releases: https://github.com/oyuh/fivelaunch/releases

> v2 is a ground-up rewrite of the original Electron app (preserved on the
> [`v1` branch](https://github.com/oyuh/fivelaunch/tree/v1)). Same behavior,
> same on-disk data — a ~3 MB native binary instead of ~170 MB, with sub-second
> startup.

---

## Quickstart (Users)

1) Download the latest release and run `FiveLaunch.exe`.
2) On first run, confirm you understand what folders/files will be linked/renamed.
3) In **Settings**, set the **FiveM.app** folder path (example: `%LOCALAPPDATA%\FiveM\FiveM.app`).
4) Create a profile.
5) Enable the features you want for that profile (mods/plugins/citizen/settings).
6) Launch.

---

## Capabilities

- **Multiple client profiles** with per-client linking preferences.
- **Selective linking** for:
  - `mods`
  - `plugins` (junction or copy/sync mode)
  - `citizen`
  - `gta5_settings.xml`
  - `CitizenFX.ini`
- **Automatic backups** on first link (originals renamed with `_original`).
- **Quick launch** from the UI with live progress.
- **Open client folder** directly from the app.
- **Custom window controls** (minimize/maximize/close).

---

## Architecture

- **Rust core** ([src-tauri/src/core/](src-tauri/src/core/)): all filesystem,
  linking, mirroring, and process logic. Framework-agnostic and unit-tested,
  including golden-file tests that keep every on-disk format byte-compatible
  with v1.
- **Command layer** ([src-tauri/src/commands.rs](src-tauri/src/commands.rs)):
  thin `#[tauri::command]` wrappers + background sync state.
- **UI** ([src/](src/)): Svelte 5, talks to Rust through the typed bridge in
  [src/lib/api.ts](src/lib/api.ts); live launch progress via Tauri events.

Key modules:
- Launch pipeline: [src-tauri/src/core/launch.rs](src-tauri/src/core/launch.rs)
- Junction linking + backups: [src-tauri/src/core/linking.rs](src-tauri/src/core/linking.rs)
- Plugins sync engine: [src-tauri/src/core/plugins_sync.rs](src-tauri/src/core/plugins_sync.rs)
- File mirroring: [src-tauri/src/core/mirror.rs](src-tauri/src/core/mirror.rs)

---

## Data model (on disk)

Per-profile storage is under:

```
%APPDATA%\FiveLaunch\clients\<clientId>\
  mods\
  plugins\
  citizen\
  settings\
    gta5_settings.xml
    CitizenFX.ini
```

FiveM targets affected by linking:

- `%LOCALAPPDATA%\FiveM\FiveM.app\mods`
- `%LOCALAPPDATA%\FiveM\FiveM.app\plugins`
- `%LOCALAPPDATA%\FiveM\FiveM.app\citizen`
- `%APPDATA%\CitizenFX\gta5_settings.xml`
- `%APPDATA%\CitizenFX\CitizenFX.ini`

Backups created automatically on first link by renaming originals with `_original`.
Data is fully compatible with v1 — you can switch between versions freely.

---

## Development

### Prerequisites
- **Node.js 20+** and **pnpm 10+**
- **Rust (stable)** with the MSVC toolchain

### Run (Dev)
```powershell
pnpm install
pnpm tauri dev
```

### Tests
```powershell
pnpm test                     # frontend unit + UI component tests (vitest)
pnpm check                    # svelte-check + tsc
cargo test   # from src-tauri/ — Rust unit + v1-compatibility tests
cargo bench  # from src-tauri/ — criterion performance benches
```

### Build (Windows)
```powershell
pnpm tauri build
```

Outputs:
- Portable exe: `src-tauri/target/release/FiveLaunch.exe`
- NSIS installer: `src-tauri/target/release/bundle/nsis/`

---

## Contributing

Pull requests are welcome.

By contributing, you agree that your contribution can be incorporated into FiveLaunch and redistributed by the owner under any terms.
See the license for details.

Open issues here:
- https://github.com/oyuh/fivelaunch/issues

---

## License

This repository is **source-available** under the **FiveLaunch Source-Available License (FiveLaunch-SAL)**.

- You may **view, use, and modify** the code for personal/internal use.
- You may **not redistribute** the code or derivatives (including public forks) without written permission.
- You can share improvements by submitting a **pull request** back to this repository.

See [LICENSE](LICENSE) for the full terms.

---

## Disclaimer

FiveLaunch modifies FiveM client files by linking/replacing folders and settings. Use at your own risk. Always keep backups.

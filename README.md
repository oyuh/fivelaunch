# FiveLaunch

FiveLaunch is a desktop launcher for [FiveM](https://fivem.net) that lets you keep multiple, fully isolated client setups on one machine. Each setup ("client") has its own mods, plugins, citizen overrides, and settings, and FiveLaunch swaps them in and out by controlling what FiveM actually reads on disk at launch time.

[![Release](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml/badge.svg)](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml)

![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38BDF8?logo=tailwindcss&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-FBF0DF?logo=bun&logoColor=black)

**Stack:** Tauri 2 (Rust) + Svelte 5 + TypeScript + Tailwind + Bun

| | |
|---|---|
| Docs | https://fivelaunch.help |
| Support | https://fivelaunch.help/support |
| Downloads | https://github.com/oyuh/fivelaunch/releases |
| Issues | https://github.com/oyuh/fivelaunch/issues |

> **v2 is a ground-up rewrite** of the original Electron app (still available on the [`v1` branch](https://github.com/oyuh/fivelaunch/tree/v1)). Behavior and on-disk data are the same, but the binary is roughly 3 MB native instead of ~170 MB, and startup is sub-second. You can move between v1 and v2 without touching your data.

---

## How it works

FiveM reads mods, plugins, and settings from a fixed set of folders and files on your machine. Instead of copying those around every time you want a different setup, FiveLaunch stores each client's files in its own directory and then, at launch, points FiveM's real paths at the client you picked.

The linking is done with **NTFS junctions** wherever possible, so switching clients is effectively instant and costs no extra disk space (no duplicate copies of your mods folder). Anything FiveLaunch has to move out of the way first (an existing real folder, a settings file) goes into a **central backup store** you can browse and restore from later, rather than being left as loose `_original` files scattered next to your game.

Plugins are a special case because the running game sometimes writes back into that folder. You get two modes per client:

- **Junction mode** (default): the game's `plugins` folder becomes a link to the client. Instant, zero-copy.
- **Sync mode**: `plugins` stays a real folder owned by one client. FiveLaunch mirrors client to game before launch, does a conservative game to client sync of safe file types while you play, then a final pass on exit. Use this if a plugin misbehaves when its folder is a junction.

If you want a full walkthrough with screenshots, the [docs site](https://fivelaunch.help) is the place to go.

---

## Quickstart

1. Grab the latest [release](https://github.com/oyuh/fivelaunch/releases) and run the installer.
2. On first run, confirm you understand which folders and files FiveLaunch will link and move aside.
3. In **Settings**, set your **FiveM.app** folder (for example `%LOCALAPPDATA%\FiveM\FiveM.app`).
4. Create a client.
5. Toggle on the features you want for that client: mods, plugins, citizen, settings.
6. Launch.

From then on, switching setups is: pick a client, hit launch.

---

## Features

- **Multiple isolated clients**, each with its own linking preferences.
- **Selective linking** per client for `mods`, `plugins` (junction or sync mode), `citizen`, `gta5_settings.xml`, and `CitizenFX.ini`. Turn on only what you want that client to control.
- **Snapshot / "My Setup"** captures your current live FiveM files into a fresh client without duplicating them (real folders are moved in, the live location becomes a junction). Restore returns FiveM to that baseline after any session.
- **Central backup store**: anything moved aside lands in `%APPDATA%\FiveLaunch\backups\`, browsable and restorable from the History dialog.
- **ReShade sync**: discovers your ReShade config, presets, and logs, keeps client-owned copies, and syncs them for the active client.
- **Quick launch** from the UI with live progress, or from a **desktop shortcut** (`FiveLaunch.exe --launch-client=<id>`), which is single-instance safe.
- **GTA V settings editor** with categorized, human-readable controls instead of raw XML. **Import from game** reads your real `Documents\Rockstar Games\GTA V\settings.xml`, and every saved/applied file keeps your GPU name (`VideoCardDescription`) — pulled from your real settings, or auto-detected from your hardware (preferring the discrete GPU) when none exists yet — so GTA actually applies the graphics instead of re-detecting and resetting them.
- **Minimize to tray** while you play, with automatic restore when the game exits.
- **In-app updates** via the Tauri updater, sourced from signed GitHub releases.
- **Open a client's folder** straight from the app, and **custom window controls** (minimize / maximize / close).

---

## Architecture

The split is deliberate: all the risky filesystem and process logic lives in Rust and is unit-tested in isolation, and the Svelte UI never touches disk directly.

- **Rust core** ([`src-tauri/src/core/`](src-tauri/src/core/)): every bit of filesystem, linking, mirroring, and process logic. Framework-agnostic and unit-tested, including golden-file tests that keep every on-disk format byte-compatible with v1.
- **Command layer** ([`src-tauri/src/commands.rs`](src-tauri/src/commands.rs)): thin `#[tauri::command]` wrappers over the core, plus background sync state.
- **UI** ([`src/`](src/)): Svelte 5, talking to Rust through the typed bridge in [`src/lib/api.ts`](src/lib/api.ts). Live launch progress arrives over Tauri events.

Modules worth knowing:

| Module | Responsibility |
|---|---|
| [`core/launch.rs`](src-tauri/src/core/launch.rs) | The launch pipeline: link everything, kick off syncs, start the game |
| [`core/linking.rs`](src-tauri/src/core/linking.rs) | Junction linking and moving originals into the backup store |
| [`core/plugins_sync.rs`](src-tauri/src/core/plugins_sync.rs) | Copy/sync plugins mode with an mtime cache and in-game syncing |
| [`core/mirror.rs`](src-tauri/src/core/mirror.rs) | The general file-mirroring engine (skew windows, content-compare tiebreaks) |
| [`core/snapshot.rs`](src-tauri/src/core/snapshot.rs) | Capture and restore of the "My Setup" baseline client |
| [`core/reshade.rs`](src-tauri/src/core/reshade.rs) | ReShade config/preset/log discovery and sync planning |
| [`core/backups.rs`](src-tauri/src/core/backups.rs) | Central backup store used by the History dialog |

---

## Data model (on disk)

Each client is stored under:

```
%APPDATA%\FiveLaunch\clients\<clientId>\
  mods\
  plugins\
  citizen\
  settings\
    gta5_settings.xml
    CitizenFX.ini
```

At launch, FiveLaunch links or writes these FiveM targets to match the active client:

- `%LOCALAPPDATA%\FiveM\FiveM.app\mods`
- `%LOCALAPPDATA%\FiveM\FiveM.app\plugins`
- `%LOCALAPPDATA%\FiveM\FiveM.app\citizen`
- `%APPDATA%\CitizenFX\gta5_settings.xml`
- `%APPDATA%\CitizenFX\CitizenFX.ini`

Anything that has to be moved aside goes to the central backup store:

```
%APPDATA%\FiveLaunch\backups\<kind>_<epochMs>\
```

The on-disk format is fully compatible with v1, so you can switch between the two versions freely.

---

## Development

### Prerequisites

- **Bun 1.x**
- **Rust (stable)** with the MSVC toolchain

### Run in dev

```powershell
bun install
bun run tauri dev
```

There is also a no-build UI preview harness for working on the frontend in isolation:

```powershell
bun run ui
```

### Tests

```powershell
bun run test     # frontend unit + component tests (vitest)
bun run check    # svelte-check + tsc

# from src-tauri/
cargo test       # Rust unit tests + v1-compatibility golden tests
cargo bench      # criterion performance benchmarks
```

### Build (Windows)

```powershell
bun run tauri build
```

The release target is a signed **NSIS installer**, produced under `src-tauri/target/release/bundle/nsis/`. The raw `FiveLaunch.exe` at `src-tauri/target/release/` is a build byproduct and is not the distributed artifact.

---

## Documentation

Full user and reference docs live at **[fivelaunch.help](https://fivelaunch.help)**. If you get stuck or hit a bug, start at [Support](https://fivelaunch.help/support), then open an [issue](https://github.com/oyuh/fivelaunch/issues).

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, what the review bar is, and the licensing terms that apply to submissions.

The short version: this project is source-available (not open-source), and by contributing you agree your changes can be redistributed as part of FiveLaunch. Details are in the license.

---

## License

Source-available under the **FiveLaunch Source-Available License (FiveLaunch-SAL)**.

- You **may** view, use, and modify the code for personal or internal use.
- You **may not** redistribute the code or derivatives (including public forks) without written permission.
- You **can** share improvements by opening a pull request back to this repository.

Full terms in [LICENSE](LICENSE).

---

## Disclaimer

FiveLaunch modifies FiveM client files by linking and replacing folders and settings. Use at your own risk, and keep your own backups of anything you care about.

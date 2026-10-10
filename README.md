# FiveLaunch

FiveLaunch is a Windows desktop launcher for [FiveM](https://fivem.net) that keeps multiple isolated client setups on one machine. Each client has its own mods, plugins, citizen overrides, and settings. At launch, FiveLaunch points FiveM's real folders at the client you picked.

[![Release](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml/badge.svg)](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38BDF8?logo=tailwindcss&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-FBF0DF?logo=bun&logoColor=black)

[Docs](https://fivelaunch.help) · [Support](https://fivelaunch.help/support) · [Downloads](https://github.com/oyuh/fivelaunch/releases) · [Issues](https://github.com/oyuh/fivelaunch/issues)

> v2 is a rewrite of the original Electron app, which still lives on the [`v1` branch](https://github.com/oyuh/fivelaunch/tree/v1). The on-disk data is the same, so you can switch between v1 and v2 without touching your clients. The v2 binary is about 3 MB instead of 170 MB and starts in under a second.

## Quickstart

1. Download the latest [release](https://github.com/oyuh/fivelaunch/releases) and run the installer.
2. On first run, confirm which folders and files FiveLaunch will link and move aside.
3. In **Settings**, set your `FiveM.app` folder, for example `%LOCALAPPDATA%\FiveM\FiveM.app`.
4. Create a client.
5. Turn on the parts you want that client to control: mods, plugins, citizen, settings.
6. Launch.

After that, switching setups means picking a client and pressing launch. The [docs site](https://fivelaunch.help) has a full walkthrough with screenshots.

<details>
<summary><b>How it works</b></summary>

<br>

FiveM reads mods, plugins, and settings from fixed folders and files. FiveLaunch stores each client's files in its own directory and links FiveM's paths to the active client at launch.

It uses NTFS junctions wherever it can, so switching clients takes no time and no extra disk space. When FiveLaunch has to move something out of the way first, like an existing folder or a settings file, it puts it in a central backup store you can browse and restore from. You won't find loose `_original` files next to your game.

Plugins get two modes per client, because the running game sometimes writes into that folder:

- **Junction mode** (default) links the game's `plugins` folder to the client. No copying.
- **Sync mode** keeps `plugins` as a real folder. FiveLaunch mirrors client files to the game before launch, syncs safe file types back while you play, and runs a final pass on exit. Use it when a plugin breaks inside a junction.

</details>

<details>
<summary><b>Features</b></summary>

<br>

- Multiple isolated clients, each with its own linking preferences.
- Per-client linking for `mods`, `plugins` (junction or sync), `citizen`, `gta5_settings.xml`, and `CitizenFX.ini`. Turn on only what that client should own.
- **My Setup** snapshots your current FiveM files into a new client without duplicating them. FiveLaunch moves the real folders in and leaves a junction behind. Restore returns FiveM to that baseline after any session.
- A central backup store at `%APPDATA%\FiveLaunch\backups\`, browsable and restorable from the History dialog.
- ReShade sync finds your ReShade config, presets, and logs, keeps a copy per client, and syncs them for the active one.
- Launch from the UI with live progress, or from a desktop shortcut (`FiveLaunch.exe --launch-client=<id>`). The shortcut is single-instance safe.
- A GTA V settings editor with labeled controls instead of raw XML. **Import from game** reads your real `Documents\Rockstar Games\GTA V\settings.xml`. Saved files keep your GPU name (`VideoCardDescription`), taken from your settings or detected from your hardware, so GTA applies your graphics instead of resetting them.
- Minimize to tray while you play. The window comes back when the game exits.
- In-app updates from signed GitHub releases.

</details>

<details>
<summary><b>Architecture</b></summary>

<br>

All filesystem and process logic lives in Rust with unit tests. The Svelte UI never touches disk.

- **Rust core** ([`src-tauri/src/core/`](src-tauri/src/core/)) handles linking, mirroring, backups, and launching. Golden-file tests keep every on-disk format byte-compatible with v1.
- **Command layer** ([`src-tauri/src/commands.rs`](src-tauri/src/commands.rs)) wraps the core in `#[tauri::command]` functions and holds background sync state.
- **UI** ([`src/`](src/)) is Svelte 5. It calls Rust through the typed bridge in [`src/lib/api.ts`](src/lib/api.ts) and receives launch progress as Tauri events.

| Module | Responsibility |
|---|---|
| [`core/launch.rs`](src-tauri/src/core/launch.rs) | Launch pipeline: link everything, start syncs, start the game |
| [`core/linking.rs`](src-tauri/src/core/linking.rs) | Junction linking and moving originals into the backup store |
| [`core/plugins_sync.rs`](src-tauri/src/core/plugins_sync.rs) | Plugins sync mode with an mtime cache and in-game syncing |
| [`core/mirror.rs`](src-tauri/src/core/mirror.rs) | File mirroring with skew windows and content-compare tiebreaks |
| [`core/snapshot.rs`](src-tauri/src/core/snapshot.rs) | Capture and restore of the My Setup baseline client |
| [`core/reshade.rs`](src-tauri/src/core/reshade.rs) | ReShade config, preset, and log discovery and sync planning |
| [`core/backups.rs`](src-tauri/src/core/backups.rs) | Central backup store behind the History dialog |

</details>

<details>
<summary><b>Data on disk</b></summary>

<br>

Each client lives under:

```text
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

Anything moved aside goes to `%APPDATA%\FiveLaunch\backups\<kind>_<epochMs>\`. The format matches v1 exactly.

</details>

<details>
<summary><b>Development</b></summary>

<br>

You need Bun 1.x and stable Rust with the MSVC toolchain.

```powershell
bun install
bun run tauri dev     # full app
bun run ui            # UI only, in a browser, against a mocked backend
```

Run the checks:

```powershell
bun run test          # vitest unit and component tests
bun run check         # svelte-check + tsc

# from src-tauri/
cargo test            # Rust unit tests and v1 golden tests
cargo bench           # criterion benchmarks
```

Build the signed NSIS installer:

```powershell
bun run tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. The raw `FiveLaunch.exe` in `src-tauri/target/release/` is a build byproduct, not the release artifact.

</details>

## Contributing

Pull requests are welcome. Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup, the review bar, and the terms that apply to submissions. If you hit a bug, start at [Support](https://fivelaunch.help/support), then open an [issue](https://github.com/oyuh/fivelaunch/issues).

## License

FiveLaunch is source-available under the FiveLaunch Source-Available License (FiveLaunch-SAL), not open source. You may view, use, and modify the code for personal or internal use. You may not redistribute it or derivatives, including public forks, without written permission. Send improvements back as a pull request. Full terms are in [LICENSE](LICENSE).

FiveLaunch modifies FiveM client files by linking and replacing folders and settings. Keep your own backups of anything you care about.

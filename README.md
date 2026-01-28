# FiveLaunch

FiveLaunch is a desktop launcher for **FiveM** that manages multiple isolated client profiles by controlling how FiveM reads mods/plugins/settings on disk.

[![Release](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml/badge.svg)](https://github.com/oyuh/fivelaunch/actions/workflows/release.yml)

![Electron](https://img.shields.io/badge/Electron-28+-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=0B1B2B)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.x-38BDF8?logo=tailwindcss&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10+-F69220?logo=pnpm&logoColor=white)

Stack: **Electron + TypeScript + React + Tailwind + shadcn/ui**.

Docs: https://fivelaunch.help
Support: https://fivelaunch.help/support
Releases: https://github.com/oyuh/fivelaunch/releases

---

## Quickstart (Users)

1) Download the latest release and run `FiveLaunch.exe`.
2) On first run, confirm you understand what folders/files will be linked/renamed.
3) In **Settings**, set the **FiveM.app** folder path (example: `%LOCALAPPDATA%\FiveM\FiveM.app`).
4) Create a profile.
5) Enable the features you want for that profile (mods/plugins/citizen/settings).
6) Launch.

Minimize-to-tray behavior:
- If **minimize to tray on game launch** is enabled, the app will hide while FiveM is running and restore when the game closes.

---

## Capabilities

- **Multiple client profiles** with per‑client linking preferences.
- **Selective linking** for:
  - `mods`
  - `plugins`
  - `citizen`
  - `gta5_settings.xml`
  - `CitizenFX.ini`
- **Automatic backups** on first link (original folders and files are renamed with `_original`).
- **Quick launch** from the UI.
- **Open client folder** directly from the app.
- **Custom window controls** (minimize/maximize/close).

---

## Architecture

FiveLaunch is split into three layers:

- **Main process (Electron)**: owns windows, tray, filesystem operations, and all linking/sync logic.
- **Preload**: exposes a constrained IPC API to the renderer.
- **Renderer (React)**: UI only; it calls `window.api.*` and renders progress/logs.

Key entrypoints:
- Main bootstrap: [src/main/index.ts](src/main/index.ts)
- IPC surface: [src/main/app/ipc.ts](src/main/app/ipc.ts)
- Window creation: [src/main/app/window.ts](src/main/app/window.ts)
- Game launch/linking: [src/main/managers/GameManager.ts](src/main/managers/GameManager.ts)
- Plugins sync implementation: [src/main/managers/gameManager/pluginsLaunch.ts](src/main/managers/gameManager/pluginsLaunch.ts)
- Preload API bridge: [src/preload/index.ts](src/preload/index.ts)

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

---

## Linking + sync behavior

- Directories are linked using **junctions** on Windows.
- Settings files (`gta5_settings.xml`, `CitizenFX.ini`) are linked using file links.
- Plugins can run in **junction mode** or **sync/copy mode** (see `LinkOptions.pluginsMode` in [src/main/types.ts](src/main/types.ts)).

Plugins sync (copy mode):
- While the game runs, only a safe subset of files are synced back.
- After the game closes, a short **finalizing sync** may run to copy back changes.

---

## First‑Run Safety

FiveLaunch shows a first‑run modal that explains what you should back up before linking.

**Files/Folders affected:**
- `%LOCALAPPDATA%\FiveM\FiveM.app\mods`
- `%LOCALAPPDATA%\FiveM\FiveM.app\plugins`
- `%LOCALAPPDATA%\FiveM\FiveM.app\citizen`
- `%APPDATA%\CitizenFX\gta5_settings.xml`
- `%APPDATA%\CitizenFX\CitizenFX.ini`

**Backups created automatically:**
- `mods_original`, `plugins_original`, `citizen_original`
- `gta5_settings.xml_original`, `CitizenFX.ini_original`

---

## Development

### Prerequisites
- **Node.js 20+**
- **pnpm 10+**

### Install
```bash
pnpm install
```

### Run (Dev)
```bash
pnpm dev
```

### Typecheck
```bash
pnpm typecheck
```

### Build (Windows)
```bash
pnpm build:win
```

### Build (macOS)
```bash
pnpm build:mac
```

### Build (Linux)
```bash
pnpm build:linux
```

Build artifacts are placed under:
- `dist/`

Useful docs:
- Release process: [docs/RELEASING.md](docs/RELEASING.md)
- Docs index: [docs/README.md](docs/README.md)
- Release CLI: [scripts/release.js](scripts/release.js)
- Tagging CLI: [scripts/tag-release.js](scripts/tag-release.js)

---

## Resources

Place icons in the `resources/` folder:

- `resources/Logo-Full.ico` (Windows)
- `resources/Logo.png` (Linux / dev window icon)
- `resources/Logo.svg` (optional for web previews)

**Recommended sizes:**
- `.ico`: 256×256 or 512×512
- `.png`: 512×512
- `.icns`: 512×512 (if you add macOS)

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

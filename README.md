# FiveLaunch

FiveLaunch is a desktop launcher for **FiveM** that lets you manage multiple client profiles, selectively link mods/plugins/settings per profile, and launch FiveM with a single click.

It is built with **Electron + TypeScript + React + Tailwind + shadcn/ui** and designed to keep your data safe by backing up originals before linking.

---

## ✨ Features

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

## 🧭 First‑Run Safety

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

## 📦 Download

Once you build or download a release, you’ll get a **portable Windows build**:
- **FiveLaunch.exe**

GitHub Releases:
- https://github.com/oyuh/fivelaunch/releases

Support:
- https://fivelaunch.help/support

---

## 🚀 Quickstart (Users)

1) Download the latest release and run `FiveLaunch.exe`.
2) On first run, read the safety notes and confirm you have backups.
3) Set your **FiveM.app** folder path in **Settings**.
4) Create a client profile.
5) Choose what you want linked (mods/plugins/citizen/settings) for that profile.
6) Launch.

### Minimize to tray on launch

If you enable **minimize to tray on game launch**, the app will hide while FiveM is running and pop back when the game closes.

---

---

## 🛠️ Development

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

---

## 🖼️ App Icons / Resources

Place icons in the `resources/` folder:

- `resources/Logo-Full.ico` (Windows)
- `resources/Logo.png` (Linux / dev window icon)
- `resources/Logo.svg` (optional for web previews)

**Recommended sizes:**
- `.ico`: 256×256 or 512×512
- `.png`: 512×512
- `.icns`: 512×512 (if you add macOS)

---

## 🔗 Link Behavior (Technical)

FiveLaunch uses symlinks/junctions to “swap” data:
- Directories are linked using **junctions** on Windows.
- Settings files (`gta5_settings.xml`, `CitizenFX.ini`) are linked using file links.

Each client has its own storage:
```
%APPDATA%\FiveLaunch\clients\<clientId>\
  mods\
  plugins\
  citizen\
  settings\
    gta5_settings.xml
    CitizenFX.ini
```

### Plugins sync (copy mode)

When plugins are in **sync/copy** mode, FiveLaunch may do a short “finalizing sync” after the game closes to safely copy back changes.

---

---

## 🤝 Contributing

Pull requests are welcome.

By contributing, you agree that your contribution can be incorporated into FiveLaunch and redistributed by the owner under any terms.
See the license for details.

Open issues here:
- https://github.com/oyuh/fivelaunch/issues

---

## © License

This repository is **source-available** under the **FiveLaunch Source-Available License (FiveLaunch-SAL)**.

- You may **view, use, and modify** the code for personal/internal use.
- You may **not redistribute** the code or derivatives (including public forks) without written permission.
- You can share improvements by submitting a **pull request** back to this repository.

See [LICENSE](LICENSE) for the full terms.

---

## ⚠️ Disclaimer

FiveLaunch modifies FiveM client files by linking/replacing folders and settings. Use at your own risk. Always keep backups.

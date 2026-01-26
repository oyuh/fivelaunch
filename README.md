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

---

## 🤝 Contributing

Pull requests are welcome.

Open issues here:
- https://github.com/oyuh/fivelaunch/issues

---

## © License

This project is open source. Choose a license and add it to this repo.

---

## ⚠️ Disclaimer

FiveLaunch modifies FiveM client files by linking/replacing folders and settings. Use at your own risk. Always keep backups.

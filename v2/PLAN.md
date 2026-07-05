# FiveLaunch 2.0 — Rust + Svelte Rewrite Plan

Goal: rewrite FiveLaunch as a **Tauri 2 (Rust)** app with a **Svelte 5** frontend that behaves
exactly like the current Electron app, but starts faster, uses a fraction of the memory, and
ships as a tiny binary.

---

## 1. Where the speed actually comes from

Being honest about what Rust buys us, so we optimize the right things:

| Pain today (Electron) | After (Tauri/Rust) |
| --- | --- |
| ~150–250 MB RAM at idle (Chromium + Node) | ~40–80 MB (system WebView2 + native core) |
| Cold start slow enough that we ship a splash window | Sub-second start; splash likely deletable |
| ~200+ MB installed footprint / large portable exe | ~5–15 MB single binary (WebView2 is preinstalled on Win 10/11) |
| `tasklist` subprocess spawned every ~1s to poll for FiveM.exe/GTA5.exe (exit watcher, sync loops, ReShade loops) | Native process enumeration via `sysinfo` — no subprocess spawns, microseconds per check |
| Single-threaded JS file mirroring with manual `setImmediate` yielding and time budgets | Multithreaded mirror (rayon/tokio); no event-loop starvation, so the "yield every N files" machinery disappears |
| `fs.watch` + debounce hand-rolled | `notify` crate (ReadDirectoryChangesW) + debouncer |

The launch pipeline itself is disk-IO-bound, so linking won't get 100x faster — but repeat-launch
plugin syncs (mtime-cache scans over thousands of files) and all the background polling loops get
meaningfully cheaper, and the app itself gets dramatically lighter.

---

## 2. Target stack

**Core**
- **Tauri 2.x** — app shell, window, tray, IPC, bundling, single-instance, autostart args
- **Rust** (edition 2021+), tokio (ships with Tauri)

**Frontend**
- **Svelte 5** (runes) + TypeScript + Vite
- **Tailwind CSS** (port existing config/theme; Geist Sans/Mono via the same @fontsource packages)
- **shadcn-svelte** (direct analog of the current shadcn/ui components: button, card, dialog, input, tooltip)
- **lucide-svelte** (same icon set as lucide-react)

**Key Rust crates**
| Concern | Today (Node) | Crate |
| --- | --- | --- |
| Junctions | `fs.symlinkSync(src, dst, 'junction')` | `junction` (no admin needed, same as today) |
| File watching | `fs.watch` on parent dirs | `notify` + `notify-debouncer-mini` |
| Recursive walks / mirror | hand-rolled generators | `walkdir` (+ `rayon` for parallel copy) |
| Process checks | `tasklist` exec + TTL cache | `sysinfo` (refresh only process list) |
| Detached spawn | `child.unref()` | `std::process::Command` + `DETACHED_PROCESS`/`CREATE_NEW_PROCESS_GROUP` flags |
| XML (gta5_settings.xml) | `fast-xml-parser` | `quick-xml` (manual walk, mirrors current doc model) |
| JSON configs | `JSON.parse/stringify` | `serde` / `serde_json` |
| .lnk desktop shortcuts | `shell.writeShortcutLink` | `mslnk` crate, or `windows` crate IShellLink COM |
| Update check | GitHub releases fetch | `reqwest` (keep notify-only) or `tauri-plugin-updater` later |
| FNV-1a 32 hash | hand-rolled | trivial 10-line Rust fn (keep identical output — it's used in on-disk paths) |
| File dialogs | `dialog.showOpenDialog` | `tauri-plugin-dialog` |
| Open folders/URLs | `shell.openPath/openExternal` | `tauri-plugin-opener` |
| Typed IPC bindings | hand-written `window.api` + env.d.ts | `tauri-specta` (generates TS types from Rust commands) |

---

## 3. What must be ported (full backend inventory)

Everything in `src/main/**` — grouped by subsystem, with the behaviors that MUST be preserved:

### 3.1 Paths & discovery (`utils/paths.ts`)
- App data root, `clients/` dir, `clients.json`, `settings.json`
- FiveM.app resolution: settings override → `%LOCALAPPDATA%\FiveM\FiveM.app`
- FiveM.exe = sibling of FiveM.app
- CitizenFX dir, `CitizenFX.ini`, `gta5_settings.xml` candidates (Roaming, Local, FiveM.app, Documents, OneDrive)

### 3.2 Client profiles (`ClientManager.ts`)
- CRUD over `clients.json` (**same JSON shape** — `{ clients: [...], selectedClientId }`)
- Folder scaffolding: `mods/`, `plugins/`, `citizen/`, `settings/` + placeholder files
- Delete = remove folder recursively
- Stats: recursive file count + bytes, skipping symlinks

### 3.3 App settings (`SettingsManager.ts`)
- `settings.json`: `gamePath`, `minimizeToTrayOnGameLaunch`, `themePrimaryHex` (hex validation, lowercase normalize)

### 3.4 Linking engine (`linking.ts`, `fsRetry.ts`)
- Junction replace with `_original` backup on first link, `_backup_<ts>` rotation if backup exists
- Optional non-destructive merge of existing target into client folder (`migrateExisting`)
- Rename-with-retry (transient lock tolerance) with clear "close FiveM/overlays" errors

### 3.5 Plugins launch (`pluginsLaunch.ts`, `pluginsMirror.ts`) — the most intricate piece
- Two modes: **junction** and **sync (copy)** — default sync
- Sync mode:
  - `.managed-by-fivem-clients` marker + `.fivelaunch-plugins-owner.json` ownership stamping
  - Isolation: rotate away unmanaged/foreign-client plugin dirs (`_managed_<fnvhash>_backup_<ts>` / `_unmanaged_backup_<ts>`)
  - Launch mirror client→game, **source-wins**, with persisted mtime cache
    (`settings/plugins-cache-client-to-game.json` — keep format compatible)
  - Runtime loop (10s, max 6h): game→client mirror of **safe files only** (.ini/.log/.cfg/.txt), capped per tick
  - On game exit: finalizing sync (up to 5000 files) + **busy state** exposed to UI; new launches must await pending finalization
- Junction mode: link + ownership marker, no background processes while game runs
- Mirror semantics: 900ms mtime skew window, content-compare tiebreak, best-effort copies that tolerate locks, never traverse into symlinks

### 3.6 ReShade sync (`reshadeSync.ts`, `reshadeMonitor.ts`, `reshadeLogging.ts`)
- Heuristic discovery of `ReShade.ini` / `ReShadePreset.ini` / `ReShade.log` across: FiveM dirs, plugins, GTA install candidates (from CitizenFX.ini + common Steam/Rockstar/Epic paths), `%APPDATA%/%LOCALAPPDATA%\ReShade`
- Log-tail parsing to extract real config/preset paths
- Per-source shadow copies under `settings/reshade/sources/<fnv1a32(path)>/` + two-way sync while game runs
- Preset path resolution from INI (`PresetPath`/`CurrentPresetPath`, relative path handling)
- Diagnostics: `last-scan.json`, snapshot logging, file monitors (can be simplified in v2, but keep the log file — it's the support/debug story)

### 3.7 GTA settings (`GtaSettingsManager.ts`, `gtaSettings.ts`, `shared/gtaSettingsMap.ts`)
- XML ⇄ `GtaSettingsDocument { rootName, items: [{ path, attributes }] }` — **keep this exact JSON shape** so the settings dialog UI ports 1:1
- `configSource = SMC_USER` injection, empty-attribute stripping, self-closing tags, XML declaration
- Legacy `settings.xml` → `gta5_settings.xml` migration; template fallback (`resources/settings-template.xml`)
- Apply to all targets (CitizenFX Roaming, FiveM.app, CitizenFX Local) with `.backup` copies
- `fivem_sdk.cfg` backup/removal before launch
- **Enforcement loop**: every 750ms for 3 min, re-apply if a target diverges (stat-signature fast path)
- `shared/gtaSettingsMap.ts` (labels/categories for the dialog) moves to the Svelte side as-is

### 3.8 CitizenFX.ini
- Seed real INI from client at launch (client wins), two-way sync while app open (not in junction mode)

### 3.9 Runtime sync engine (`runtimeSync.ts`)
- Owns watchers + intervals; `stopAll()` between launches
- Dir-level watching (survives atomic save/rename), 350ms debounce, prefer-newest loops with final pass after game exit
- Rust shape: a `RuntimeSync` struct in Tauri managed state holding `notify` watcher handles + tokio task `JoinHandle`s/CancellationTokens

### 3.10 Launch orchestration (`GameManager.ts`)
- Refuse launch while GTA5.exe/FiveM.exe running; await pending plugin finalization
- Order: mods link → plugins setup → ReShade sync → citizen link → GTA settings → CitizenFX.ini → spawn FiveM detached → start enforcement
- Status callback streaming → **Tauri event** `launch-status`
- Busy state query

### 3.11 App shell (`window.ts`, `tray.ts`, `logging.ts`, `args.ts`, `assets.ts`, `startup.ts`, `updateChecker.ts`, `ipc.ts`)
- Frameless window + custom titlebar (Tauri: `decorations: false` + `data-tauri-drag-region`), min/max/close commands
- Tray with restore; minimize-to-tray on launch; **restore-on-game-exit watcher** (sysinfo poll, 60s grace before giving up if game never seen)
- Splash: likely **delete** (Tauri cold start is fast); keep a lightweight in-window skeleton if wanted
- App log store: ring buffer (cap ~1000), console mirror → `tracing` subscriber that forwards to store + emits `app-log` events (batching optional — native events are cheap)
- CLI arg `--launch-client=<id>` auto-launch + `tauri-plugin-single-instance` (forward args to running instance — nicer than today)
- Desktop shortcut creation (sanitize filename, icon, args)
- GitHub releases update check with 15-min cache (notify-only, same as today)
- DevTools lockdown: Tauri only includes devtools in debug builds by default — free

### 3.12 IPC surface (~35 commands + 2 event streams)
Every `window.api.*` call maps 1:1 to a `#[tauri::command]`; `launch-status` and `app-log`
become Tauri events. Generate TS bindings with `tauri-specta` so the Svelte side gets the same
typed API the React side has via `env.d.ts` today.

---

## 4. Critical compatibility contract

Users must be able to drop the new exe in and keep everything:

1. **Data dir**: Electron `userData` = `%APPDATA%\fivelaunch`. Tauri defaults to
   `%APPDATA%\<bundle identifier>`. **Configure/override Tauri's app data dir to the existing
   folder** (resolve `%APPDATA%\fivelaunch` manually in the paths module rather than using
   Tauri's default) — zero-migration upgrade.
2. **File formats**: `clients.json`, `settings.json`, plugin mtime caches, owner markers,
   `_original` backup naming, FNV-1a hex output (used in `reshade/sources/<hash>/` dirs) — all
   byte/semantics compatible. Write Rust unit tests that parse real files produced by v1.
3. **On-disk side effects**: junction targets, backup naming, marker files — identical, so v1 and
   v2 can be used interchangeably during the beta period.
4. Keep app id `com.lawsonhart.fivelaunch`, product name `FiveLaunch`, portable-exe artifact name.

---

## 5. Phases

### Phase 0 — Scaffold (small)
- New repo layout in this repo: `src-tauri/` (Rust) + `src/` (Svelte) — or a `v2/` dir/branch first
- `pnpm create tauri-app` with Svelte 5 + TS template; Tailwind; shadcn-svelte init; port
  `tailwind.config.js`, `index.css` theme vars, Geist fonts, primary-hex theming (`lib/theme.ts`)
- Frameless window, icon, tray stub, min/max/close commands + custom TitleBar port — get the shell
  looking right first

### Phase 1 — Core crate: paths, settings, clients (small/medium)
- `paths.rs`, `settings.rs`, `clients.rs` with serde models matching v1 JSON exactly
- Commands: get/create/delete/rename client, link options update, stats, get/set settings,
  browse dialog, open-folder commands, app version
- **Milestone: UI lists/creates/renames clients against real v1 data**

### Phase 2 — Linking + launch happy path (medium)
- `linking.rs` (junction + `_original` backups + retry), `process.rs` (sysinfo + detached spawn)
- Minimal launch: mods/citizen link → spawn FiveM → `launch-status` events
- **Milestone: can actually launch a profile with mods**

### Phase 3 — Plugins sync + runtime sync (large — the hard part)
- `mirror.rs` (walkdir-based, mtime skew + content tiebreak + persisted cache), `plugins.rs`
  (markers, isolation, sync/junction modes), `runtime_sync.rs` (notify watchers, debounce,
  prefer-newest loops, cancellation), busy-state + finalization gating
- Model background work as tokio tasks owned by a managed `LaunchState`; `stop_all()` aborts
- **Milestone: sync-mode parity — run v1 and v2 against the same profile and diff the results**

### Phase 4 — GTA settings + CitizenFX.ini + ReShade (medium/large)
- `gta_settings.rs` (quick-xml walk ⇄ same document JSON), enforcement loop, targets, sdk.cfg handling
- `reshade.rs` — port discovery heuristics; keep diagnostics logging; consider trimming the
  monitor/snapshot verbosity (it's debug tooling — decide what v2 support workflow needs)
- Settings dialog + gtaSettingsMap port on the Svelte side

### Phase 5 — Full UI port (medium — it's a small UI)
Component-by-component React → Svelte 5:
`TitleBar`, `ClientListCard`, `ClientOverviewCard`, `LaunchProgress`, `LogsPanel`, `AppFooter`,
`ActionTile`, dialogs (`FirstRun`, `CreateClient`, `ClientDetails`, `LinkOptions`, `GtaSettings`,
`Refs`), toasts. `App.tsx` state (~30 KB) becomes a couple of `$state` stores — Svelte will
shrink this a lot. Wire `launch-status`/`app-log` event listeners.

### Phase 6 — Shell polish (small)
- Single instance + `--launch-client` forwarding, desktop shortcuts, update checker,
  minimize-to-tray + restore-on-exit watcher, first-run dialog logic

### Phase 7 — Packaging, CI, cutover (medium)
- Tauri bundler: portable exe (the raw binary) + optional NSIS installer; keep `FiveLaunch.exe` name
- Port `.github/workflows/release.yml` to `tauri-action`; keep tag/release scripts
- Beta releases side-by-side with v1 (same data dir is safe by design — see §4)
- Update README/docs, bump to 2.0.0, retire the Electron tree once stable

Suggested order of "first real win": after Phase 2 you have a usable fast launcher for
junction-mode users; Phases 3–4 reach full parity.

---

## 6. Risks & gotchas

- **WebView2**: preinstalled on Win 10/11 — non-issue for the FiveM audience; bundler can embed
  the evergreen installer as fallback.
- **Svelte learning curve**: small UI, shadcn-svelte mirrors shadcn/ui — low risk.
- **Behavioral drift in sync logic**: the mirror/isolation/enforcement code encodes a lot of
  hard-won edge cases (locked files, atomic saves, mtime skew, cross-client leakage). Port it
  literally first, optimize second. Golden-file tests + running v1/v2 against the same profile
  are the safety net.
- **Detached spawn**: verify FiveM launches cleanly with no console window and that the launcher
  holds no handle (CREATE_NO_WINDOW + DETACHED_PROCESS).
- **fs.watch → notify**: same OS primitive, but event granularity differs; keep dir-level watching
  + debounce to preserve atomic-save handling.
- **Long-running finalization after command returns**: Tauri commands return, but the finalizing
  sync keeps running — same as today; expose it via busy-state polling or (better) a
  `plugins-busy` event.
- **Don't rewrite in place on master**: do it on a `v2-tauri` branch or `v2/` subtree so v1 can
  still ship fixes.

## 7. What NOT to carry over

- Splash window machinery (`startup.ts` timing, splash HTML) — likely obsolete
- `setImmediate` yielding / time budgets in mirrors — replaced by real threads
- `tasklist` exec + TTL cache — replaced by sysinfo
- electron-toolkit, electron-updater, electron-builder, png-to-ico/jimp icon scripts
  (Tauri's `tauri icon` command generates all icon formats from Logo.png)

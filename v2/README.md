# FiveLaunch v2 (Tauri + Svelte rewrite)

The Rust + Svelte rewrite of FiveLaunch. Same behavior, same on-disk data
(`%APPDATA%\FiveLaunch`), dramatically smaller and faster than the Electron v1
that lives at the repo root.

- Migration plan and phase breakdown: [PLAN.md](PLAN.md)
- Performance tracking (update every phase): [PERF.md](PERF.md)

## Stack

- **Backend**: Rust, Tauri 2 (`src-tauri/`)
- **Frontend**: Svelte 5 (runes) + TypeScript + Tailwind 4 (`src/`)

## Development

```powershell
pnpm install
pnpm tauri dev     # run the app (vite + cargo)

pnpm test          # frontend unit tests (vitest)
pnpm check         # svelte-check + tsc
cd src-tauri
cargo test         # Rust unit + v1-compatibility tests
cargo bench        # criterion performance benches
```

## Building

```powershell
pnpm tauri build   # release build + NSIS bundle (src-tauri/target/release/)
```

## Status

- [x] Phase 0/1 — scaffold, theme port, Rust core (paths/settings/clients/stats),
      typed command bridge, client list UI, tests + benches
- [x] Phase 2 — linking engine + launch pipeline (junction/backups/retry, sysinfo
      process checks, detached spawn, launch-status events, Launch button).
      Plugins **sync mode** intentionally deferred to Phase 3 (launch warns).
- [ ] Phase 3 — plugins sync + runtime sync engines
- [ ] Phase 4 — GTA settings XML + CitizenFX.ini + ReShade sync
- [ ] Phase 5 — full UI port (dialogs, logs panel, settings, GTA settings editor)
- [ ] Phase 6 — tray, single-instance, shortcuts, update checker
- [ ] Phase 7 — packaging, CI, cutover

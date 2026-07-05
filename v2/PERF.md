# FiveLaunch v2 — Performance Tracking

Every phase of the rewrite must hold or improve these numbers. Update this file
whenever a phase lands. The whole point of v2 is speed — if a change regresses
a row, fix it before merging.

## Head-to-head: v1 vs v2, same machine, same method (2026-07-04)

Both apps launched via `Start-Process`, `WaitForInputIdle`, memory summed over
all of the app's processes (Electron children / WebView2 children) after a few
seconds idle. Private memory avoids double-counting shared pages.

| Metric | v1 (Electron 28) | v2 (Tauri 2) Phase 1 | Change |
| --- | --- | --- | --- |
| Exe size | **168.9 MB** | **3.22 MB** | **−98% (52x smaller)** |
| Time to input-idle | 467 ms | **102 ms** | **4.6x faster** |
| Private memory (idle) | 244.5 MB (4 procs) | 200.9 MB (app 3.9 + WebView2 197) | −18% |
| Working set (idle) | 341.6 MB | 325.7 MB | −5% |
| Frontend JS shipped | multi-MB (React + deps) | **66 KB** (22.7 KB gzip) | ~30x+ smaller |

Honest notes:
- The RAM win is real but modest — WebView2 is still Chromium. The big wins
  are binary size, startup, and (in later phases) killing the `tasklist.exe`
  polling subprocess spam.
- v1's input-idle is measured on its launcher process; its *perceived* start
  (window painted) is longer — that's why v1 ships a splash window. v2 paints
  fast enough that Phase 1 has no splash at all.
- v2 idle also currently spans 6 WebView2 utility processes; this is fixed
  overhead that won't grow with app complexity.

## v2 quality gates — Phase 3

| Metric | v2 value | Notes |
| --- | --- | --- |
| Rust unit tests | **55 passing** | mirror engine, plugins isolation, runtime loop, launch e2e |
| Frontend tests | **12 passing** | 6 unit + 6 UI component tests (mocked IPC bridge) |
| svelte-check | 0 errors / 0 warnings | `pnpm check`, 183 files |
| Vite production build | ~0.6 s | `pnpm build` |

Phase 2 perf note: the v1 exit-watcher + sync loops spawned `tasklist.exe`
roughly every second while the game ran. v2's `core::process` uses native
process enumeration (sysinfo) — zero subprocess spawns.

Phase 3 perf note: v1's mirror loops ran on the Node event loop and had to
yield every 250 files + respect a 40ms time budget per tick to keep the UI
alive. v2 mirrors on a dedicated thread — no yielding machinery, and the
persisted mtime cache format is byte-compatible so upgraded users keep their
warm caches.

## UI testing (how we test a desktop app)

- **Component layer (in place)**: `src/tests/App.test.ts` renders the real
  Svelte components in jsdom against Tauri's official IPC mocks
  (`@tauri-apps/api/mocks`). Asserts rendered output AND that the right Rust
  commands are invoked with the right args. Runs in `pnpm test`, CI-friendly.
- **E2E layer (planned, Phase 7)**: `tauri-driver` + WebDriver against the
  compiled exe for pre-release smoke tests (launch window, create client,
  real filesystem). Heavier and Windows-finicky, so reserved for release
  gates rather than every change.

## How to run everything

```powershell
# from v2/
pnpm test          # vitest (frontend units)
pnpm check         # svelte-check + tsc
pnpm build         # vite production build

# from v2/src-tauri/
cargo test         # Rust units incl. v1 golden-file compatibility tests
cargo bench        # criterion benches (folder walk, config parse)
cargo build --release
```

## Benchmarks (criterion, `cargo bench`)

| Bench | Result (2026-07-04) | Guards |
| --- | --- | --- |
| `folder_stats_2000_files` | **4.75 ms** | client stats on every selection change |
| `clients_json_parse_50_clients` | **28.1 µs** | config read on every command |
| `clients_json_serialize_50_clients` | **30.5 µs** | config write on every mutation |

Criterion stores history in `src-tauri/target/criterion/` — it will flag
regressions between runs automatically ("change: +x% p=...").

## Compatibility gates (must stay green forever)

- `round_trip_is_byte_identical_to_v1` (clients.json)
- `round_trip_preserves_v1_shape` (settings.json)
- `does_not_descend_into_junctions` (stats parity with v1 lstat behavior)
- Data dir is `%APPDATA%\FiveLaunch` — v1 and v2 read/write the same files.
  Run v1 and v2 against the same profiles when validating a phase.

# FiveLaunch v2 — Performance Tracking

Every phase of the rewrite must hold or improve these numbers. Update this file
whenever a phase lands. The whole point of v2 is speed — if a change regresses
a row, fix it before merging.

## Baseline: v1 (Electron 28 + React 18), measured 2026-07-04

| Metric | v1 value | How measured |
| --- | --- | --- |
| Portable exe size | **168.9 MB** | `dist/FiveLaunch.exe` from `pnpm build:win` |
| Renderer JS shipped | multi-MB (React + deps) | electron-vite output |
| Idle RAM | ~150–250 MB (typical Electron) | Task Manager, all processes summed |
| Cold start | slow enough to need a splash window | v1 ships `startup.ts` timing + splash |
| Process polling | spawns `tasklist.exe` every ~1s while game runs | `processUtils.ts` |

## v2 (Tauri 2 + Svelte 5) — Phase 1

| Metric | v2 value | Notes |
| --- | --- | --- |
| Release exe size | _fill in after `cargo build --release`_ | `src-tauri/target/release/fivelaunch.exe` |
| Frontend JS shipped | **66 KB** (22.7 KB gzip) | `pnpm build` output |
| Frontend CSS shipped | 57.6 KB (31.9 KB gzip) | includes full theme |
| Idle RAM | _fill in_ | exe + WebView2 child processes |
| Rust unit tests | **21 passing** | `cargo test` (~0.06s test run) |
| Frontend tests | **6 passing** | `pnpm test` (vitest, ~0.4s) |
| svelte-check | 0 errors / 0 warnings | `pnpm check` |

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

| Bench | Result | Guards |
| --- | --- | --- |
| `folder_stats_2000_files` | _fill in_ | client stats on every selection change |
| `clients_json_parse_50_clients` | _fill in_ | config read on every command |
| `clients_json_serialize_50_clients` | _fill in_ | config write on every mutation |

Criterion stores history in `src-tauri/target/criterion/` — it will flag
regressions between runs automatically ("change: +x% p=...").

## Compatibility gates (must stay green forever)

- `round_trip_is_byte_identical_to_v1` (clients.json)
- `round_trip_preserves_v1_shape` (settings.json)
- `does_not_descend_into_junctions` (stats parity with v1 lstat behavior)
- Data dir is `%APPDATA%\FiveLaunch` — v1 and v2 read/write the same files.
  Run v1 and v2 against the same profiles when validating a phase.

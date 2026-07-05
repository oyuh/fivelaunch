# FiveLaunch

FiveLaunch is a desktop launcher for **FiveM** that manages multiple isolated
client profiles by controlling how FiveM reads mods/plugins/settings on disk.

Docs: https://fivelaunch.help · Releases: https://github.com/oyuh/fivelaunch/releases

## Repo layout (v2 rewrite in progress)

| Folder | What | Stack |
| --- | --- | --- |
| [`v1/`](v1/) | Current shipping app | Electron 28 + React 18 + TypeScript |
| [`v2/`](v2/) | Ground-up rewrite (this branch) | **Tauri 2 (Rust) + Svelte 5** |

Both versions read and write the same data (`%APPDATA%\FiveLaunch`) — that
compatibility is contractual and enforced by golden-file tests in v2.

- Rewrite plan: [v2/PLAN.md](v2/PLAN.md)
- Performance tracking (v1 vs v2): [v2/PERF.md](v2/PERF.md)
- v1 docs/quickstart: [v1/README.md](v1/README.md)

> Note: `.github/workflows` still targets the v1 paths from before the split;
> CI gets rewired to v2 in Phase 7 of the rewrite plan.

## License

Source-available under the **FiveLaunch Source-Available License** — see
[LICENSE](LICENSE).

# Contributing to FiveLaunch

Thanks for wanting to help out. This is a small project with a clear architecture, so contributing is mostly about matching the existing patterns and keeping the on-disk behavior stable.

Before you sink real time into a change, please read the licensing note at the bottom. FiveLaunch is source-available, not open-source, and that affects what you can do with your fork.

## Ways to contribute

- **Bug reports:** open an [issue](https://github.com/oyuh/fivelaunch/issues) with your OS version, FiveLaunch version, and steps to reproduce. Logs from the in-app History dialog help a lot.
- **Feature ideas:** open an issue first so we can talk through the approach before you build it.
- **Pull requests:** for anything non-trivial, start with an issue so we agree on the shape of the change. Small, focused PRs get reviewed faster.
- **Patches without a fork:** you can also attach a diff to an issue instead of opening a PR. See the license section for why that option exists.

## Project layout

The important split is that all filesystem, linking, and process logic lives in Rust and is unit-tested in isolation. The UI never touches disk directly, it goes through the command layer.

- [`src-tauri/src/core/`](src-tauri/src/core/) - framework-agnostic core logic (the interesting part).
- [`src-tauri/src/commands.rs`](src-tauri/src/commands.rs) - thin `#[tauri::command]` wrappers over the core.
- [`src/`](src/) - the Svelte 5 UI, with the typed Rust bridge in [`src/lib/api.ts`](src/lib/api.ts).

The README has a fuller architecture breakdown if you want the map before diving in.

## Getting set up

You need **Bun 1.x** and **Rust (stable)** with the MSVC toolchain.

```powershell
bun install
bun run tauri dev
```

For frontend-only work there is a no-build UI preview harness:

```powershell
bun run ui
```

## Before you open a PR

Please make sure the checks pass locally:

```powershell
bun run test     # frontend unit + component tests
bun run check    # svelte-check + tsc

# from src-tauri/
cargo test       # Rust unit tests + v1-compatibility golden tests
```

A few things reviewers look for:

- **Keep core logic in Rust.** If a change involves the filesystem, linking, or launching, it belongs in `src-tauri/src/core/` with tests, not in the UI.
- **Do not break v1 compatibility.** The on-disk formats are byte-compatible with the v1 app on purpose, so users can move between versions. There are golden-file tests guarding this. If you have a good reason to change a format, raise it in an issue first.
- **Add tests for behavior changes**, especially anything touching linking, syncing, or backups. These are the parts that can quietly eat someone's files if they regress.
- **Match the surrounding style.** Run `cargo fmt` for Rust. Keep the Svelte code consistent with what is already there.
- **Keep PRs focused.** One logical change per PR. Unrelated cleanups are easier to review on their own.

## Commit and PR hygiene

- Write clear commit messages that say what changed and why.
- Reference the issue your PR addresses.
- If your change is user-visible, mention how you tested it (dev build, real FiveM launch, etc.).

## Licensing of contributions

FiveLaunch is licensed under the **FiveLaunch Source-Available License (FiveLaunch-SAL)**, which is a source-available license, not an open-source one. See [LICENSE](LICENSE) for the full terms.

A couple of practical consequences:

- You can view, use, and modify the code for personal or internal use, but you **cannot** redistribute it or publish a fork without written permission.
- Because public forks are restricted, the intended way to share improvements is a **pull request** to this repo (or a patch attached to an issue).
- By submitting a contribution, you agree it can be incorporated into FiveLaunch and redistributed by the owner under any terms, and you agree to keep the existing copyright and attribution notices intact.

If any of that is unclear, ask in an issue before contributing. Thanks again for helping make FiveLaunch better.

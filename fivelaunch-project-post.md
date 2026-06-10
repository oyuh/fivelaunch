---
title: "FiveLaunch: One FiveM install, many isolated client profiles"
description: "How FiveLaunch works under the hood: per-client folders, junction linking, plugin sync modes, and why a tiny launcher beats a pile of manual backups."
publishDate: "2026-02-03T12:00:00"
tags: ["project", "electron", "fivem", "desktop", "typescript", "windows", "tooling"]
coverImage:
  src: "./cover-image.png"
  alt: "FiveLaunch UI showing multiple client profiles and launch status"
draft: true
---

import Chart from '@/components/blog/Chart.tsx';
import InfoCard from '@/components/blog/InfoCard.tsx';

export const fakeLaunchP50Ms = [
  { x: 'Link mods', y: 80 },
  { x: 'Plugins setup', y: 140 },
  { x: 'ReShade sync', y: 55 },
  { x: 'GTA settings', y: 35 },
  { x: 'Start FiveM', y: 20 }
];

export const fakePluginsModeOverheadMs = [
  { x: 'Junction mode', y: 12 },
  { x: 'Sync mode', y: 78 }
];

export const fakeSupportReasons = [
  { x: 'Backups already existed', y: 14 },
  { x: 'FiveM running/locked files', y: 23 },
  { x: 'Plugins mixed across clients', y: 9 },
  { x: 'Wrong FiveM.app path', y: 11 },
  { x: 'ReShade preset confusion', y: 7 }
];

# Overview

FiveLaunch is a desktop launcher for **FiveM** that solves a very specific (and very annoying) problem:

> You want *multiple* FiveM “setups” (mods/plugins/settings) without maintaining *multiple full installs* or constantly renaming folders by hand.

FiveLaunch does that by keeping **per-client folders** under your AppData and then controlling what FiveM sees by **linking** (junctions / file links) the right folders into the real FiveM directories at launch time.

It’s intentionally small:

- no cloud accounts
- no “mod manager ecosystem”
- no database
- just a launcher that owns the filesystem rules so you don’t have to

<InfoCard title="Important" variant="warning">
FiveLaunch modifies what FiveM reads on disk by linking/replacing folders and settings files.
It creates backups automatically, but it’s still powerful enough to break your setup if you point it at the wrong folders.
</InfoCard>

# Why this exists (and when it’s worth using)

If you only ever play on one server with one plugin set, you can probably live without this.

FiveLaunch becomes worth it when you have *profiles* in your head:

- “server A” needs a certain `mods` layout
- “server B” wants a different plugin stack
- you want a “clean” client for troubleshooting
- you’re testing a plugin/ReShade preset and don’t want to contaminate your daily setup

The key is that FiveM (and tools around it) often expect *fixed locations*:

- `%LOCALAPPDATA%\\FiveM\\FiveM.app\\mods`
- `%LOCALAPPDATA%\\FiveM\\FiveM.app\\plugins`
- `%LOCALAPPDATA%\\FiveM\\FiveM.app\\citizen`
- `%APPDATA%\\CitizenFX\\gta5_settings.xml`
- `%APPDATA%\\CitizenFX\\CitizenFX.ini`

FiveLaunch leans into that reality: it doesn’t fight the path expectations—it **redirects** them.

# The core idea: client folders + controlled linking

FiveLaunch stores each client profile on disk, then “projects” that profile into the real FiveM folders at launch.

## On-disk layout

Each client gets its own directory:

| Location | Purpose |
|---|---|
| `%APPDATA%\\FiveLaunch\\clients\\<clientId>\\mods\\` | Per-client mods folder |
| `%APPDATA%\\FiveLaunch\\clients\\<clientId>\\plugins\\` | Per-client plugins folder |
| `%APPDATA%\\FiveLaunch\\clients\\<clientId>\\citizen\\` | Optional per-client citizen folder (advanced) |
| `%APPDATA%\\FiveLaunch\\clients\\<clientId>\\settings\\` | Per-client settings files + caches |

At launch time, FiveLaunch targets these FiveM/CitizenFX paths:

| Target path | What FiveLaunch can do |
|---|---|
| `%LOCALAPPDATA%\\FiveM\\FiveM.app\\mods` | Junction to client `mods` |
| `%LOCALAPPDATA%\\FiveM\\FiveM.app\\plugins` | Junction **or** sync/copy mode |
| `%LOCALAPPDATA%\\FiveM\\FiveM.app\\citizen` | Junction to client `citizen` (optional) |
| `%APPDATA%\\CitizenFX\\gta5_settings.xml` | Seed + enforce per-client settings (optional) |
| `%APPDATA%\\CitizenFX\\CitizenFX.ini` | Seed + 2-way sync while running (optional) |

## Backups are a first-class feature

A launcher that links folders without a backup story is just a footgun.

When FiveLaunch takes over a directory the first time, it renames the original aside:

- `mods` → `mods_original`
- `plugins` → `plugins_original`
- `citizen` → `citizen_original`
- `gta5_settings.xml` → `gta5_settings.xml_original`
- `CitizenFX.ini` → `CitizenFX.ini_original`

That backup behavior is part of the project’s “small but safe” philosophy:

- don’t delete
- don’t overwrite
- always make it possible to roll back

# Launch flow: what actually happens

Here’s the launch pipeline in human terms:

1. **Refuse unsafe launches**
   - FiveLaunch won’t start a new client if GTA V / FiveM is already running.
   - It also won’t start while a previous “plugins finalization” sync is still finishing.

2. **Link / prepare folders based on that client’s toggles**
   - `mods` link (junction)
   - `plugins` in either junction mode or sync mode
   - optional `citizen` link (advanced)

3. **Apply per-client settings**
   - optional GTA settings enforcement (FiveM reads settings from multiple places)
   - optional `CitizenFX.ini` seed + live sync

4. **Launch FiveM**

5. **(Optional) Minimize to tray and restore later**
   - If “minimize to tray on game launch” is enabled, FiveLaunch hides itself.
   - In sync mode, it can restore when it sees the game process exit.

<Chart
  client:load
  data={fakeLaunchP50Ms}
  type="bar"
  title="Launch pipeline time (p50-ish, illustrative ms)"
  xLabel="Step"
  yLabel="Milliseconds"
  height={320}
/>

<InfoCard title="Note on charts" variant="info">
The charts in this post are illustrative to explain tradeoffs. Your real timings depend on disk speed, plugin count, and what’s already cached.
</InfoCard>

# Plugins: two modes, one goal (isolation)

Plugins are where “multi-client” setups usually fall apart.

Some plugins (and especially overlays like ReShade) care deeply about **the real filesystem path** they’re loaded from.

So FiveLaunch supports two strategies:

## 1) Junction mode (fast, direct)

- `%LOCALAPPDATA%\\FiveM\\FiveM.app\\plugins` becomes a junction to the client’s `plugins` folder.
- Pros: minimal copying, very fast, less IO.
- Cons: some tooling may resolve the *target* path; a few setups behave weirdly when paths are redirected.

## 2) Sync mode (path-stable)

- `%LOCALAPPDATA%\\FiveM\\FiveM.app\\plugins` stays a *real folder*.
- FiveLaunch copies/syncs files **client → game** on launch and can sync changes back.
- Pros: plugins “see” the standard FiveM path; helps with path-sensitive setups.
- Cons: extra IO; requires careful “ownership” rules so clients don’t leak into each other.

<Chart
  client:load
  data={fakePluginsModeOverheadMs}
  type="bar"
  title="Plugins mode overhead (illustrative)"
  xLabel="Mode"
  yLabel="Extra milliseconds"
  height={260}
/>

## Preventing plugin cross-contamination

Sync mode has one scary failure mode:

> client A writes into the game plugins folder, then client B launches and accidentally inherits it.

FiveLaunch mitigates this by stamping ownership markers in the game plugins directory and rotating the folder aside if it looks unmanaged or owned by another client.

In practice this means sync mode is slightly more “ceremonial,” but much safer for multi-client setups.

# ReShade: why it gets special handling

ReShade commonly drops config/preset files next to the executable or in paths that aren’t neatly “inside plugins.”

FiveLaunch handles that reality by optionally syncing a subset of ReShade-adjacent files between:

- the real install location (near `FiveM.exe` / `FiveM.app`)
- the client’s own settings storage

That gives you per-client ReShade configs without needing to manually remember which preset belonged to which profile.

# UI + architecture (why Electron is a good fit here)

FiveLaunch is a classic Electron split:

- **Main process** owns filesystem mutations, process checks, and the launch sequence.
- **Preload** exposes a constrained API surface.
- **Renderer (React)** is UI-only: it calls IPC handlers and displays logs/progress.

## IPC surface (the UI can only do what it’s allowed)

The renderer can:

- list / create / rename / delete clients
- toggle per-client link options
- open key folders (client, plugins, FiveM.app, CitizenFX)
- launch a client and receive status updates
- read logs

That separation matters because the dangerous operations (renames, links, sync) stay in one place.

# What can go wrong (and how the project tries to be resilient)

Most failures are boring filesystem truths:

- FiveM is running → files are locked
- an overlay is holding a handle open
- a folder is already linked in an unexpected way
- your FiveM.app path is wrong

<Chart
  client:load
  data={fakeSupportReasons}
  type="bar"
  title="Common failure causes (illustrative counts)"
  xLabel="Cause"
  yLabel="Count"
  height={320}
/>

## Recovery checklist

If something goes sideways, the recovery path is usually:

1. Close FiveM/GTA V and overlays.
2. Inspect the “*_original” backups.
3. Confirm the configured `FiveM.app` folder.
4. Re-launch with only `mods` enabled, then add features back one by one.

# Closing thoughts

FiveLaunch is the kind of tool that’s boring when it works—and that’s the point.

It exists to replace a fragile manual workflow (rename folders, copy plugins, hope nothing leaks) with a repeatable launch pipeline:

- isolated per-client storage
- predictable linking rules
- explicit plugin mode tradeoffs
- automatic backups

If you’ve ever had to undo “one small change” to your FiveM folder at 2am, you already know why this is worth having.

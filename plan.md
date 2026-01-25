# FiveLaunch
A way to launch *FiveM* with select mods and settings.


## Features

- UI to select which client you'd like to launch and change params, settings, etc.
- On the "back end" of this we need to engineer a way to not have a huge overhead of data... Meaning, we need to find a way to share /data folders in FiveM application data, so the only real work that we would need to do is find a way to launch the game by linking the mods, plugins, citizens and GTA settings file to the specified ones that are chosen on the ui from launching.

My thought on how to do this is we store all of their mods, plugins, citizens folder in this application data somewhere that they setup by opening them and dragging the wanted files in them. Then when they launch a selected client, it boots the game with all the linked folders and files for that client. Kind of like Lunar Client does, but now with that much over head, since thats launching an actual vertsion of the game with ALL of the files.

## Tech

This will use something like electron, so I would like to build this in TS since its easiest to update and such. We might need to write code in another language to pull and link files on windows. Also we just need to engineer a way to even make this work yk... Lol.

---

## Implementation Notes (Scaffolded)

### UI Stack (Tailwind + shadcn/ui)
- Tailwind is configured for the renderer process (Vite + React).
- shadcn/ui components are stored under `src/renderer/src/components/ui`.
- Global styles and CSS variables live in `src/renderer/src/assets/index.css`.

### Current File Structure

```
fivem-clients/
	components.json                         # shadcn/ui config
	electron.vite.config.ts                 # electron-vite config
	postcss.config.js
	tailwind.config.js
	tsconfig.json
	tsconfig.node.json
	tsconfig.web.json
	src/
		main/
			index.ts                            # Electron main process entry
			types.ts                            # Shared types (ClientProfile, ClientConfig)
			managers/
				ClientManager.ts                  # Create/delete clients & folders
				GameManager.ts                    # Symlink logic + FiveM launch
			utils/
				paths.ts                          # FiveM path helpers
		preload/
			index.ts                            # IPC bridge for renderer
		renderer/
			index.html
			src/
				App.tsx                           # UI for client list/create/launch
				env.d.ts                          # Window API typing
				assets/
					index.css                       # Tailwind + shadcn base styles
				components/
					ui/
						button.tsx
						card.tsx
						input.tsx
				lib/
					utils.ts                        # cn() helper for Tailwind class merging
```

---

## Backend Logic (What’s Implemented So Far)

### Client Manager
**File:** `src/main/managers/ClientManager.ts`
- Creates a client folder under Electron’s app data:
	- `.../AppData/Roaming/fivem-client-launcher/clients/<clientId>/`
- Subfolders per client:
	- `mods/`
	- `plugins/`
	- `citizen/` (reserved for future linking)
- Persists client metadata in a `clients.json` file under app data.

### Game Manager
**File:** `src/main/managers/GameManager.ts`
- Locates FiveM via `LOCALAPPDATA\FiveM\FiveM.app`.
- For a selected client, links:
	- `mods/` -> `FiveM.app/mods`
	- `plugins/` -> `FiveM.app/plugins`
- Original folders are preserved by renaming to `*_original` the first time.
- If a link already exists, it is removed and replaced.
- Launches `FiveM.exe` via a detached process.

### IPC API
**File:** `src/preload/index.ts`
- `getClients()`
- `createClient(name)`
- `deleteClient(id)`
- `launchClient(id)`

---

## TODO / Next Steps

- Add configurable base FiveM path (prompt or settings screen).
- Add GTA settings file linking (likely from `AppData/Roaming/CitizenFX`).
- Add citizen folder linking only when explicitly enabled and validated.
- Add error reporting from main process to renderer UI (toast/alert).
- Add per-client metadata (description, custom params, last played).
- Add drag-and-drop import for mods/plugins into each client folder.
- Build and test symlink logic with real FiveM installs to validate safe swaps.

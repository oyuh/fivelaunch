/**
 * No-build UI preview harness.
 *
 * Runs the REAL Svelte UI in a plain browser (`bun run ui`) with the Tauri IPC
 * bridge mocked — no Rust build required. Every `invoke()` the UI makes is
 * answered by the in-memory fake backend below, so you can see and iterate on
 * the interface visually.
 *
 * This file is only referenced by index.preview.html and is never part of the
 * production Tauri build (vite build only bundles index.html -> src/main.ts).
 *
 * Add `?screen=styleguide` to the URL to view the design-system style guide
 * instead of the app.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { mount } from 'svelte'
import './app.css'
import type { AppLogEntry, ClientProfile } from './lib/types'

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const DAY = 86_400_000

function client(
  id: string,
  name: string,
  icon: string | undefined,
  lastPlayed: number | undefined,
  links: Partial<ClientProfile['linkOptions']> = {}
): ClientProfile {
  return {
    id,
    name,
    icon,
    lastPlayed,
    linkOptions: {
      mods: true,
      plugins: true,
      pluginsMode: 'sync',
      citizen: false,
      gtaSettings: false,
      citizenFxIni: false,
      ...links
    }
  }
}

let clients: ClientProfile[] = [
  client('id-main', 'Main RP', 'gamepad', Date.now() - 2 * 3_600_000),
  client('id-drift', 'Drift Server', 'car', Date.now() - 3 * DAY, {
    pluginsMode: 'junction',
    gtaSettings: true
  }),
  client('id-cops', 'Cops & Robbers', 'shield', Date.now() - 12 * DAY, { citizen: true }),
  client('id-hardcore', 'Hardcore Survival', 'skull', undefined, {
    mods: true,
    plugins: false,
    citizenFxIni: true
  }),
  client('id-dev', 'Dev Sandbox', 'terminal', Date.now() - 30 * 60_000, {
    citizen: true,
    gtaSettings: true,
    citizenFxIni: true
  })
]

// The most recently launched client, persisted backend-side in the real app.
let selectedClientId: string | null = null

// Snapshot ("My Setup") client id — Main RP doubles as the snapshot in the
// preview so the badge and restore flows are visible.
let snapshotClientId: string | null = 'id-main'

let backups: Array<Record<string, unknown>> = [
  {
    name: 'mods_1751700000000',
    path: 'C:\\Users\\you\\AppData\\Roaming\\FiveLaunch\\backups\\mods_1751700000000',
    kind: 'mods',
    createdMs: Date.now() - 4 * DAY,
    isDir: true,
    totalBytes: 734_003_200,
    fileCount: 1284
  },
  {
    name: 'plugins_1751500000000',
    path: 'C:\\Users\\you\\AppData\\Roaming\\FiveLaunch\\backups\\plugins_1751500000000',
    kind: 'plugins',
    createdMs: Date.now() - 9 * DAY,
    isDir: true,
    totalBytes: 52_428_800,
    fileCount: 63
  }
]

// Version shown throughout the preview. Defaults to a recent release and is
// updated to the real latest GitHub release tag in boot() before mounting.
let appVersion = '2.5.32'

const seedLogs: AppLogEntry[] = [
  { id: 1, ts: Date.now() - 61_000, level: 'info', message: `FiveLaunch v${appVersion} started`, source: 'main' },
  { id: 2, ts: Date.now() - 60_000, level: 'info', message: 'Resolved FiveM.app at C:\\Users\\you\\AppData\\Local\\FiveM\\FiveM.app', source: 'main' },
  { id: 3, ts: Date.now() - 45_000, level: 'debug', message: 'Loaded 5 clients from clients.json', source: 'main' },
  { id: 4, ts: Date.now() - 30_000, level: 'info', message: 'Checked for updates: up to date', source: 'main' },
  { id: 5, ts: Date.now() - 12_000, level: 'info', message: 'Preparing launch for "Main RP"…', source: 'launch' },
  { id: 6, ts: Date.now() - 11_000, level: 'info', message: 'Linking mods folder (junction)', source: 'launch' },
  { id: 7, ts: Date.now() - 10_000, level: 'error', message: 'Failed to sync plugin "reshade" — access denied', source: 'launch' }
]

const gtaDoc = {
  rootName: 'Settings',
  items: [
    { path: 'Settings/graphics/Tessellation', attributes: { value: '1' } },
    { path: 'Settings/graphics/ShadowQuality', attributes: { value: '2' } },
    { path: 'Settings/graphics/ReflectionQuality', attributes: { value: '2' } },
    { path: 'Settings/graphics/MSAA', attributes: { value: '4' } },
    { path: 'Settings/video/ScreenWidth', attributes: { value: '2560' } },
    { path: 'Settings/video/ScreenHeight', attributes: { value: '1440' } },
    { path: 'Settings/video/VSync', attributes: { value: '1' } },
    { path: 'Settings/audio/Volume', attributes: { value: '0.75' } }
  ]
}

// ---------------------------------------------------------------------------
// Mock IPC bridge
// ---------------------------------------------------------------------------

mockWindows('main')

// Use the simulated updater (src/lib/updater.ts) so the update flow is viewable.
;(window as unknown as Record<string, unknown>).__FL_MOCK_UPDATER__ = true

mockIPC((cmd, payload) => {
  const args = (payload ?? {}) as Record<string, unknown>

  // Event plugin + window plugin registrations — just ack them.
  if (String(cmd).startsWith('plugin:')) return 1

  switch (cmd) {
    // Clients
    case 'get_clients':
      return clients
    case 'get_selected_client_id':
      return selectedClientId
    case 'get_client_stats':
      return { fileCount: 3_284, totalBytes: 6_871_947_674 }
    case 'list_client_mods':
      return ['gfx_pack/', 'vehicles/', 'weapons.rpf', 'sound_overhaul.oiv', 'ui_theme/']
    case 'create_client': {
      const created = client(
        `id-${Date.now()}`,
        String(args.name),
        (args.icon as string) ?? 'gamepad',
        Date.now()
      )
      clients = [...clients, created]
      return created
    }
    case 'duplicate_client': {
      const source = clients.find((c) => c.id === args.id)
      const options = (args.options ?? {}) as Record<string, boolean>
      const created = client(
        `id-${Date.now()}`,
        String(args.name),
        source?.icon,
        Date.now(),
        options.config ? source?.linkOptions : {}
      )
      if (options.config && source?.pureMode != null) created.pureMode = source.pureMode
      clients = [...clients, created]
      return created
    }
    case 'uninstall_app':
      // Match the real dev-build behavior so the error path is viewable.
      throw new Error('Uninstaller not found next to the app — is this a development build?')
    case 'set_client_icon': {
      clients = clients.map((c) => (c.id === args.id ? { ...c, icon: String(args.icon) } : c))
      return null
    }
    case 'set_client_pure_mode': {
      const mode = args.pureMode == null ? undefined : Number(args.pureMode)
      clients = clients.map((c) => (c.id === args.id ? { ...c, pureMode: mode } : c))
      return null
    }
    case 'rename_client':
      clients = clients.map((c) => (c.id === args.id ? { ...c, name: String(args.name) } : c))
      return null
    case 'reorder_clients': {
      const ids = (args.ids as string[]) ?? []
      const byId = new Map(clients.map((c) => [c.id, c]))
      const reordered = ids.map((id) => byId.get(id)).filter(Boolean) as ClientProfile[]
      for (const c of clients) if (!ids.includes(c.id)) reordered.push(c)
      clients = reordered
      return null
    }
    case 'delete_client':
      clients = clients.filter((c) => c.id !== args.id)
      if (selectedClientId === args.id) selectedClientId = null
      if (snapshotClientId === args.id) snapshotClientId = null
      return null
    case 'set_client_restore_on_close':
      clients = clients.map((c) =>
        c.id === args.id ? { ...c, restoreOnClose: Boolean(args.enabled) } : c
      )
      return null
    case 'create_snapshot_client': {
      const created = client(`id-snapshot-${Date.now()}`, 'My Setup', 'shield', Date.now(), {
        citizen: true,
        gtaSettings: true,
        citizenFxIni: true,
        pluginsMode: 'junction'
      })
      clients = [...clients, created]
      snapshotClientId = created.id
      return created
    }
    case 'restore_snapshot_now':
      return new Promise((resolve) => setTimeout(resolve, 900))
    case 'update_client_links':
      clients = clients.map((c) =>
        c.id === args.id
          ? { ...c, linkOptions: args.linkOptions as ClientProfile['linkOptions'] }
          : c
      )
      return null

    // Settings
    case 'get_settings':
      return {
        minimizeToTrayOnGameLaunch: false,
        themePrimaryHex: '#f59e0b',
        ...(snapshotClientId ? { snapshotClientId } : {})
      }
    case 'get_resolved_game_path':
      return 'C:\\Users\\you\\AppData\\Local\\FiveM\\FiveM.app'
    case 'browse_game_path':
      return 'C:\\Users\\you\\AppData\\Local\\FiveM\\FiveM.app'
    case 'get_app_version':
      return appVersion

    // Launch — delay so the "Launching…" state is visible in the preview.
    case 'launch_client': {
      // Mirror the real backend: bump last_played + remember the selection.
      selectedClientId = String(args.id)
      clients = clients.map((c) =>
        c.id === args.id ? { ...c, lastPlayed: Date.now() } : c
      )
      return new Promise((resolve) => setTimeout(resolve, 2_500))
    }
    case 'is_game_running':
      return false
    case 'get_game_busy_state':
      return { pluginsSyncBusy: false }

    // Logs / updates / shortcuts
    case 'get_app_logs':
      return seedLogs
    case 'get_update_status':
      return {
        currentVersion: appVersion,
        latestVersion: appVersion,
        latestUrl: `https://github.com/oyuh/fivelaunch/releases/tag/v${appVersion}`,
        isUpdateAvailable: false,
        checkedAt: Date.now(),
        source: 'releases-latest'
      }
    case 'create_client_shortcut':
      return 'C:\\Users\\you\\Desktop\\FiveM - Client.lnk'

    // Backups
    case 'list_backups':
      return backups
    case 'delete_backup':
      backups = backups.filter((b) => b.name !== args.name)
      return null

    // GTA settings
    case 'get_client_gta_settings':
    case 'import_gta_settings_from_documents':
    case 'import_gta_settings_from_template':
      return gtaDoc

    // Fire-and-forget commands (folders, setters, url, clear, window)
    default:
      return null
  }
})

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const target = document.getElementById('app')!
  const params = new URLSearchParams(location.search)
  const screen = params.get('screen')

  // Skip the first-run welcome dialog while iterating (add ?firstrun to see it).
  if (!params.has('firstrun')) localStorage.setItem('fivelaunch.firstRunAck', 'true')

  // Show the real latest release version in the preview (best-effort; falls back
  // to the default above). Done before mounting so the UI reads it on first render.
  try {
    const res = await fetch(
      'https://api.github.com/repos/oyuh/fivelaunch/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } }
    )
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string }
      const tag = String(data?.tag_name ?? '').replace(/^v/, '')
      if (tag) {
        appVersion = tag
        if (seedLogs[0]) seedLogs[0].message = `FiveLaunch v${appVersion} started`
      }
    }
  } catch {
    // keep the fallback version
  }

  if (screen === 'styleguide') {
    const StyleGuide = (await import('./lib/design/StyleGuide.svelte')).default
    mount(StyleGuide, { target })
  } else {
    const App = (await import('./App.svelte')).default
    mount(App, { target })

    // Preview convenience (e.g. the docs landing embed): preselect the first
    // client so the detail panel is populated immediately, without changing the
    // real app's default of no selection. Skips if the app already restored a
    // previously launched client (its name renders as an <h1>), so this stays a
    // fallback and doesn't mask the real reselect-on-launch behavior.
    const preselect = (tries = 0): void => {
      if (document.querySelector('main h1')) return
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Main RP')
      )
      if (btn) btn.click()
      else if (tries < 20) setTimeout(() => preselect(tries + 1), 50)
    }
    setTimeout(() => preselect(), 120)
  }
}

void boot()

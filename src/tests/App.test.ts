/**
 * UI component tests.
 *
 * These render the real App component in jsdom against a mocked Tauri IPC
 * bridge (@tauri-apps/api/mocks). Every `invoke()` the UI makes is answered
 * by the fake backend below, and we assert both what the user sees AND which
 * Rust commands were called with which arguments.
 *
 * (Full end-to-end testing of the compiled exe via tauri-driver/WebDriver is
 * a separate, heavier layer planned for pre-release smoke tests — see PLAN.md.)
 */
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClientProfile } from '../lib/types'
import App from '../App.svelte'

type InvokeCall = { cmd: string; args: Record<string, unknown> }

let calls: InvokeCall[] = []
let clients: ClientProfile[] = []
let backups: Array<Record<string, unknown>> = []

function makeClient(id: string, name: string): ClientProfile {
  return {
    id,
    name,
    lastPlayed: 1_719_849_600_000,
    linkOptions: {
      mods: true,
      plugins: true,
      pluginsMode: 'sync',
      citizen: false,
      gtaSettings: false,
      citizenFxIni: false
    }
  }
}

function setupFakeBackend(): void {
  calls = []
  clients = [makeClient('id-main', 'Main RP'), makeClient('id-drift', 'Drift Server')]
  backups = [
    {
      name: 'mods_1751700000000',
      path: 'C:\\Users\\test\\AppData\\Roaming\\FiveLaunch\\backups\\mods_1751700000000',
      kind: 'mods',
      createdMs: 1751700000000,
      isDir: true,
      totalBytes: 4096,
      fileCount: 12
    }
  ]

  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>
    // The event plugin registers listeners through invoke too; ack those.
    if (String(cmd).startsWith('plugin:event|')) return 1

    calls.push({ cmd: String(cmd), args })

    switch (cmd) {
      case 'get_clients':
        return clients
      case 'get_settings':
        return { minimizeToTrayOnGameLaunch: false }
      case 'get_app_version':
        return '2.0.0'
      case 'get_resolved_game_path':
        return 'C:\\Users\\test\\AppData\\Local\\FiveM\\FiveM.app'
      case 'get_client_stats':
        return { fileCount: 3, totalBytes: 2048 }
      case 'get_game_busy_state':
        return { pluginsSyncBusy: false }
      case 'create_client': {
        const created = makeClient(`id-${String(args.name)}`, String(args.name))
        clients = [...clients, created]
        return created
      }
      case 'delete_client':
        clients = clients.filter((c) => c.id !== args.id)
        return null
      case 'update_client_links': {
        clients = clients.map((c) =>
          c.id === args.id
            ? { ...c, linkOptions: args.linkOptions as ClientProfile['linkOptions'] }
            : c
        )
        return null
      }
      case 'rename_client': {
        clients = clients.map((c) =>
          c.id === args.id ? { ...c, name: String(args.name) } : c
        )
        return null
      }
      case 'launch_client':
        return null
      case 'set_game_path':
      case 'set_theme_primary_hex':
      case 'set_minimize_to_tray_on_game_launch':
      case 'save_client_gta_settings':
        return null
      case 'list_client_mods':
        return ['gfx_pack/', 'sound.rpf']
      case 'get_update_status':
        return {
          currentVersion: '2.0.0',
          latestVersion: '2.5.0',
          latestUrl: 'https://github.com/oyuh/fivelaunch/releases/tag/v2.5.0',
          isUpdateAvailable: true,
          checkedAt: Date.now(),
          source: 'releases-latest'
        }
      case 'get_app_logs':
        return [{ id: 1, ts: Date.now(), level: 'info', message: 'FiveLaunch v2.0.0 started' }]
      case 'clear_app_logs':
      case 'open_url':
        return null
      case 'create_client_shortcut':
        return 'C:\\Users\\test\\Desktop\\FiveM - Main RP.lnk'
      case 'list_backups':
        return backups
      case 'delete_backup':
        backups = backups.filter((b) => b.name !== args.name)
        return null
      case 'open_backups_folder':
        return null
      case 'get_client_gta_settings':
        return {
          rootName: 'Settings',
          items: [
            { path: 'Settings/graphics/Tessellation', attributes: { value: '1' } },
            { path: 'Settings/video/ScreenWidth', attributes: { value: '2560' } }
          ]
        }
      default:
        throw new Error(`unmocked command: ${cmd}`)
    }
  })
}

const called = (cmd: string): InvokeCall[] => calls.filter((c) => c.cmd === cmd)

beforeEach(() => {
  // Suppress the first-run modal by default; the first-run test clears this.
  localStorage.setItem('fivelaunch.firstRunAck', 'true')
  mockWindows('main')
  setupFakeBackend()
})

afterEach(() => {
  // Unmount BEFORE clearing mocks: component teardown unregisters event
  // listeners through the mocked bridge, which clearMocks() removes.
  cleanup()
  clearMocks()
})

describe('App shell', () => {
  it('lists clients loaded from the backend', async () => {
    render(App)

    expect(await screen.findByText('Main RP')).toBeInTheDocument()
    expect(screen.getByText('Drift Server')).toBeInTheDocument()
    expect(called('get_clients').length).toBeGreaterThan(0)
  })

  it('shows overview with stats when a client is selected', async () => {
    render(App)

    await fireEvent.click(await screen.findByText('Main RP'))

    // Stats fetched for the right client and rendered.
    await waitFor(() => {
      expect(called('get_client_stats').at(-1)?.args.id).toBe('id-main')
    })
    expect(await screen.findByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('id-main')).toBeInTheDocument()
  })

  it('creates a client through the backend and shows it', async () => {
    render(App)
    await screen.findByText('Main RP')

    await fireEvent.input(screen.getByPlaceholderText('New client name'), {
      target: { value: 'Fresh Client' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Fresh Client')).toBeInTheDocument()
    expect(called('create_client').at(-1)?.args.name).toBe('Fresh Client')
  })

  it('launches the selected client', async () => {
    render(App)

    await fireEvent.click(await screen.findByText('Drift Server'))
    await fireEvent.click(await screen.findByRole('button', { name: 'Launch' }))

    await waitFor(() => {
      expect(called('launch_client').at(-1)?.args.id).toBe('id-drift')
    })
  })

  it('requires two clicks to delete (confirm step)', async () => {
    render(App)

    await fireEvent.click(await screen.findByText('Main RP'))
    const deleteBtn = await screen.findByRole('button', { name: 'Delete' })

    await fireEvent.click(deleteBtn)
    expect(called('delete_client')).toHaveLength(0)
    expect(await screen.findByText('Confirm delete?')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }))
    await waitFor(() => {
      expect(called('delete_client').at(-1)?.args.id).toBe('id-main')
    })
    await waitFor(() => {
      expect(screen.queryByText('Main RP')).not.toBeInTheDocument()
    })
  })

  it('toggles link options through the backend', async () => {
    render(App)
    await fireEvent.click(await screen.findByText('Main RP'))

    // Boolean chip: Mods on -> off.
    await fireEvent.click(await screen.findByRole('button', { name: 'Mods' }))
    await waitFor(() => {
      const call = called('update_client_links').at(-1)
      expect(call?.args.id).toBe('id-main')
      expect((call?.args.linkOptions as { mods: boolean }).mods).toBe(false)
    })

    // Plugins chip cycles: on(sync) -> junction.
    await fireEvent.click(await screen.findByRole('button', { name: 'Plugins (sync)' }))
    await waitFor(() => {
      const opts = called('update_client_links').at(-1)?.args.linkOptions as {
        plugins: boolean
        pluginsMode: string
      }
      expect(opts.plugins).toBe(true)
      expect(opts.pluginsMode).toBe('junction')
    })
    expect(await screen.findByRole('button', { name: 'Plugins (junction)' })).toBeInTheDocument()

    // junction -> off.
    await fireEvent.click(screen.getByRole('button', { name: 'Plugins (junction)' }))
    await waitFor(() => {
      const opts = called('update_client_links').at(-1)?.args.linkOptions as { plugins: boolean }
      expect(opts.plugins).toBe(false)
    })
  })

  it('shows the first-run dialog until acknowledged', async () => {
    localStorage.removeItem('fivelaunch.firstRunAck')
    render(App)

    expect(await screen.findByText('Welcome to FiveLaunch')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'I Understand' }))
    await waitFor(() => {
      expect(screen.queryByText('Welcome to FiveLaunch')).not.toBeInTheDocument()
    })
    expect(localStorage.getItem('fivelaunch.firstRunAck')).toBe('true')
  })

  it('opens global settings from the titlebar and saves the game path', async () => {
    render(App)
    await screen.findByText('Main RP')

    await fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('Global Settings')).toBeInTheDocument()

    const pathInput = screen.getByPlaceholderText('C:\\Users\\...\\AppData\\Local\\FiveM\\FiveM.app')
    await fireEvent.input(pathInput, { target: { value: 'D:\\FiveM\\FiveM.app' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(called('set_game_path').at(-1)?.args.gamePath).toBe('D:\\FiveM\\FiveM.app')
    })
  })

  it('edits and saves GTA settings through the editor', async () => {
    render(App)
    await fireEvent.click(await screen.findByText('Main RP'))
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit GTA settings' }))

    // Loads the client's document.
    await waitFor(() => {
      expect(called('get_client_gta_settings').at(-1)?.args.id).toBe('id-main')
    })
    expect(await screen.findByText('GTA V Settings Editor')).toBeInTheDocument()

    // Tessellation is a mapped select with friendly labels.
    const select = (await screen.findByDisplayValue('Normal')) as HTMLSelectElement
    await fireEvent.change(select, { target: { value: '3' } })

    await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => {
      const saved = called('save_client_gta_settings').at(-1)
      expect(saved?.args.id).toBe('id-main')
      const doc = saved?.args.doc as {
        items: { path: string; attributes: Record<string, string> }[]
      }
      const tess = doc.items.find((i) => i.path === 'Settings/graphics/Tessellation')
      expect(tess?.attributes.value).toBe('3')
      // Untouched values survive.
      const width = doc.items.find((i) => i.path === 'Settings/video/ScreenWidth')
      expect(width?.attributes.value).toBe('2560')
    })
  })

  it('shows client details with the mods list', async () => {
    render(App)
    await fireEvent.click(await screen.findByText('Main RP'))
    await fireEvent.click(await screen.findByRole('button', { name: 'Details' }))

    await waitFor(() => {
      expect(called('list_client_mods').at(-1)?.args.id).toBe('id-main')
    })
    expect(await screen.findByText('gfx_pack/')).toBeInTheDocument()
    expect(screen.getByText('sound.rpf')).toBeInTheDocument()
  })

  it('shows the update badge and opens the release page', async () => {
    render(App)

    const badge = await screen.findByRole('button', { name: 'Update available: v2.5.0' })
    await fireEvent.click(badge)

    await waitFor(() => {
      expect(called('open_url').at(-1)?.args.url).toBe(
        'https://github.com/oyuh/fivelaunch/releases/tag/v2.5.0'
      )
    })
  })

  it('creates a desktop shortcut from client details', async () => {
    render(App)
    await fireEvent.click(await screen.findByText('Main RP'))
    await fireEvent.click(await screen.findByRole('button', { name: 'Details' }))

    await fireEvent.click(await screen.findByRole('button', { name: 'Create Desktop Shortcut' }))
    await waitFor(() => {
      expect(called('create_client_shortcut').at(-1)?.args.id).toBe('id-main')
    })
    expect(await screen.findByText('Shortcut created!')).toBeInTheDocument()
  })

  it('lists and deletes backups in the History dialog', async () => {
    render(App)
    await screen.findByText('Main RP')

    await fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByText('Backup History')).toBeInTheDocument()
    expect(await screen.findByText('mods')).toBeInTheDocument()
    expect(screen.getByText(/12 files/)).toBeInTheDocument()

    // Two-step delete: first click arms, second click deletes via backend.
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(called('delete_backup')).toHaveLength(0)
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }))
    await waitFor(() => {
      expect(called('delete_backup').at(-1)?.args.name).toBe('mods_1751700000000')
    })
    expect(await screen.findByText(/No backups yet/)).toBeInTheDocument()
  })

  it('shows the app version and resolved game path in the footer', async () => {
    render(App)

    expect(await screen.findByText(/FiveLaunch v2\.0\.0/)).toBeInTheDocument()
    expect(
      await screen.findByText('C:\\Users\\test\\AppData\\Local\\FiveM\\FiveM.app')
    ).toBeInTheDocument()
  })
})

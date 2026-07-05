import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppSettings, ClientProfile, ClientStats, GameBusyState, LinkOptions } from './types'

/**
 * Typed command bridge. Method names mirror v1's `window.api.*` so ported
 * components keep working with a find/replace of `window.api` -> `api`.
 */
export const api = {
  // Clients
  getClients: () => invoke<ClientProfile[]>('get_clients'),
  createClient: (name: string) => invoke<ClientProfile>('create_client', { name }),
  deleteClient: (id: string) => invoke<void>('delete_client', { id }),
  renameClient: (id: string, name: string) => invoke<void>('rename_client', { id, name }),
  updateClientLinks: (id: string, linkOptions: LinkOptions) =>
    invoke<void>('update_client_links', { id, linkOptions }),
  getClientStats: (id: string) => invoke<ClientStats>('get_client_stats', { id }),
  listClientMods: (id: string) => invoke<string[]>('list_client_mods', { id }),

  // Folders
  openClientFolder: (id: string) => invoke<void>('open_client_folder', { id }),
  openClientPluginsFolder: (id: string) => invoke<void>('open_client_plugins_folder', { id }),
  openCitizenFxFolder: () => invoke<void>('open_citizenfx_folder'),
  openFiveMFolder: () => invoke<void>('open_fivem_folder'),
  openFiveMPluginsFolder: () => invoke<void>('open_fivem_plugins_folder'),

  // Settings
  getSettings: () => invoke<AppSettings>('get_settings'),
  setGamePath: (gamePath: string) => invoke<void>('set_game_path', { gamePath }),
  setMinimizeToTrayOnGameLaunch: (enabled: boolean) =>
    invoke<void>('set_minimize_to_tray_on_game_launch', { enabled }),
  setThemePrimaryHex: (hex: string | null) => invoke<void>('set_theme_primary_hex', { hex }),
  getResolvedGamePath: () => invoke<string | null>('get_resolved_game_path'),
  browseGamePath: () => invoke<string | null>('browse_game_path'),

  // Launch
  launchClient: (id: string) => invoke<void>('launch_client', { id }),
  isGameRunning: () => invoke<boolean>('is_game_running'),
  getGameBusyState: () => invoke<GameBusyState>('get_game_busy_state'),
  /** Subscribe to launch progress. Returns an unlisten function (async). */
  onLaunchStatus: (callback: (status: string) => void) =>
    listen<string>('launch-status', (event) => callback(event.payload)),

  // App
  getAppVersion: () => invoke<string>('get_app_version')
}

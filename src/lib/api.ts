import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AppSettings,
  BackupEntry,
  ClientProfile,
  ClientStats,
  DuplicateOptions,
  GameBusyState,
  GtaSettingsDocument,
  LinkOptions,
  UpdateStatus
} from './types'

/** Main-process log entry as emitted by Rust (source added client-side). */
interface RawAppLogEntry {
  id: number
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

/**
 * Typed command bridge. Method names mirror v1's `window.api.*` so ported
 * components keep working with a find/replace of `window.api` -> `api`.
 */
export const api = {
  // Clients
  getClients: () => invoke<ClientProfile[]>('get_clients'),
  /** The client most recently launched, persisted across restarts. */
  getSelectedClientId: () => invoke<string | null>('get_selected_client_id'),
  createClient: (name: string, icon?: string) =>
    invoke<ClientProfile>('create_client', { name, icon }),
  setClientIcon: (id: string, icon: string | null) =>
    invoke<void>('set_client_icon', { id, icon }),
  setClientPureMode: (id: string, pureMode: number | null) =>
    invoke<void>('set_client_pure_mode', { id, pureMode }),
  duplicateClient: (id: string, name: string, options: DuplicateOptions) =>
    invoke<ClientProfile>('duplicate_client', { id, name, options }),
  deleteClient: (id: string) => invoke<void>('delete_client', { id }),
  setClientRestoreOnClose: (id: string, enabled: boolean) =>
    invoke<void>('set_client_restore_on_close', { id, enabled }),

  // Snapshot ("My Setup") — the baseline every session returns to
  createSnapshotClient: (name?: string) =>
    invoke<ClientProfile>('create_snapshot_client', { name }),
  restoreSnapshotNow: () => invoke<void>('restore_snapshot_now'),
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

  // Window
  windowMinimize: () => invoke<void>('window_minimize'),

  // Backup history (central store in %APPDATA%\FiveLaunch\backups)
  listBackups: () => invoke<BackupEntry[]>('list_backups'),
  openBackupsFolder: () => invoke<void>('open_backups_folder'),
  deleteBackup: (name: string) => invoke<void>('delete_backup', { name }),

  // Updates / logs / shortcuts
  getUpdateStatus: () => invoke<UpdateStatus>('get_update_status'),
  getAppLogs: () => invoke<RawAppLogEntry[]>('get_app_logs'),
  clearAppLogs: () => invoke<void>('clear_app_logs'),
  createClientShortcut: (id: string) => invoke<string>('create_client_shortcut', { id }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  /** Subscribe to live main-process logs. Returns an unlisten function (async). */
  onAppLog: (callback: (entry: RawAppLogEntry) => void) =>
    listen<RawAppLogEntry>('app-log', (event) => callback(event.payload)),

  // GTA settings editor
  getClientGtaSettings: (id: string) =>
    invoke<GtaSettingsDocument>('get_client_gta_settings', { id }),
  saveClientGtaSettings: (id: string, doc: GtaSettingsDocument) =>
    invoke<void>('save_client_gta_settings', { id, doc }),
  importGtaSettingsFromDocuments: (id: string) =>
    invoke<GtaSettingsDocument>('import_gta_settings_from_documents', { id }),
  importGtaSettingsFromTemplate: (id: string) =>
    invoke<GtaSettingsDocument>('import_gta_settings_from_template', { id }),

  // App
  getAppVersion: () => invoke<string>('get_app_version'),
  openAppDataFolder: () => invoke<void>('open_app_data_folder'),
  /** Wipes all FiveLaunch data, launches the NSIS uninstaller, and exits. */
  uninstallApp: () => invoke<void>('uninstall_app')
}

// Shared data types — must stay in sync with the Rust core serde models
// (src-tauri/src/core/*.rs), which in turn mirror v1's on-disk formats.

export interface ClientProfile {
  id: string
  name: string
  description?: string
  /** Icon key from the client icon set (src/lib/components/ui/icons.ts). */
  icon?: string
  /** FiveM pure-mode level to launch with (1 or 2). Absent = off. */
  pureMode?: number
  lastPlayed?: number
  /**
   * Restore the snapshot ("My Setup") client's files after this client's
   * session ends. Absent = ON; only an explicit opt-out stores false.
   */
  restoreOnClose?: boolean
  linkOptions: LinkOptions
}

export interface LinkOptions {
  mods: boolean
  plugins: boolean
  /**
   * How to provide the per-client plugins into FiveM.app.
   * - junction: FiveM.app/plugins is a junction to the client plugins folder
   * - sync: keep FiveM.app/plugins a real folder and copy/sync files both ways
   */
  pluginsMode?: 'junction' | 'sync'
  citizen: boolean
  gtaSettings: boolean
  citizenFxIni: boolean
}

/** What to carry over when duplicating a client (mirrors Rust DuplicateOptions). */
export interface DuplicateOptions {
  /** Copy the mods folder. */
  mods: boolean
  /** Copy the plugins folder. */
  plugins: boolean
  /** Copy the citizen folder. */
  citizen: boolean
  /** Copy the settings folder (GTA settings + CitizenFX.ini). */
  settings: boolean
  /** Copy linking options and pure mode. */
  config: boolean
}

export interface ClientStats {
  fileCount: number
  totalBytes: number
}

export interface AppSettings {
  gamePath?: string
  minimizeToTrayOnGameLaunch: boolean
  themePrimaryHex?: string
  /** The snapshot ("My Setup") client id; absent until one is created. */
  snapshotClientId?: string
}

export interface GameBusyState {
  pluginsSyncBusy: boolean
}

export interface GtaSettingsItem {
  path: string
  attributes: Record<string, string>
}

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogEntry {
  id: number
  ts: number
  level: AppLogLevel
  message: string
  source: 'main' | 'launch'
}

export interface BackupEntry {
  name: string
  path: string
  kind: string
  createdMs: number
  isDir: boolean
  totalBytes: number
  fileCount: number
}

export interface UpdateStatus {
  currentVersion: string
  latestVersion: string | null
  latestUrl: string | null
  isUpdateAvailable: boolean
  checkedAt: number
  source: 'releases-latest' | 'tags-latest' | 'error'
  error?: string
}

export interface GtaSettingsDocument {
  rootName: string
  items: GtaSettingsItem[]
}

/** Result of a validated save: the canonical document as written to disk,
 * plus notes for any values the backend had to repair. */
export interface GtaSettingsSaveResult {
  document: GtaSettingsDocument
  repairs: string[]
}

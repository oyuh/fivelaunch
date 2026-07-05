// Shared data types — must stay in sync with the Rust core serde models
// (src-tauri/src/core/*.rs), which in turn mirror v1's on-disk formats.

export interface ClientProfile {
  id: string
  name: string
  description?: string
  lastPlayed?: number
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

export interface ClientStats {
  fileCount: number
  totalBytes: number
}

export interface AppSettings {
  gamePath?: string
  minimizeToTrayOnGameLaunch: boolean
  themePrimaryHex?: string
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

export interface GtaSettingsDocument {
  rootName: string
  items: GtaSettingsItem[]
}

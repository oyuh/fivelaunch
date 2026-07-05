import fs from 'fs'
import path from 'path'
import { getAppDataPath } from '../utils/paths'

export interface AppSettings {
  gamePath?: string
  minimizeToTrayOnGameLaunch?: boolean
  themePrimaryHex?: string
}

const isHexColor = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const v = value.trim()
  return /^#([0-9a-fA-F]{6})$/.test(v)
}

const normalizeSettings = (settings: AppSettings): AppSettings => {
  return {
    gamePath: settings.gamePath,
    minimizeToTrayOnGameLaunch: Boolean(settings.minimizeToTrayOnGameLaunch),
    themePrimaryHex: isHexColor(settings.themePrimaryHex) ? settings.themePrimaryHex.toLowerCase() : undefined
  }
}

export class SettingsManager {
  private settingsPath: string

  constructor() {
    this.settingsPath = path.join(getAppDataPath(), 'settings.json')
    this.ensureInitialized()
  }

  private ensureInitialized() {
    if (!fs.existsSync(this.settingsPath)) {
      this.saveSettings({})
    }
  }

  public getSettings(): AppSettings {
    try {
      const data = fs.readFileSync(this.settingsPath, 'utf8')
      return normalizeSettings(JSON.parse(data))
    } catch {
      return normalizeSettings({})
    }
  }

  public saveSettings(settings: AppSettings) {
    fs.writeFileSync(this.settingsPath, JSON.stringify(normalizeSettings(settings), null, 2))
  }

  public setGamePath(gamePath: string) {
    const settings = this.getSettings()
    settings.gamePath = gamePath
    this.saveSettings(settings)
  }

  public setMinimizeToTrayOnGameLaunch(enabled: boolean) {
    const settings = this.getSettings()
    settings.minimizeToTrayOnGameLaunch = Boolean(enabled)
    this.saveSettings(settings)
  }

  public setThemePrimaryHex(hex: string | null) {
    const settings = this.getSettings()
    if (hex === null || hex === undefined || String(hex).trim() === '') {
      delete settings.themePrimaryHex
      this.saveSettings(settings)
      return
    }

    const trimmed = String(hex).trim()
    if (!isHexColor(trimmed)) return
    settings.themePrimaryHex = trimmed.toLowerCase()
    this.saveSettings(settings)
  }
}

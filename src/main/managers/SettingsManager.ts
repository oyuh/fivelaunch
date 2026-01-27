import fs from 'fs'
import path from 'path'
import { getAppDataPath } from '../utils/paths'

export interface AppSettings {
  gamePath?: string
  minimizeToTrayOnGameLaunch?: boolean
}

const normalizeSettings = (settings: AppSettings): AppSettings => {
  return {
    gamePath: settings.gamePath,
    minimizeToTrayOnGameLaunch: Boolean(settings.minimizeToTrayOnGameLaunch)
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
}

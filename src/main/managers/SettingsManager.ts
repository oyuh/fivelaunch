import fs from 'fs'
import path from 'path'
import { getAppDataPath } from '../utils/paths'

export interface AppSettings {
  gamePath?: string
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
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  public saveSettings(settings: AppSettings) {
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2))
  }

  public setGamePath(gamePath: string) {
    const settings = this.getSettings()
    settings.gamePath = gamePath
    this.saveSettings(settings)
  }
}

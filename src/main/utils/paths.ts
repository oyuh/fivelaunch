import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export const getAppDataPath = (): string => {
  return app.getPath('userData')
}

export const getClientsDataPath = (): string => {
  return path.join(getAppDataPath(), 'clients')
}

export const getClientConfigPath = (): string => {
  return path.join(getAppDataPath(), 'clients.json')
}

export const getSettingsPath = (): string => {
  return path.join(getAppDataPath(), 'settings.json')
}

export const getFiveMPath = (): string | null => {
  // Check settings override first
  const settingsPath = getSettingsPath()
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { gamePath?: string }
      if (settings.gamePath && fs.existsSync(settings.gamePath)) {
        return settings.gamePath
      }
    } catch {
      // ignore
    }
  }

  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return null

  const standardPath = path.join(localAppData, 'FiveM', 'FiveM.app')
  if (fs.existsSync(standardPath)) {
    return standardPath
  }

  // TODO: Add logic to ask user if not found
  return null
}

export const getFiveMBaseDir = (): string | null => {
  const appPath = getFiveMPath()
  if (!appPath) return null
  return path.dirname(appPath)
}

export const getFiveMExecutable = (): string | null => {
  const baseDir = getFiveMBaseDir()
  if (!baseDir) return null

  const exePath = path.join(baseDir, 'FiveM.exe')
  if (fs.existsSync(exePath)) {
    return exePath
  }
  return null
}

export const getCitizenFxDir = (): string | null => {
  const appData = process.env.APPDATA
  if (!appData) return null
  const dir = path.join(appData, 'CitizenFX')
  return dir
}

export const getGtaSettingsPath = (): string | null => {
  // FiveM reads from CitizenFX AppData, not Documents!
  const appData = process.env.APPDATA
  if (appData) {
    return path.join(appData, 'CitizenFX', 'gta5_settings.xml')
  }
  // Fallback to Documents for vanilla GTA V
  const documentsDir = app.getPath('documents')
  return path.join(documentsDir, 'Rockstar Games', 'GTA V', 'settings.xml')
}

export const getFiveMAppSettingsPath = (): string | null => {
  // FiveM.app also has its own settings.xml that GTA reads from!
  const fiveMPath = getFiveMPath()
  if (!fiveMPath) return null
  return path.join(fiveMPath, 'settings.xml')
}

export const getGtaSettingsCandidates = (): string[] => {
  const candidates: string[] = []

  // FiveM's CitizenFX location (PRIMARY for FiveM users)
  const appData = process.env.APPDATA
  if (appData) {
    candidates.push(path.join(appData, 'CitizenFX', 'gta5_settings.xml'))
  }

  // Some installs also use LocalAppData\CitizenFX
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    candidates.push(path.join(localAppData, 'CitizenFX', 'gta5_settings.xml'))
    candidates.push(path.join(localAppData, 'FiveM', 'FiveM.app', 'settings.xml'))
  }

  const documentsDir = app.getPath('documents')
  if (documentsDir) {
    candidates.push(path.join(documentsDir, 'Rockstar Games', 'GTA V', 'settings.xml'))
  }

  const userProfile = process.env.USERPROFILE
  if (userProfile) {
    candidates.push(
      path.join(userProfile, 'Documents', 'Rockstar Games', 'GTA V', 'settings.xml')
    )
  }

  const oneDrive = process.env.OneDrive
  if (oneDrive) {
    candidates.push(
      path.join(oneDrive, 'Documents', 'Rockstar Games', 'GTA V', 'settings.xml')
    )
  }

  return Array.from(new Set(candidates.filter(Boolean)))
}



export const getCitizenFxIniPath = (): string | null => {
  const dir = getCitizenFxDir()
  if (!dir) return null
  return path.join(dir, 'CitizenFX.ini')
}

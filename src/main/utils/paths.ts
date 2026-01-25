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

export const getFiveMPath = (): string | null => {
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
  const dir = getCitizenFxDir()
  if (!dir) return null
  return path.join(dir, 'gta5_settings.xml')
}

export const getCitizenFxIniPath = (): string | null => {
  const dir = getCitizenFxDir()
  if (!dir) return null
  return path.join(dir, 'CitizenFX.ini')
}

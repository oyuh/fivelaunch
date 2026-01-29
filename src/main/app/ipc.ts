/**
 * IPC handler registration.
 *
 * This file intentionally keeps all `ipcMain.handle(...)` wiring in one place,
 * but grouped by feature so it's easy to scan.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { getCitizenFxDir, getFiveMPath } from '../utils/paths'
import { checkForUpdatesOnGitHub, type UpdateStatus } from '../utils/updateChecker'
import type { LinkOptions } from '../types'
import { refreshProcessRunningMany } from '../managers/gameManager/processUtils'
import type { AppLogStore } from './logging'
import type { ManagerGetters } from './managers'
import { sanitizeWindowsFileName } from './args'

const UPDATE_CACHE_TTL_MS = 15 * 60 * 1000
const GITHUB_REPO = 'oyuh/fivelaunch'

export type IpcDeps = {
  managers: ManagerGetters
  appLog: AppLogStore

  getAppIconPath: () => string

  ensureTray: () => void
  minimizeToTray: () => void
  restoreFromTray: () => void
}

/**
 * Registers all IPC handlers.
 *
 * Call once after the app is ready and the main window is created.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  let updateStatusCache: { ts: number; value: UpdateStatus } | null = null

  registerClientHandlers(deps)
  registerFileSystemHandlers(deps)
  registerSettingsHandlers(deps, () => updateStatusCache, (next) => {
    updateStatusCache = next
  })
  registerGtaSettingsHandlers(deps)
  registerWindowControlHandlers(deps)
  registerLaunchHandlers(deps)
  registerShortcutHandlers(deps)
}

function registerClientHandlers(deps: IpcDeps): void {
  const { managers } = deps

  ipcMain.handle('get-clients', async () => (await managers.getClientManager()).getClients())
  ipcMain.handle('create-client', async (_event, name: string) => (await managers.getClientManager()).createClient(name))
  ipcMain.handle('delete-client', async (_event, id: string) => (await managers.getClientManager()).deleteClient(id))
  ipcMain.handle('rename-client', async (_event, id: string, name: string) => (await managers.getClientManager()).renameClient(id, name))
  ipcMain.handle('update-client-links', async (_event, id: string, linkOptions: LinkOptions) =>
    (await managers.getClientManager()).updateClientLinkOptions(id, linkOptions)
  )
  ipcMain.handle('get-client-stats', async (_event, id: string) => (await managers.getClientManager()).getClientStats(id))
}

function registerFileSystemHandlers(deps: IpcDeps): void {
  const { managers } = deps

  ipcMain.handle('open-client-folder', async (_event, id: string) => {
    const folderPath = (await managers.getClientManager()).getClientFolderPath(id)
    if (!folderPath) throw new Error('Client folder not found.')
    return shell.openPath(folderPath)
  })

  ipcMain.handle('open-client-plugins-folder', async (_event, id: string) => {
    const folderPath = (await managers.getClientManager()).getClientFolderPath(id)
    if (!folderPath) throw new Error('Client folder not found.')
    return shell.openPath(join(folderPath, 'plugins'))
  })

  ipcMain.handle('open-citizenfx-folder', async () => {
    const dir = getCitizenFxDir()
    if (!dir) throw new Error('CitizenFX folder not found.')
    return shell.openPath(dir)
  })

  ipcMain.handle('open-fivem-folder', async () => {
    const dir = getFiveMPath()
    if (!dir) throw new Error('FiveM folder not found.')
    return shell.openPath(dir)
  })

  ipcMain.handle('open-fivem-plugins-folder', async () => {
    const dir = getFiveMPath()
    if (!dir) throw new Error('FiveM folder not found.')
    return shell.openPath(join(dir, 'plugins'))
  })

  ipcMain.handle('list-client-mods', async (_event, id: string) => {
    const folderPath = (await managers.getClientManager()).getClientFolderPath(id)
    if (!folderPath) throw new Error('Client folder not found.')

    const modsPath = join(folderPath, 'mods')
    if (!fs.existsSync(modsPath)) return []

    const entries = await fs.promises.readdir(modsPath, { withFileTypes: true })
    return entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  })
}

function registerSettingsHandlers(
  deps: IpcDeps,
  getUpdateCache: () => { ts: number; value: UpdateStatus } | null,
  setUpdateCache: (next: { ts: number; value: UpdateStatus } | null) => void
): void {
  const { managers } = deps

  ipcMain.handle('get-settings', async () => (await managers.getSettingsManager()).getSettings())
  ipcMain.handle('set-game-path', async (_event, gamePath: string) => {
    ;(await managers.getSettingsManager()).setGamePath(gamePath)
  })
  ipcMain.handle('set-minimize-to-tray-on-game-launch', async (_event, enabled: boolean) => {
    ;(await managers.getSettingsManager()).setMinimizeToTrayOnGameLaunch(Boolean(enabled))
  })

  ipcMain.handle('set-theme-primary-hex', async (_event, hex: string | null) => {
    ;(await managers.getSettingsManager()).setThemePrimaryHex(hex)
  })

  ipcMain.handle('browse-game-path', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select FiveM.app folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('get-resolved-game-path', async () => getFiveMPath())
  ipcMain.handle('get-game-busy-state', async () => (await managers.getGameManager()).getBusyState())

  ipcMain.handle('get-update-status', async () => {
    const now = Date.now()
    const cached = getUpdateCache()
    if (cached && now - cached.ts < UPDATE_CACHE_TTL_MS) {
      return cached.value
    }

    const currentVersion = app.getVersion()
    const status = await checkForUpdatesOnGitHub({ repo: GITHUB_REPO, currentVersion })
    setUpdateCache({ ts: now, value: status })
    return status
  })

  ipcMain.handle('get-app-version', async () => app.getVersion())

  ipcMain.handle('get-app-logs', async () => deps.appLog.getLogs())
  ipcMain.handle('clear-app-logs', async () => deps.appLog.clearLogs())
}

function registerGtaSettingsHandlers(deps: IpcDeps): void {
  const { managers } = deps

  ipcMain.handle('get-client-gta-settings', async (_event, id: string) => (await managers.getGtaSettingsManager()).getClientSettings(id))
  ipcMain.handle('save-client-gta-settings', async (_event, id: string, doc) => {
    ;(await managers.getGtaSettingsManager()).saveClientSettings(id, doc)
  })
  ipcMain.handle('import-gta-settings-from-documents', async (_event, id: string) => (await managers.getGtaSettingsManager()).importFromDocuments(id))
  ipcMain.handle('import-gta-settings-from-template', async (_event, id: string) => (await managers.getGtaSettingsManager()).importFromTemplate(id))
}

function registerWindowControlHandlers(deps: IpcDeps): void {
  ipcMain.handle('window-minimize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const settings = (await deps.managers.getSettingsManager()).getSettings()
    if (settings.minimizeToTrayOnGameLaunch) {
      deps.ensureTray()
      win.hide()
      win.setSkipTaskbar(true)
      return
    }

    win.minimize()
  })

  ipcMain.handle('window-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })
}

function registerLaunchHandlers(deps: IpcDeps): void {
  const { managers } = deps

  // When minimize-on-launch is enabled, we hide the window immediately.
  // A lightweight watcher brings the window back once the game process exits.
  let gameExitWatcher: NodeJS.Timeout | null = null
  let gameExitWatcherToken = 0

  const stopWatcher = () => {
    if (gameExitWatcher) {
      clearInterval(gameExitWatcher)
      gameExitWatcher = null
    }
    gameExitWatcherToken += 1
  }

  const startRestoreOnGameExit = (webContents: WebContents) => {
    stopWatcher()

    const token = gameExitWatcherToken
    let seenRunning = false
    const startedAt = Date.now()

    let inFlight = false
    gameExitWatcher = setInterval(() => {
      if (token !== gameExitWatcherToken) {
        stopWatcher()
        return
      }

      if (inFlight) return
      inFlight = true
      void refreshProcessRunningMany(['FiveM.exe', 'GTA5.exe'])
        .then((r) => Boolean(r['FiveM.exe'] || r['GTA5.exe']))
        .catch(() => false)
        .then((running) => {
          if (token !== gameExitWatcherToken) return

          if (!seenRunning) {
            if (running) {
              seenRunning = true
              return
            }
            if (Date.now() - startedAt > 60_000) {
              stopWatcher()
            }
            return
          }

          if (running) return

          stopWatcher()
          deps.restoreFromTray()
          try {
            webContents.send('launch-status', 'Game closed.')
          } catch {
            // ignore
          }
        })
        .finally(() => {
          inFlight = false
        })
    }, 1000)
  }

  ipcMain.handle('launch-client', async (event, id: string) => {
    try {
      const settings = (await managers.getSettingsManager()).getSettings()
      if (settings.minimizeToTrayOnGameLaunch) {
        deps.minimizeToTray()
      }

      const cm = await managers.getClientManager()
      const gm = await managers.getGameManager()
      const client = cm.getClient(id)
      if (!client) throw new Error('Client not found.')

      const statusCallback = (status: string) => {
        event.sender.send('launch-status', status)
      }

      await gm.launchClient(id, client.linkOptions, statusCallback)

      if (settings.minimizeToTrayOnGameLaunch) {
        startRestoreOnGameExit(event.sender)
      } else {
        stopWatcher()
      }
      return { success: true }
    } catch (error) {
      console.error('Launch error:', error)
      stopWatcher()
      deps.restoreFromTray()
      return { success: false, error: (error as Error).message }
    }
  })
}

function registerShortcutHandlers(deps: IpcDeps): void {
  const { managers } = deps

  ipcMain.handle('create-client-shortcut', async (_event, id: string) => {
    if (process.platform !== 'win32') {
      throw new Error('Shortcuts are currently supported on Windows only.')
    }

    const client = (await managers.getClientManager()).getClient(id)
    if (!client) throw new Error('Client not found.')

    const desktopDir = app.getPath('desktop')
    const fileName = sanitizeWindowsFileName(`FiveM - ${client.name}.lnk`)
    const shortcutPath = join(desktopDir, fileName)

    const ok = shell.writeShortcutLink(shortcutPath, {
      target: process.execPath,
      args: `--launch-client=${id}`,
      description: `Launch ${client.name}`,
      icon: deps.getAppIconPath()
    })

    if (!ok) {
      throw new Error('Failed to create shortcut.')
    }

    return { success: true, path: shortcutPath }
  })
}

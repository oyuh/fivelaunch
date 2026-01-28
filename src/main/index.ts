/**
 * Main process entrypoint.
 *
 * This file intentionally stays small: it wires up top-level services,
 * creates the main window, and registers IPC.
 */

import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getLaunchClientArg } from './app/args'
import { getAppIconPath, getSplashLogoDataUrl } from './app/assets'
import { createAppLogStore } from './app/logging'
import { createManagerGetters } from './app/managers'
import { registerIpcHandlers } from './app/ipc'
import { createStartupTracker } from './app/startup'
import { createTrayController } from './app/tray'
import { createMainWindow } from './app/window'

const startupTimingEnabled =
  process.env['FIVELAUNCH_STARTUP_TIMING'] === '1' || process.env['STARTUP_TIMING'] === '1'

let mainWindowRef: BrowserWindow | null = null
let isQuitting = false
let splashWindowRef: BrowserWindow | null = null

const startup = createStartupTracker({
  timingEnabled: startupTimingEnabled,
  getSplashWindow: () => splashWindowRef
})

const managers = createManagerGetters(startup.mark)

const tray = createTrayController({
  getMainWindow: () => mainWindowRef,
  setIsQuitting: (value) => {
    isQuitting = value
  },
  getIconPath: getAppIconPath
})

const appLog = createAppLogStore(() => mainWindowRef)
appLog.installConsoleMirror()

app.whenReady().then(() => {
  startup.mark('app.whenReady')
  const autoLaunchClientId = getLaunchClientArg(process.argv)
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Create the window ASAP; managers are loaded lazily via IPC handlers.
  const mainWindow = createMainWindow({
    getAppIconPath,
    getSplashLogoDataUrl,
    rendererUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererIndexHtmlPath: join(__dirname, '../renderer/index.html'),
    getSettingsManager: managers.getSettingsManager,
    ensureTray: () => {
      tray.ensureTray()
    },
    setMainWindowRef: (win) => {
      mainWindowRef = win
    },
    setSplashWindowRef: (win) => {
      splashWindowRef = win
    },
    getIsQuitting: () => isQuitting
  })

  mainWindowRef = mainWindow
  startup.mark('createMainWindow() called')

  registerIpcHandlers({
    managers,
    appLog,
    getAppIconPath,
    ensureTray: () => {
      tray.ensureTray()
    },
    minimizeToTray: tray.minimizeToTray,
    restoreFromTray: tray.restoreFromTray
  })

  // If launched from a shortcut, auto-launch the requested client.
  if (autoLaunchClientId) {
    setTimeout(async () => {
      try {
        const cm = await managers.getClientManager()
        const gm = await managers.getGameManager()
        const client = cm.getClient(autoLaunchClientId)
        if (!client) throw new Error('Client not found.')

        const statusCallback = (status: string) => {
          console.log('[AutoLaunch]', status)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('launch-status', status)
          }
        }

        await gm.launchClient(autoLaunchClientId, client.linkOptions, statusCallback)
      } catch (error) {
        console.error('Auto-launch error:', error)
        dialog.showErrorBox('Auto-launch failed', (error as Error).message)
      }
    }, 750)
  }

  // Warm up common managers after the UI is visible (optional, avoids blocking first paint).
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      void managers.getClientManager()
      void managers.getSettingsManager()
    }, 0)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({
        getAppIconPath,
        getSplashLogoDataUrl,
        rendererUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
        preloadPath: join(__dirname, '../preload/index.js'),
        rendererIndexHtmlPath: join(__dirname, '../renderer/index.html'),
        getSettingsManager: managers.getSettingsManager,
        ensureTray: () => {
          tray.ensureTray()
        },
        setMainWindowRef: (win) => {
          mainWindowRef = win
        },
        setSplashWindowRef: (win) => {
          splashWindowRef = win
        },
        getIsQuitting: () => isQuitting
      })
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

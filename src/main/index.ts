import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// import icon from '../../resources/icon.png?asset'
import type { ClientManager } from './managers/ClientManager'
import type { GameManager } from './managers/GameManager'
import type { SettingsManager } from './managers/SettingsManager'
import type { GtaSettingsManager } from './managers/GtaSettingsManager'
import { getCitizenFxDir, getFiveMPath } from './utils/paths'

const startupTimingEnabled =
  process.env['FIVELAUNCH_STARTUP_TIMING'] === '1' || process.env['STARTUP_TIMING'] === '1'

const startupT0 = Date.now()
const startupMark = (label: string) => {
  if (!startupTimingEnabled) return
  const ms = Date.now() - startupT0
  console.log(`[startup +${ms}ms] ${label}`)
}

let clientManager: ClientManager | null = null
let gameManager: GameManager | null = null
let settingsManager: SettingsManager | null = null
let gtaSettingsManager: GtaSettingsManager | null = null

const getClientManager = async (): Promise<ClientManager> => {
  if (clientManager) return clientManager
  startupMark('Loading ClientManager…')
  const mod = await import('./managers/ClientManager')
  clientManager = new mod.ClientManager()
  startupMark('ClientManager ready')
  return clientManager
}

const getGameManager = async (): Promise<GameManager> => {
  if (gameManager) return gameManager
  startupMark('Loading GameManager…')
  const mod = await import('./managers/GameManager')
  gameManager = new mod.GameManager()
  startupMark('GameManager ready')
  return gameManager
}

const getSettingsManager = async (): Promise<SettingsManager> => {
  if (settingsManager) return settingsManager
  startupMark('Loading SettingsManager…')
  const mod = await import('./managers/SettingsManager')
  settingsManager = new mod.SettingsManager()
  startupMark('SettingsManager ready')
  return settingsManager
}

const getGtaSettingsManager = async (): Promise<GtaSettingsManager> => {
  if (gtaSettingsManager) return gtaSettingsManager
  startupMark('Loading GtaSettingsManager…')
  const mod = await import('./managers/GtaSettingsManager')
  gtaSettingsManager = new mod.GtaSettingsManager()
  startupMark('GtaSettingsManager ready')
  return gtaSettingsManager
}

const getAppIconPath = (): string => {
  return is.dev
    ? resolve(process.cwd(), 'resources', 'Logo-Full.ico')
    : join(process.resourcesPath, 'resources', 'Logo-Full.ico')
}

const sanitizeWindowsFileName = (name: string): string => {
  const sanitized = name.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim()
  return sanitized.length > 0 ? sanitized : 'shortcut'
}

const getLaunchClientArg = (argv: string[]): string | null => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--launch-client=')) {
      const value = arg.slice('--launch-client='.length).trim()
      if (value) return value
    }
    if (arg === '--launch-client') {
      const value = argv[i + 1]?.trim()
      if (value) return value
    }
  }
  return null
}

function createWindow(): BrowserWindow {
  const appIcon = getAppIconPath()

  const splashWindow = new BrowserWindow({
    width: 420,
    height: 240,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: true,
    icon: appIcon,
    webPreferences: {
      sandbox: false
    }
  })

  const splashHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Starting…</title>
        <style>
          :root { color-scheme: dark; }
          * { box-sizing: border-box; }
          html, body {
            height: 100%;
            margin: 0;
            overflow: hidden;
            background: transparent;
            font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
            -webkit-font-smoothing: antialiased;
            user-select: none;
          }
          .card {
            height: 100%;
            display: grid;
            place-items: center;
            padding: 18px;
          }
          .panel {
            width: 100%;
            height: 100%;
            background: rgba(16, 16, 20, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 16px;
            box-shadow: 0 20px 80px rgba(0,0,0,0.45);
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 14px;
            padding: 22px;
            position: relative;
            -webkit-app-region: drag;
          }
          .glow {
            position: absolute;
            inset: -30px;
            background: radial-gradient(closest-side, rgba(99,102,241,0.16), transparent 60%);
            pointer-events: none;
          }
          .title { font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.92); letter-spacing: 0.2px; }
          .sub { font-size: 12px; color: rgba(255,255,255,0.58); }
          .row { display: flex; align-items: center; gap: 10px; }
          .brand {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }
          .pill {
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 999px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
            color: rgba(255,255,255,0.65);
            letter-spacing: 0.2px;
          }
          .spinner {
            width: 16px;
            height: 16px;
            border-radius: 999px;
            border: 2px solid rgba(255,255,255,0.18);
            border-top-color: rgba(99, 102, 241, 0.95);
            animation: spin 0.9s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="panel">
            <div class="glow"></div>
            <div class="brand">
              <div class="title">FiveLaunch</div>
              <div class="pill">Starting…</div>
            </div>
            <div class="row">
              <div class="spinner" aria-label="Loading"></div>
              <div class="sub">Warming up the UI</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`)

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: appIcon,
    // ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  const showMainAndCloseSplash = () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  }

  // `ready-to-show` can be delayed a lot on some machines/builds.
  // Prefer showing as soon as the renderer has loaded, with a fallback timeout.
  mainWindow.webContents.once('did-finish-load', showMainAndCloseSplash)
  mainWindow.once('ready-to-show', showMainAndCloseSplash)

  const splashFallback = setTimeout(showMainAndCloseSplash, 3500)
  splashFallback.unref?.()

  mainWindow.on('closed', () => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  startupMark('app.whenReady')
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
  const mainWindow = createWindow()
  startupMark('createWindow() called')

  // IPC Handlers
  ipcMain.handle('get-clients', async () => {
    return (await getClientManager()).getClients()
  })

  ipcMain.handle('create-client', async (_event, name: string) => {
    return (await getClientManager()).createClient(name)
  })

  ipcMain.handle('delete-client', async (_event, id: string) => {
    return (await getClientManager()).deleteClient(id)
  })

  ipcMain.handle('rename-client', async (_event, id: string, name: string) => {
    return (await getClientManager()).renameClient(id, name)
  })

  ipcMain.handle('update-client-links', async (_event, id: string, linkOptions) => {
    return (await getClientManager()).updateClientLinkOptions(id, linkOptions)
  })

  ipcMain.handle('open-client-folder', async (_event, id: string) => {
    const folderPath = (await getClientManager()).getClientFolderPath(id)
    if (!folderPath) {
      throw new Error('Client folder not found.')
    }
    return shell.openPath(folderPath)
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

  ipcMain.handle('open-client-plugins-folder', async (_event, id: string) => {
    const folderPath = (await getClientManager()).getClientFolderPath(id)
    if (!folderPath) {
      throw new Error('Client folder not found.')
    }
    return shell.openPath(join(folderPath, 'plugins'))
  })

  ipcMain.handle('get-client-stats', async (_event, id: string) => {
    return (await getClientManager()).getClientStats(id)
  })

  ipcMain.handle('get-settings', async () => {
    return (await getSettingsManager()).getSettings()
  })

  ipcMain.handle('set-game-path', async (_event, gamePath: string) => {
    ;(await getSettingsManager()).setGamePath(gamePath)
  })

  ipcMain.handle('browse-game-path', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select FiveM.app folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('get-client-gta-settings', async (_event, id: string) => {
    return (await getGtaSettingsManager()).getClientSettings(id)
  })

  ipcMain.handle('save-client-gta-settings', async (_event, id: string, doc) => {
    ;(await getGtaSettingsManager()).saveClientSettings(id, doc)
  })

  ipcMain.handle('import-gta-settings-from-documents', async (_event, id: string) => {
    return (await getGtaSettingsManager()).importFromDocuments(id)
  })

  ipcMain.handle('import-gta-settings-from-template', async (_event, id: string) => {
    return (await getGtaSettingsManager()).importFromTemplate(id)
  })

  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle('window-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle('launch-client', async (event, id: string) => {
    try {
      const cm = await getClientManager()
      const gm = await getGameManager()
      const client = cm.getClient(id)
      if (!client) throw new Error('Client not found.')

      // Send status updates back to renderer
      const statusCallback = (status: string) => {
        event.sender.send('launch-status', status)
      }

      await gm.launchClient(id, client.linkOptions, statusCallback)
      return { success: true }
    } catch (error) {
      console.error('Launch error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('create-client-shortcut', async (_event, id: string) => {
    if (process.platform !== 'win32') {
      throw new Error('Shortcuts are currently supported on Windows only.')
    }

    const client = (await getClientManager()).getClient(id)
    if (!client) throw new Error('Client not found.')

    const desktopDir = app.getPath('desktop')
    const fileName = sanitizeWindowsFileName(`FiveM - ${client.name}.lnk`)
    const shortcutPath = join(desktopDir, fileName)

    const ok = shell.writeShortcutLink(shortcutPath, {
      target: process.execPath,
      args: `--launch-client=${id}`,
      description: `Launch ${client.name}`,
      icon: getAppIconPath()
    })

    if (!ok) {
      throw new Error('Failed to create shortcut.')
    }

    return { success: true, path: shortcutPath }
  })

  // If launched from a shortcut, auto-launch the requested client.
  if (autoLaunchClientId) {
    setTimeout(async () => {
      try {
        const cm = await getClientManager()
        const gm = await getGameManager()
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
      void getClientManager()
      void getSettingsManager()
    }, 0)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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

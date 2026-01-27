import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { format as formatUtil } from 'util'
import fs from 'fs'
// import icon from '../../resources/icon.png?asset'
import type { ClientManager } from './managers/ClientManager'
import type { GameManager } from './managers/GameManager'
import type { SettingsManager } from './managers/SettingsManager'
import type { GtaSettingsManager } from './managers/GtaSettingsManager'
import { getCitizenFxDir, getFiveMPath } from './utils/paths'
import { checkForUpdatesOnGitHub, type UpdateStatus } from './utils/updateChecker'

const startupTimingEnabled =
  process.env['FIVELAUNCH_STARTUP_TIMING'] === '1' || process.env['STARTUP_TIMING'] === '1'

const startupT0 = Date.now()
let splashWindowRef: BrowserWindow | null = null

const setSplashStatus = (text: string): void => {
  try {
    if (!splashWindowRef || splashWindowRef.isDestroyed()) return
    const safe = JSON.stringify(String(text))
    splashWindowRef.webContents.executeJavaScript(
      `window.__setStatus && window.__setStatus(${safe});`,
      true
    )
  } catch {
    // ignore
  }
}

const startupMark = (label: string) => {
  setSplashStatus(label)
  if (!startupTimingEnabled) return
  const ms = Date.now() - startupT0
  console.log(`[startup +${ms}ms] ${label}`)
}

type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'
type AppLogEntry = {
  id: number
  ts: number
  level: AppLogLevel
  message: string
}

const APP_LOG_BUFFER_LIMIT = 800
const appLogBuffer: AppLogEntry[] = []
let appLogSeq = 0
let mainWindowRef: BrowserWindow | null = null
let trayRef: Tray | null = null
let isQuitting = false

let updateStatusCache: { ts: number; value: UpdateStatus } | null = null
const UPDATE_CACHE_TTL_MS = 15 * 60 * 1000
const GITHUB_REPO = 'oyuh/fivelaunch'

const ensureTray = (): Tray => {
  if (trayRef) return trayRef

  const iconPath = getAppIconPath()
  const img = nativeImage.createFromPath(iconPath)
  const tray = new Tray(img.isEmpty() ? iconPath : img)

  tray.setToolTip('FiveLaunch')

  tray.on('click', () => {
    const win = mainWindowRef
    if (!win || win.isDestroyed()) return
    win.setSkipTaskbar(false)
    win.show()
    win.focus()
  })

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show FiveLaunch',
      click: () => {
        const win = mainWindowRef
        if (!win || win.isDestroyed()) return
        win.setSkipTaskbar(false)
        win.show()
        win.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  trayRef = tray
  return tray
}

const minimizeToTray = (): void => {
  ensureTray()
  const win = mainWindowRef
  if (!win || win.isDestroyed()) return
  win.hide()
  win.setSkipTaskbar(true)
}

const restoreFromTray = (): void => {
  const win = mainWindowRef
  if (!win || win.isDestroyed()) return
  win.setSkipTaskbar(false)
  win.show()
  win.focus()
}

const pushAppLog = (level: AppLogLevel, args: unknown[]): void => {
  const message = formatUtil(...(args as any[]))
  const entry: AppLogEntry = {
    id: (appLogSeq += 1),
    ts: Date.now(),
    level,
    message
  }

  appLogBuffer.push(entry)
  if (appLogBuffer.length > APP_LOG_BUFFER_LIMIT) {
    appLogBuffer.splice(0, appLogBuffer.length - APP_LOG_BUFFER_LIMIT)
  }

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('app-log', entry)
  }
}

// Mirror main-process console output into a buffer so the UI can show it.
// Keep this lightweight and non-throwing.
const installConsoleLogMirror = (): void => {
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  console.log = (...args: unknown[]) => {
    original.log(...args)
    pushAppLog('info', args)
  }
  console.info = (...args: unknown[]) => {
    original.info(...args)
    pushAppLog('info', args)
  }
  console.warn = (...args: unknown[]) => {
    original.warn(...args)
    pushAppLog('warn', args)
  }
  console.error = (...args: unknown[]) => {
    original.error(...args)
    pushAppLog('error', args)
  }
}

installConsoleLogMirror()

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

const getSplashLogoDataUrl = (): string | null => {
  const logoPath = is.dev
    ? resolve(process.cwd(), 'resources', 'Logo.png')
    : join(process.resourcesPath, 'resources', 'Logo.png')

  try {
    if (!fs.existsSync(logoPath)) return null
    const buf = fs.readFileSync(logoPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
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
  const splashLogo = getSplashLogoDataUrl()

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

  splashWindowRef = splashWindow

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
            background: rgba(12, 12, 16, 0.92);
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
          .logo {
            width: 86px;
            height: 86px;
            border-radius: 18px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.10);
            display: grid;
            place-items: center;
            overflow: hidden;
            box-shadow: 0 14px 40px rgba(0,0,0,0.35);
          }
          .logo img {
            width: 72px;
            height: 72px;
            object-fit: contain;
            filter: drop-shadow(0 10px 18px rgba(0,0,0,0.35));
          }
          .brandTitle {
            margin-top: 2px;
            font-size: 16px;
            font-weight: 800;
            color: rgba(255,255,255,0.92);
            letter-spacing: 0.2px;
            text-align: center;
          }
          .statusBox {
            width: 100%;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.10);
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .statusLabel {
            font-size: 12px;
            color: rgba(255,255,255,0.72);
            white-space: nowrap;
          }
          .statusText {
            font-size: 12px;
            color: rgba(255,255,255,0.58);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
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
            <div style="display:flex; flex-direction:column; align-items:center; gap: 12px;">
              <div class="logo">
                ${splashLogo ? `<img src="${splashLogo}" alt="FiveLaunch" />` : `<div style="font-weight:800;color:rgba(255,255,255,0.85);">FL</div>`}
              </div>
              <div class="brandTitle">FiveLaunch</div>
            </div>

            <div class="statusBox" style="margin-top: 2px;">
              <div class="spinner" aria-label="Loading"></div>
              <div class="statusLabel">Status</div>
              <div id="status" class="statusText">Starting…</div>
            </div>
          </div>
        </div>

        <script>
          (function () {
            var el = document.getElementById('status');
            var messages = [
              'Starting…',
              'Loading renderer…',
              'Warming up…',
              'Almost there…'
            ];
            var i = 0;
            window.__setStatus = function (text) {
              if (!el) return;
              el.textContent = String(text || '');
            };
            setInterval(function () {
              if (!el) return;
              if (el.textContent && el.textContent !== 'Starting…') return;
              i = (i + 1) % messages.length;
              el.textContent = messages[i];
            }, 750);
          })();
        </script>
      </body>
    </html>
  `

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`)
  setSplashStatus('Starting…')

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

  // Ensure `mainWindowRef` is available even before app.whenReady finishes wiring.
  mainWindowRef = mainWindow

  // If the user minimizes the window via OS controls/taskbar, optionally route it to tray.
  mainWindow.on('minimize', (event) => {
    void (async () => {
      try {
        const settings = (await getSettingsManager()).getSettings()
        if (!settings.minimizeToTrayOnGameLaunch) return

        // Some Electron events support preventDefault; guard in case it doesn't.
        ;(event as any)?.preventDefault?.()
        ensureTray()
        mainWindow.hide()
        mainWindow.setSkipTaskbar(true)
      } catch {
        // ignore
      }
    })()
  })

  const showMainAndCloseSplash = () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
    splashWindowRef = null
  }

  // `ready-to-show` can be delayed a lot on some machines/builds.
  // Prefer showing as soon as the renderer has loaded, with a fallback timeout.
  setSplashStatus('Loading UI…')
  mainWindow.webContents.once('did-finish-load', showMainAndCloseSplash)
  mainWindow.once('ready-to-show', showMainAndCloseSplash)

  const splashFallback = setTimeout(showMainAndCloseSplash, 3500)
  splashFallback.unref?.()

  mainWindow.on('closed', () => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  })

  mainWindow.on('close', () => {
    // Intentionally left as normal close behavior.
    // Tray mode is only triggered on game launch; Quit is handled via the tray menu.
    if (isQuitting) return
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
  mainWindowRef = mainWindow
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

  ipcMain.handle('get-update-status', async () => {
    const now = Date.now()
    if (updateStatusCache && now - updateStatusCache.ts < UPDATE_CACHE_TTL_MS) {
      return updateStatusCache.value
    }

    const currentVersion = app.getVersion()
    const status = await checkForUpdatesOnGitHub({ repo: GITHUB_REPO, currentVersion })
    updateStatusCache = { ts: now, value: status }
    return status
  })

  ipcMain.handle('get-resolved-game-path', async () => {
    return getFiveMPath()
  })

  ipcMain.handle('get-app-logs', async () => {
    return appLogBuffer
  })

  ipcMain.handle('clear-app-logs', async () => {
    appLogBuffer.length = 0
  })

  ipcMain.handle('get-game-busy-state', async () => {
    return (await getGameManager()).getBusyState()
  })

  ipcMain.handle('set-game-path', async (_event, gamePath: string) => {
    ;(await getSettingsManager()).setGamePath(gamePath)
  })

  ipcMain.handle('set-minimize-to-tray-on-game-launch', async (_event, enabled: boolean) => {
    ;(await getSettingsManager()).setMinimizeToTrayOnGameLaunch(Boolean(enabled))
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

  ipcMain.handle('window-minimize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const settings = (await getSettingsManager()).getSettings()
    if (settings.minimizeToTrayOnGameLaunch) {
      ensureTray()
      win.hide()
      win.setSkipTaskbar(true)
      return
    }

    win.minimize()
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
      const settings = (await getSettingsManager()).getSettings()
      if (settings.minimizeToTrayOnGameLaunch) {
        minimizeToTray()
      }

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
      restoreFromTray()
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

import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// import icon from '../../resources/icon.png?asset'
import { ClientManager } from './managers/ClientManager'
import { GameManager } from './managers/GameManager'
import { SettingsManager } from './managers/SettingsManager'
import { GtaSettingsManager } from './managers/GtaSettingsManager'
import { getCitizenFxDir, getFiveMPath } from './utils/paths'

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
          html, body { height: 100%; margin: 0; background: transparent; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
          .card {
            height: 100%;
            display: grid;
            place-items: center;
            padding: 18px;
          }
          .panel {
            width: 100%;
            height: 100%;
            background: rgba(20, 20, 24, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 16px;
            box-shadow: 0 20px 80px rgba(0,0,0,0.45);
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 14px;
            padding: 22px;
          }
          .title { font-size: 16px; font-weight: 650; color: rgba(255,255,255,0.92); letter-spacing: 0.2px; }
          .sub { font-size: 12px; color: rgba(255,255,255,0.58); }
          .row { display: flex; align-items: center; gap: 10px; }
          .dots { display: inline-flex; gap: 6px; }
          .dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.18); animation: pulse 1.2s infinite ease-in-out; }
          .dot:nth-child(2) { animation-delay: 0.15s; }
          .dot:nth-child(3) { animation-delay: 0.30s; }
          @keyframes pulse {
            0%, 100% { transform: translateY(0); background: rgba(255,255,255,0.18); }
            50% { transform: translateY(-2px); background: rgba(99, 102, 241, 0.85); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="panel">
            <div class="title">Starting FiveLaunch</div>
            <div class="row">
              <div class="dots" aria-label="Loading">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
              </div>
              <div class="sub">Loading UI…</div>
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

  mainWindow.on('ready-to-show', () => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
    mainWindow.show()
  })

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
  // Instantiate Managers after app is ready
  const clientManager = new ClientManager()
  const gameManager = new GameManager()
  const settingsManager = new SettingsManager()
  const gtaSettingsManager = new GtaSettingsManager()
  const autoLaunchClientId = getLaunchClientArg(process.argv)
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers
  ipcMain.handle('get-clients', () => {
    return clientManager.getClients()
  })

  ipcMain.handle('create-client', (_event, name: string) => {
    return clientManager.createClient(name)
  })

  ipcMain.handle('delete-client', (_event, id: string) => {
    return clientManager.deleteClient(id)
  })

  ipcMain.handle('rename-client', (_event, id: string, name: string) => {
    return clientManager.renameClient(id, name)
  })

  ipcMain.handle('update-client-links', (_event, id: string, linkOptions) => {
    return clientManager.updateClientLinkOptions(id, linkOptions)
  })

  ipcMain.handle('open-client-folder', async (_event, id: string) => {
    const folderPath = clientManager.getClientFolderPath(id)
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

  ipcMain.handle('get-client-stats', (_event, id: string) => {
    return clientManager.getClientStats(id)
  })

  ipcMain.handle('get-settings', () => {
    return settingsManager.getSettings()
  })

  ipcMain.handle('set-game-path', (_event, gamePath: string) => {
    settingsManager.setGamePath(gamePath)
  })

  ipcMain.handle('browse-game-path', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select FiveM.app folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('get-client-gta-settings', (_event, id: string) => {
    return gtaSettingsManager.getClientSettings(id)
  })

  ipcMain.handle('save-client-gta-settings', (_event, id: string, doc) => {
    gtaSettingsManager.saveClientSettings(id, doc)
  })

  ipcMain.handle('import-gta-settings-from-documents', (_event, id: string) => {
    return gtaSettingsManager.importFromDocuments(id)
  })

  ipcMain.handle('import-gta-settings-from-template', (_event, id: string) => {
    return gtaSettingsManager.importFromTemplate(id)
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
      const client = clientManager.getClient(id)
      if (!client) throw new Error('Client not found.')

      // Send status updates back to renderer
      const statusCallback = (status: string) => {
        event.sender.send('launch-status', status)
      }

      await gameManager.launchClient(id, client.linkOptions, statusCallback)
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

    const client = clientManager.getClient(id)
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

  const mainWindow = createWindow()

  // If launched from a shortcut, auto-launch the requested client.
  if (autoLaunchClientId) {
    setTimeout(async () => {
      try {
        const client = clientManager.getClient(autoLaunchClientId)
        if (!client) throw new Error('Client not found.')

        const statusCallback = (status: string) => {
          console.log('[AutoLaunch]', status)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('launch-status', status)
          }
        }

        await gameManager.launchClient(autoLaunchClientId, client.linkOptions, statusCallback)
      } catch (error) {
        console.error('Auto-launch error:', error)
        dialog.showErrorBox('Auto-launch failed', (error as Error).message)
      }
    }, 750)
  }

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

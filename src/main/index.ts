import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// import icon from '../../resources/icon.png?asset'
import { ClientManager } from './managers/ClientManager'
import { GameManager } from './managers/GameManager'
import { SettingsManager } from './managers/SettingsManager'
import { GtaSettingsManager } from './managers/GtaSettingsManager'
import { getCitizenFxDir, getFiveMPath } from './utils/paths'

function createWindow(): void {
  const appIcon = is.dev
    ? resolve(process.cwd(), 'resources', 'Logo-Full.ico')
    : join(process.resourcesPath, 'resources', 'Logo-Full.ico')

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
    mainWindow.show()
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
}

app.whenReady().then(() => {
  // Instantiate Managers after app is ready
  const clientManager = new ClientManager()
  const gameManager = new GameManager()
  const settingsManager = new SettingsManager()
  const gtaSettingsManager = new GtaSettingsManager()
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

  createWindow()

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

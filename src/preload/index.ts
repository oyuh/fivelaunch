import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getClients: () => ipcRenderer.invoke('get-clients'),
  createClient: (name: string) => ipcRenderer.invoke('create-client', name),
  deleteClient: (id: string) => ipcRenderer.invoke('delete-client', id),
  renameClient: (id: string, name: string) => ipcRenderer.invoke('rename-client', id, name),
  openClientFolder: (id: string) => ipcRenderer.invoke('open-client-folder', id),
  openClientPluginsFolder: (id: string) => ipcRenderer.invoke('open-client-plugins-folder', id),
  openCitizenFxFolder: () => ipcRenderer.invoke('open-citizenfx-folder'),
  openFiveMFolder: () => ipcRenderer.invoke('open-fivem-folder'),
  openFiveMPluginsFolder: () => ipcRenderer.invoke('open-fivem-plugins-folder'),
  updateClientLinks: (id: string, linkOptions: unknown) =>
    ipcRenderer.invoke('update-client-links', id, linkOptions),
  launchClient: (id: string) => ipcRenderer.invoke('launch-client', id),
  onLaunchStatus: (callback: (status: string) => void) => {
    const subscription = (_event: any, status: string) => callback(status)
    ipcRenderer.on('launch-status', subscription)
    return () => ipcRenderer.removeListener('launch-status', subscription)
  },
  getResolvedGamePath: () => ipcRenderer.invoke('get-resolved-game-path'),
  getAppLogs: () => ipcRenderer.invoke('get-app-logs'),
  clearAppLogs: () => ipcRenderer.invoke('clear-app-logs'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  onAppLog: (callback: (entry: any) => void) => {
    const subscription = (_event: any, entry: any) => callback(entry)
    ipcRenderer.on('app-log', subscription)
    return () => ipcRenderer.removeListener('app-log', subscription)
  },
  getGameBusyState: () => ipcRenderer.invoke('get-game-busy-state'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setGamePath: (gamePath: string) => ipcRenderer.invoke('set-game-path', gamePath),
  setMinimizeToTrayOnGameLaunch: (enabled: boolean) =>
    ipcRenderer.invoke('set-minimize-to-tray-on-game-launch', enabled),
  browseGamePath: () => ipcRenderer.invoke('browse-game-path'),
  getClientGtaSettings: (id: string) => ipcRenderer.invoke('get-client-gta-settings', id),
  saveClientGtaSettings: (id: string, doc: unknown) =>
    ipcRenderer.invoke('save-client-gta-settings', id, doc),
  importGtaSettingsFromDocuments: (id: string) =>
    ipcRenderer.invoke('import-gta-settings-from-documents', id),
  importGtaSettingsFromTemplate: (id: string) =>
    ipcRenderer.invoke('import-gta-settings-from-template', id),
  getClientStats: (id: string) => ipcRenderer.invoke('get-client-stats', id),
  createClientShortcut: (id: string) => ipcRenderer.invoke('create-client-shortcut', id)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

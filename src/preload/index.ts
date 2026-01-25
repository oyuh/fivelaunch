import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getClients: () => ipcRenderer.invoke('get-clients'),
  createClient: (name: string) => ipcRenderer.invoke('create-client', name),
  deleteClient: (id: string) => ipcRenderer.invoke('delete-client', id),
  renameClient: (id: string, name: string) => ipcRenderer.invoke('rename-client', id, name),
  openClientFolder: (id: string) => ipcRenderer.invoke('open-client-folder', id),
  openCitizenFxFolder: () => ipcRenderer.invoke('open-citizenfx-folder'),
  openFiveMFolder: () => ipcRenderer.invoke('open-fivem-folder'),
  updateClientLinks: (id: string, linkOptions: unknown) =>
    ipcRenderer.invoke('update-client-links', id, linkOptions),
  launchClient: (id: string) => ipcRenderer.send('launch-client', id),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close')
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

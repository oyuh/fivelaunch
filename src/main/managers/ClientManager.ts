import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { ClientConfig, ClientProfile, LinkOptions } from '../types'
import { getClientConfigPath, getClientsDataPath } from '../utils/paths'

export class ClientManager {
  private configPath: string
  private dataPath: string

  constructor() {
    this.configPath = getClientConfigPath()
    this.dataPath = getClientsDataPath()
    this.ensureInitialized()
  }

  private ensureInitialized() {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true })
    }

    if (!fs.existsSync(this.configPath)) {
      const initialConfig: ClientConfig = {
        clients: [],
        selectedClientId: null
      }
      this.saveConfig(initialConfig)
    }
  }

  private getConfig(): ClientConfig {
    try {
      const data = fs.readFileSync(this.configPath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      return { clients: [], selectedClientId: null }
    }
  }

  private saveConfig(config: ClientConfig) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
  }

  public getClients(): ClientProfile[] {
    return this.getConfig().clients
  }

  public getClient(id: string): ClientProfile | undefined {
    return this.getConfig().clients.find((c) => c.id === id)
  }

  public getClientFolderPath(id: string): string | null {
    const clientPath = path.join(this.dataPath, id)
    return fs.existsSync(clientPath) ? clientPath : null
  }

  public createClient(name: string, description?: string): ClientProfile {
    const config = this.getConfig()
    const id = randomUUID()

    const defaultLinkOptions: LinkOptions = {
      mods: true,
      plugins: true,
      pluginsMode: 'sync',
      citizen: false,
      gtaSettings: false,
      citizenFxIni: false
    }

    const newClient: ClientProfile = {
      id,
      name,
      description,
      lastPlayed: Date.now(),
      linkOptions: defaultLinkOptions
    }

    // Create folder structure
    const clientPath = path.join(this.dataPath, id)
    fs.mkdirSync(clientPath, { recursive: true })
    fs.mkdirSync(path.join(clientPath, 'mods'), { recursive: true })
    fs.mkdirSync(path.join(clientPath, 'plugins'), { recursive: true })
    fs.mkdirSync(path.join(clientPath, 'citizen'), { recursive: true })
    // Settings folder + placeholder files
    const settingsPath = path.join(clientPath, 'settings')
    fs.mkdirSync(settingsPath, { recursive: true })
    const gtaSettingsPath = path.join(settingsPath, 'settings.xml')
    const citizenFxIniPath = path.join(settingsPath, 'CitizenFX.ini')
    if (!fs.existsSync(gtaSettingsPath)) fs.writeFileSync(gtaSettingsPath, '')
    if (!fs.existsSync(citizenFxIniPath)) fs.writeFileSync(citizenFxIniPath, '')

    config.clients.push(newClient)
    this.saveConfig(config)
    return newClient
  }

  public deleteClient(id: string) {
    const config = this.getConfig()
    config.clients = config.clients.filter((c) => c.id !== id)
    if (config.selectedClientId === id) {
      config.selectedClientId = null
    }

    // Remove folder
    const clientPath = path.join(this.dataPath, id)
    if (fs.existsSync(clientPath)) {
      fs.rmSync(clientPath, { recursive: true, force: true })
    }

    this.saveConfig(config)
  }

  public renameClient(id: string, name: string) {
    const config = this.getConfig()
    const client = config.clients.find((c) => c.id === id)
    if (!client) return
    client.name = name
    this.saveConfig(config)
  }

  public updateClientLinkOptions(id: string, linkOptions: LinkOptions) {
    const config = this.getConfig()
    const client = config.clients.find((c) => c.id === id)
    if (!client) return
    client.linkOptions = linkOptions
    this.saveConfig(config)
  }

  public getClientStats(id: string): { fileCount: number; totalBytes: number } {
    const clientPath = this.getClientFolderPath(id)
    if (!clientPath) return { fileCount: 0, totalBytes: 0 }
    return this.getFolderStats(clientPath)
  }

  private getFolderStats(folderPath: string): { fileCount: number; totalBytes: number } {
    let fileCount = 0
    let totalBytes = 0

    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name)
      const stats = fs.lstatSync(fullPath)

      if (stats.isSymbolicLink()) {
        continue
      }

      if (stats.isDirectory()) {
        const nested = this.getFolderStats(fullPath)
        fileCount += nested.fileCount
        totalBytes += nested.totalBytes
      } else if (stats.isFile()) {
        fileCount += 1
        totalBytes += stats.size
      }
    }

    return { fileCount, totalBytes }
  }
}

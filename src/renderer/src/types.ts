export interface ClientProfile {
  id: string
  name: string
  description?: string
  lastPlayed?: number
  linkOptions: LinkOptions
}

export interface LinkOptions {
  mods: boolean
  plugins: boolean
  citizen: boolean
  gtaSettings: boolean
  citizenFxIni: boolean
}

export interface GtaSettingsItem {
  id: string
  path: string
  attributes: Record<string, string>
}

export interface GtaSettingsDocument {
  rootName: string
  items: Array<Omit<GtaSettingsItem, 'id'>>
}

export interface ClientStats {
  fileCount: number
  totalBytes: number
}

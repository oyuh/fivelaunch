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

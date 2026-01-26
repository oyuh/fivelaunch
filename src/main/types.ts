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
  /**
   * How to provide the per-client plugins into FiveM.app.
   * - junction: FiveM.app/plugins is a junction to the client plugins folder (fast, but apps may resolve/open the target path)
   * - sync: keep FiveM.app/plugins as a real folder and copy/sync files to/from the client plugins folder (ReShade will see the FiveM.app path)
   */
  pluginsMode?: 'junction' | 'sync'
  citizen: boolean
  gtaSettings: boolean
  citizenFxIni: boolean
}

export interface ClientConfig {
  clients: ClientProfile[]
  selectedClientId: string | null
}

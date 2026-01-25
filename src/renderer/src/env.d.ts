/// <reference types="vite/client" />

import type { ClientProfile, LinkOptions } from './types'

interface IAPI {
  getClients: () => Promise<ClientProfile[]>
  createClient: (name: string) => Promise<ClientProfile>
  deleteClient: (id: string) => Promise<void>
  renameClient: (id: string, name: string) => Promise<void>
  openClientFolder: (id: string) => Promise<string>
  openCitizenFxFolder: () => Promise<string>
  openFiveMFolder: () => Promise<string>
  updateClientLinks: (id: string, linkOptions: LinkOptions) => Promise<void>
  launchClient: (id: string) => void
  windowMinimize: () => Promise<void>
  windowToggleMaximize: () => Promise<void>
  windowClose: () => Promise<void>
}

declare global {
  interface Window {
    electron: any
    api: IAPI
  }
}

interface ImportMetaEnv {
  readonly VITE_COMMIT_SHA?: string
  readonly VITE_COMMIT_SHORT?: string
  readonly VITE_COMMIT_MESSAGE?: string
  readonly VITE_COMMIT_DATE?: string
  readonly VITE_COMMIT_URL?: string
  readonly VITE_COMMIT_API?: string
  readonly VITE_REPO_URL?: string
  readonly VITE_SUPPORT_URL?: string
}

declare global {
  const __COMMIT_INFO__:
    | {
        sha: string
        shortSha: string
        message: string
        date: string
        url: string
        apiUrl: string
      }
    | null
  const __REPO_URL__: string
  const __SUPPORT_URL__: string
}

export {}

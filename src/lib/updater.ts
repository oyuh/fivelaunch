import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export interface UpdateInfo {
  version: string
  notes: string
  date?: string
}

export type DownloadProgress = { downloaded: number; total: number | null; done: boolean }

export interface Updater {
  /** Check the release channel. Returns the update, or null if up to date. */
  check(): Promise<UpdateInfo | null>
  /** Download + install the update found by the last `check()`. */
  downloadAndInstall(onProgress: (p: DownloadProgress) => void): Promise<void>
  /** Relaunch into the freshly installed version. */
  restart(): Promise<void>
}

// --- Real implementation (Tauri updater plugin) ---------------------------
let pending: Update | null = null

const realUpdater: Updater = {
  async check() {
    const update = await check()
    if (!update) return null
    pending = update
    return { version: update.version, notes: update.body ?? '', date: update.date }
  },
  async downloadAndInstall(onProgress) {
    if (!pending) throw new Error('No update available to install.')
    let total: number | null = null
    let downloaded = 0
    await pending.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? null
        onProgress({ downloaded: 0, total, done: false })
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        onProgress({ downloaded, total, done: false })
      } else if (event.event === 'Finished') {
        onProgress({ downloaded, total, done: true })
      }
    })
  },
  async restart() {
    await relaunch()
  }
}

// --- Simulated implementation (bun run ui preview) ------------------------
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const mockUpdater: Updater = {
  async check() {
    await delay(500)
    return {
      version: '2.5.0',
      notes: [
        'Automatic in-app updates · no more manual downloads.',
        'Flat buttons, themed tooltips, and a per-client icon picker.',
        'Reworked GTA settings editor and persistent logs.'
      ].join('\n'),
      date: new Date().toISOString()
    }
  },
  async downloadAndInstall(onProgress) {
    const total = 48_000_000
    let downloaded = 0
    onProgress({ downloaded, total, done: false })
    while (downloaded < total) {
      await delay(140)
      downloaded = Math.min(total, downloaded + total / 18)
      onProgress({ downloaded, total, done: false })
    }
    onProgress({ downloaded: total, total, done: true })
  },
  async restart() {
    await delay(400)
  }
}

/** In the preview harness, `window.__FL_MOCK_UPDATER__` selects the simulation. */
export const updater: Updater =
  typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__FL_MOCK_UPDATER__
    ? mockUpdater
    : realUpdater

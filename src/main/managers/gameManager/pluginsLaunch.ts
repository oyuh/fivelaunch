import fs from 'fs'
import path from 'path'
import {
  isSafeRuntimePluginFile,
  mirrorFolderPreferNewestOneWayAsync,
  mirrorFolderSourceWinsOneWayAsync
} from './pluginsMirror'
import { fnv1a32Hex } from './hash'

/**
 * Tracks plugin launch bookkeeping across launches.
 */
export type PluginsLaunchState = {
  /**
   * A promise representing a post-exit finalization sync (if any).
   * Used to expose "busy" state to the UI.
   */
  pendingFinalization: Promise<void> | null

  /**
   * In-memory mtime caches to reduce IO on repeat launches.
   */
  pluginsMirrorCache: Map<string, Map<string, number>>
}

function pluginsOwnerMarkerPath(dir: string): string {
  return path.join(dir, '.fivelaunch-plugins-owner.json')
}

function getManagedMarkerFile(dir: string): string {
  return path.join(dir, '.managed-by-fivem-clients')
}

function getPluginsMirrorCacheKey(clientId: string, direction: 'client->game' | 'game->client'): string {
  return `${clientId}:${direction}`
}

function getPluginsMirrorCacheFile(clientPath: string, direction: 'client->game' | 'game->client'): string {
  return path.join(
    clientPath,
    'settings',
    direction === 'client->game' ? 'plugins-cache-client-to-game.json' : 'plugins-cache-game-to-client.json'
  )
}

function loadPluginsMirrorCache(state: PluginsLaunchState, cacheKey: string, cachePath: string): Map<string, number> {
  const existing = state.pluginsMirrorCache.get(cacheKey)
  if (existing) return existing

  const map = new Map<string, number>()
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, number>
      for (const [rel, mtime] of Object.entries(parsed)) {
        if (typeof mtime === 'number') map.set(rel, mtime)
      }
    }
  } catch {
    // ignore
  }

  state.pluginsMirrorCache.set(cacheKey, map)
  return map
}

function savePluginsMirrorCache(cachePath: string, cache: Map<string, number>): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    const obj: Record<string, number> = {}
    for (const [rel, mtime] of cache.entries()) obj[rel] = mtime
    fs.writeFileSync(cachePath, JSON.stringify(obj), 'utf8')
  } catch {
    // ignore
  }
}

function writePluginsOwnerMarker(dir: string, payload: { clientId: string; mode: 'sync' | 'junction' }): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      pluginsOwnerMarkerPath(dir),
      JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2),
      'utf8'
    )
  } catch {
    // ignore
  }
}

function readPluginsOwnerMarker(dir: string): { clientId?: string; mode?: string; at?: string } | null {
  try {
    const p = pluginsOwnerMarkerPath(dir)
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    return JSON.parse(raw) as { clientId?: string; mode?: string; at?: string }
  } catch {
    return null
  }
}

function realpathBestEffort(p: string): string {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p)
  } catch {
    return p
  }
}

function createStepLogger(deps: {
  reshadeClientDir: string
  reshadeLog: (reshadeClientDir: string, message: string, statusCallback?: (status: string) => void) => void
  statusCallback?: (status: string) => void
}) {
  const { reshadeClientDir, reshadeLog, statusCallback } = deps

  const step = (name: string, fn: () => void) => {
    try {
      fn()
    } catch (err) {
      try {
        reshadeLog(reshadeClientDir, `Plugins sync ERROR at step=${name}: ${(err as Error).message}`, statusCallback)
      } catch {
        // ignore
      }
      throw err
    }
  }

  const stepAsync = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      try {
        reshadeLog(reshadeClientDir, `Plugins sync ERROR at step=${name}: ${(err as Error).message}`, statusCallback)
      } catch {
        // ignore
      }
      throw err
    }
  }

  return { step, stepAsync }
}

function prepareGamePluginsDirForSyncMode(
  gamePluginsDir: string,
  clientId: string,
  renameWithRetrySync: (from: string, to: string) => void,
  statusCallback?: (status: string) => void
): void {
  const markerFile = getManagedMarkerFile(gamePluginsDir)

  if (fs.existsSync(gamePluginsDir)) {
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(gamePluginsDir)
    } catch {
      stats = null as unknown as fs.Stats
    }

    if (stats) {
      if (stats.isSymbolicLink()) {
        // Previous run might have left this as a junction (junction mode). Remove it.
        try {
          fs.unlinkSync(gamePluginsDir)
        } catch {
          // ignore
        }
      } else if (stats.isDirectory()) {
        const managed = fs.existsSync(markerFile)
        const owner = readPluginsOwnerMarker(gamePluginsDir)
        const ownerId = owner?.clientId

        // If this folder isn't ours, or it was owned by another client, rotate it away.
        // This prevents cross-client plugin leakage in sync mode.
        if (!managed || !ownerId || ownerId !== clientId) {
          const ownerTag = ownerId ? fnv1a32Hex(ownerId) : 'unknown'
          const kind = managed ? `managed_${ownerTag}` : 'unmanaged'
          const backupPath = `${gamePluginsDir}_${kind}_backup_${Date.now()}`

          statusCallback?.('Isolating FiveM plugins folder for this client...')
          try {
            renameWithRetrySync(gamePluginsDir, backupPath)
          } catch (err) {
            const code = (err as NodeJS.ErrnoException)?.code
            throw new Error(
              `Failed to isolate plugins folder (code=${code ?? 'unknown'}): ${gamePluginsDir}. Close FiveM/overlays and try again.`
            )
          }
        }
      } else {
        // Unexpected file at plugins path; move it aside.
        try {
          fs.renameSync(gamePluginsDir, `${gamePluginsDir}_backup_${Date.now()}`)
        } catch {
          // ignore
        }
      }
    }
  }

  try {
    fs.mkdirSync(gamePluginsDir, { recursive: true })
  } catch {
    // ignore
  }
  try {
    fs.writeFileSync(markerFile, `managed\n`, 'utf8')
  } catch {
    // ignore
  }

  // Always stamp ownership for debugging + correctness.
  writePluginsOwnerMarker(gamePluginsDir, { clientId, mode: 'sync' })
}

async function runPluginsSyncMode(params: {
  state: PluginsLaunchState
  clientId: string
  clientPath: string
  clientPluginsDir: string
  gamePluginsDir: string
  statusCallback?: (status: string) => void
  isProcessRunning: (processName: string) => boolean
  registerInterval: (interval: NodeJS.Timeout) => NodeJS.Timeout
  renameWithRetrySync: (from: string, to: string) => void
  reshadeLog: (reshadeClientDir: string, message: string, statusCallback?: (status: string) => void) => void
}): Promise<void> {
  const {
    state,
    clientId,
    clientPath,
    clientPluginsDir,
    gamePluginsDir,
    statusCallback,
    isProcessRunning,
    registerInterval,
    renameWithRetrySync,
    reshadeLog
  } = params

  statusCallback?.('Syncing plugins (copy mode)...')

  const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')
  try {
    fs.mkdirSync(reshadeClientDir, { recursive: true })
  } catch {
    // ignore
  }

  const { step, stepAsync } = createStepLogger({ reshadeClientDir, reshadeLog, statusCallback })

  step('mkdir client plugins', () => {
    fs.mkdirSync(clientPluginsDir, { recursive: true })
  })

  step('prepare isolated game plugins directory', () => {
    prepareGamePluginsDirForSyncMode(gamePluginsDir, clientId, renameWithRetrySync, statusCallback)
  })

  await stepAsync('initial mirror client->game', async () => {
    const cachePath = getPluginsMirrorCacheFile(clientPath, 'client->game')
    const cacheKey = getPluginsMirrorCacheKey(clientId, 'client->game')
    const cache = loadPluginsMirrorCache(state, cacheKey, cachePath)
    let lastProgressAt = 0

    await mirrorFolderSourceWinsOneWayAsync(clientPluginsDir, gamePluginsDir, {
      yieldEvery: 250,
      onProgress: ({ processed, copied }) => {
        const now = Date.now()
        if (now - lastProgressAt < 750) return
        lastProgressAt = now
        statusCallback?.(`Syncing plugins (copy mode)... ${processed} scanned, ${copied} updated`)
      },
      // Cache optimization: if a file's source mtime hasn't changed since last launch and the target exists,
      // skip touching the target entirely (saves a lot of IO on repeat launches).
      cacheGetMtime: (rel) => cache.get(rel),
      cacheSetMtime: (rel, mtime) => cache.set(rel, mtime)
    })

    savePluginsMirrorCache(cachePath, cache)
  })

  const keepSyncingWhileGameRuns = () => isProcessRunning('FiveM.exe') || isProcessRunning('GTA5.exe')

  // Runtime: conservative background syncing of safe file types.
  try {
    let wasRunning = false
    let inFlight = false
    const startedAt = Date.now()
    const durationMs = 21_600_000
    const intervalMs = 10_000
    const interval = registerInterval(
      setInterval(() => {
        try {
          const now = Date.now()
          if (now - startedAt > durationMs) {
            clearInterval(interval)
            return
          }

          const running = keepSyncingWhileGameRuns()
          if (running) {
            wasRunning = true
            if (inFlight) return
            inFlight = true
            // Only sync safe files from game -> client while running.
            void mirrorFolderPreferNewestOneWayAsync(gamePluginsDir, clientPluginsDir, {
              filterRel: (rel) => isSafeRuntimePluginFile(rel),
              maxFiles: 350,
              yieldEvery: 150,
              timeBudgetMs: 40
            }).finally(() => {
              inFlight = false
            })
            return
          }

          // Game is not running.
          // If it was running and just exited, do one last SAFE sync from game->client, then stop.
          // If it wasn't running at all, stop immediately (don't keep syncing in the background).
          clearInterval(interval)

          if (wasRunning) {
            statusCallback?.('Finalizing plugins sync...')
            let lastFinalizeProgressAt = 0
            const finalizePromise = mirrorFolderPreferNewestOneWayAsync(gamePluginsDir, clientPluginsDir, {
              filterRel: (rel) => isSafeRuntimePluginFile(rel),
              maxFiles: 5000,
              yieldEvery: 250,
              onProgress: ({ processed, copied }) => {
                const now = Date.now()
                if (now - lastFinalizeProgressAt < 750) return
                lastFinalizeProgressAt = now
                statusCallback?.(`Finalizing plugins sync... ${processed} scanned, ${copied} updated`)
              }
            }).then(
              () => {
                statusCallback?.('Plugins sync complete.')
              },
              (err) => {
                try {
                  reshadeLog(reshadeClientDir, `Plugins final sync ERROR: ${(err as Error).message}`, statusCallback)
                } catch {
                  // ignore
                }
              }
            )

            // Mark busy while the final sync is running, but clear automatically when done.
            let tracked: Promise<void>
            tracked = finalizePromise.finally(() => {
              if (state.pendingFinalization === tracked) {
                state.pendingFinalization = null
              }
            })
            state.pendingFinalization = tracked
          }
        } catch (err) {
          try {
            reshadeLog(reshadeClientDir, `Plugins sync loop ERROR: ${(err as Error).message}`)
          } catch {
            // ignore
          }
        }
      }, intervalMs)
    )
    void interval
  } catch {
    // ignore
  }

  // Log which physical path is being used.
  try {
    const gamePluginsReal = realpathBestEffort(gamePluginsDir)
    const clientPluginsReal = realpathBestEffort(clientPluginsDir)

    const owner = readPluginsOwnerMarker(gamePluginsDir)
    reshadeLog(reshadeClientDir, `Plugins owner marker (game plugins): ${JSON.stringify(owner)}`, statusCallback)
    reshadeLog(
      reshadeClientDir,
      `Plugins mode=sync: game=${gamePluginsDir} -> real=${gamePluginsReal}; client=${clientPluginsDir} -> real=${clientPluginsReal}`,
      statusCallback
    )
    statusCallback?.('Note: Plugins are in copy/sync mode. ReShade should use the FiveM.app\\plugins path.')
  } catch (err) {
    try {
      reshadeLog(reshadeClientDir, `ERROR reading plugins realpath: ${(err as Error).message}`, statusCallback)
    } catch {
      // ignore
    }
  }
}

async function runPluginsJunctionMode(params: {
  clientId: string
  clientPath: string
  clientPluginsDir: string
  gamePluginsDir: string
  statusCallback?: (status: string) => void
  linkFolder: (source: string, target: string, options?: { migrateExisting?: boolean }) => void
  reshadeLog: (reshadeClientDir: string, message: string, statusCallback?: (status: string) => void) => void
}): Promise<void> {
  const { clientId, clientPath, clientPluginsDir, gamePluginsDir, statusCallback, linkFolder, reshadeLog } = params

  statusCallback?.('Linking plugins...')

  linkFolder(clientPluginsDir, gamePluginsDir, { migrateExisting: false })

  // Record ownership on the client plugins folder for debugging.
  writePluginsOwnerMarker(clientPluginsDir, { clientId, mode: 'junction' })

  // Log where the junction points. This is critical for debugging "it was in plugins" cases.
  try {
    const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')
    fs.mkdirSync(reshadeClientDir, { recursive: true })

    const gamePluginsReal = realpathBestEffort(gamePluginsDir)
    const clientPluginsReal = realpathBestEffort(clientPluginsDir)

    reshadeLog(
      reshadeClientDir,
      `Plugins link: game=${gamePluginsDir} -> real=${gamePluginsReal}; client=${clientPluginsDir} -> real=${clientPluginsReal}`,
      statusCallback
    )

    statusCallback?.('Note: Plugins are linked (junction). ReShade may open the client plugins folder.')
  } catch (err) {
    try {
      const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')
      reshadeLog(reshadeClientDir, `ERROR reading plugins realpath: ${(err as Error).message}`, statusCallback)
    } catch {
      // ignore
    }
  }
}

export async function setupPluginsForLaunch(params: {
  state: PluginsLaunchState
  clientId: string
  clientPath: string
  fiveMPath: string
  pluginsMode: 'sync' | 'junction'
  statusCallback?: (status: string) => void
  isProcessRunning: (processName: string) => boolean
  registerInterval: (interval: NodeJS.Timeout) => NodeJS.Timeout
  renameWithRetrySync: (from: string, to: string) => void
  linkFolder: (source: string, target: string, options?: { migrateExisting?: boolean }) => void
  reshadeLog: (reshadeClientDir: string, message: string, statusCallback?: (status: string) => void) => void
}): Promise<void> {
  const {
    state,
    clientId,
    clientPath,
    fiveMPath,
    pluginsMode,
    statusCallback,
    isProcessRunning,
    registerInterval,
    renameWithRetrySync,
    linkFolder,
    reshadeLog
  } = params

  const clientPluginsDir = path.join(clientPath, 'plugins')
  const gamePluginsDir = path.join(fiveMPath, 'plugins')

  try {
    console.log(`[Launch] clientId=${clientId} pluginsMode=${pluginsMode} clientPluginsDir=${clientPluginsDir} gamePluginsDir=${gamePluginsDir}`)
  } catch {
    // ignore
  }

  if (pluginsMode === 'sync') {
    await runPluginsSyncMode({
      state,
      clientId,
      clientPath,
      clientPluginsDir,
      gamePluginsDir,
      statusCallback,
      isProcessRunning,
      registerInterval,
      renameWithRetrySync,
      reshadeLog
    })
    return
  }

  await runPluginsJunctionMode({
    clientId,
    clientPath,
    clientPluginsDir,
    gamePluginsDir,
    statusCallback,
    linkFolder,
    reshadeLog
  })
}

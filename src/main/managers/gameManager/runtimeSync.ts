import fs from 'fs'
import path from 'path'
import {
  copyFileBestEffort,
  ensureFileExists,
  syncFilePreferNewest
} from './pluginsMirror'

/**
 * Manages runtime file syncing for a launched client.
 *
 * This class owns watchers + intervals so they can be stopped cleanly between launches.
 */
export class RuntimeSync {
  private activeWatchers: fs.FSWatcher[] = []
  private lastWriteMs: Record<string, number> = {}
  private activeIntervals: NodeJS.Timeout[] = []

  /**
   * Track an interval so it will be cleared by `stopAll()`.
   */
  public registerInterval(interval: NodeJS.Timeout): NodeJS.Timeout {
    this.activeIntervals.push(interval)
    interval.unref?.()
    return interval
  }

  /**
   * Stop all active watchers and timers.
   */
  public stopAll(): void {
    for (const watcher of this.activeWatchers) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
    }
    this.activeWatchers = []

    for (const interval of this.activeIntervals) {
      try {
        clearInterval(interval)
      } catch {
        // ignore
      }
    }
    this.activeIntervals = []

    this.lastWriteMs = {}
  }

  public seedAndStartTwoWaySync(
    clientFile: string,
    gameFile: string,
    shouldContinue?: () => boolean
  ): void {
    // IMPORTANT: Seed from client -> game when available. This avoids a race where a
    // stale game config overwrites the client config at launch.
    const clientExists = fs.existsSync(clientFile)
    const gameExists = fs.existsSync(gameFile)

    ensureFileExists(clientFile, '')
    ensureFileExists(gameFile, '')

    if (clientExists) {
      copyFileBestEffort(clientFile, gameFile)
    } else if (gameExists) {
      copyFileBestEffort(gameFile, clientFile)
    }

    // Then keep them in sync while the game runs and do a last pass after exit.
    this.startTwoWayFileSync(clientFile, gameFile)
    this.startPreferNewestSyncLoop(clientFile, gameFile, 21_600_000, 5_000, shouldContinue)
  }

  public startPreferNewestSyncLoop(
    a: string,
    b: string,
    durationMs = 21_600_000,
    intervalMs = 5_000,
    shouldContinue?: () => boolean
  ): void {
    const startedAt = Date.now()
    let everRunning = false
    const interval = setInterval(() => {
      const now = Date.now()
      if (now - startedAt > durationMs) {
        clearInterval(interval)
        return
      }

      if (shouldContinue) {
        const running = shouldContinue()
        if (running) {
          everRunning = true
        } else if (everRunning) {
          // One last sync after the game closes (common for atomic-save-on-exit patterns).
          syncFilePreferNewest(a, b, 'b')
          clearInterval(interval)
          return
        }
      }

      syncFilePreferNewest(a, b, 'b')
    }, intervalMs)

    interval.unref?.()
    this.activeIntervals.push(interval)
  }

  public startTwoWayFileSync(a: string, b: string): void {
    // Watch the *directories* to survive atomic-save patterns (write temp + rename).
    const debounceMs = 350
    const aName = path.basename(a).toLowerCase()
    const bName = path.basename(b).toLowerCase()
    const aDir = path.dirname(a)
    const bDir = path.dirname(b)

    const safeCopy = (source: string, target: string) => {
      const now = Date.now()
      if ((this.lastWriteMs[target] ?? 0) + debounceMs > now) return
      this.lastWriteMs[target] = now
      copyFileBestEffort(source, target)
    }

    // Seed whichever side exists.
    const aExists = fs.existsSync(a)
    const bExists = fs.existsSync(b)
    if (aExists && !bExists) {
      ensureFileExists(b)
      safeCopy(a, b)
    } else if (bExists && !aExists) {
      ensureFileExists(a)
      safeCopy(b, a)
    }

    const watchDir = (dir: string, fileNameLower: string, source: string, target: string) => {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        // ignore
      }

      try {
        const watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
          const now = Date.now()

          // If OS didn't give a filename, still attempt to sync (best effort).
          if (!filename) {
            if ((this.lastWriteMs[source] ?? 0) + debounceMs > now) return
            safeCopy(source, target)
            return
          }

          if (String(filename).toLowerCase() !== fileNameLower) return
          if ((this.lastWriteMs[source] ?? 0) + debounceMs > now) return
          safeCopy(source, target)
        })

        watcher.unref?.()
        this.activeWatchers.push(watcher)
      } catch {
        // ignore
      }
    }

    watchDir(aDir, aName, a, b)
    watchDir(bDir, bName, b, a)
  }
}

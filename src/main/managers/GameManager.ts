import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'
import {
  getClientsDataPath,
  getFiveMExecutable,
  getFiveMPath,
  getFiveMAppSettingsPath,
  getGtaSettingsPath,
  getCitizenFxIniPath
} from '../utils/paths'
import type { LinkOptions } from '../types'

export class GameManager {

  private activeWatchers: fs.FSWatcher[] = []
  private lastWriteMs: Record<string, number> = {}
  private activeIntervals: NodeJS.Timeout[] = []

  private pendingPluginsFinalization: Promise<void> | null = null

  private pluginsMirrorCache: Map<string, Map<string, number>> = new Map()

  public getBusyState(): { pluginsSyncBusy: boolean } {
    return {
      pluginsSyncBusy: Boolean(this.pendingPluginsFinalization)
    }
  }

  private registerInterval(interval: NodeJS.Timeout): NodeJS.Timeout {
    this.activeIntervals.push(interval)
    interval.unref?.()
    return interval
  }

  private sleepSync(ms: number): void {
    try {
      // Synchronous small backoff for retry loops (Windows file locks).
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    } catch {
      // ignore
    }
  }

  private renameWithRetrySync(from: string, to: string, retries = 20, delayMs = 75): void {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        fs.renameSync(from, to)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
        if (!retryable || attempt === retries) {
          throw err
        }
        this.sleepSync(delayMs)
      }
    }
  }

  private async migrateExistingPluginsForJunctionAsync(
    gamePluginsDir: string,
    clientPluginsDir: string,
    clientId: string,
    statusCallback?: (status: string) => void
  ): Promise<void> {
    // Junction mode: migrate existing plugin files into the per-client folder BEFORE we take over
    // with a junction link. We explicitly skip the heavy ReShade asset folders to keep this fast.
    // Requested behavior: exclude `Shaders` and `Textures`, copy everything else.
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(gamePluginsDir)
    } catch {
      return
    }

    // If it's already a junction/symlink, there's nothing to migrate.
    if (stats.isSymbolicLink()) return
    if (!stats.isDirectory()) return

    const markerFile = path.join(gamePluginsDir, '.managed-by-fivem-clients')
    // If we previously managed it (copy/sync mode), avoid pulling from it here.
    if (fs.existsSync(markerFile)) return

    // If the plugins folder was previously used by another client in Copy/Sync mode,
    // do NOT migrate it into this client (prevents cross-client leakage).
    const owner = this.readPluginsOwnerMarker(gamePluginsDir)
    if (owner && owner.clientId && owner.clientId !== clientId) {
      statusCallback?.('Skipping plugins migration (belongs to another client).')
      return
    }

    try {
      fs.mkdirSync(clientPluginsDir, { recursive: true })
    } catch {
      // ignore
    }

    const isTopLevelShadersOrTexturesDir = (relDir: string) => {
      // Only skip top-level plugins/Shaders and plugins/Textures.
      // Do NOT skip nested folders like reshade-shaders/Shaders or reshade-shaders/Textures.
      const normalized = relDir.replace(/\\/g, '/')
      if (normalized.includes('/')) return false
      const name = path.basename(relDir).toLowerCase()
      return name === 'shaders' || name === 'textures'
    }

    statusCallback?.('Migrating existing plugins (excluding Shaders/Textures)...')
    let lastProgressAt = 0

    await this.mirrorFolderPreferNewestOneWayAsync(gamePluginsDir, clientPluginsDir, {
      skipDirRel: isTopLevelShadersOrTexturesDir,
      yieldEvery: 250,
      // Guardrails: prevent pathological cases from blocking launch forever.
      maxFiles: 150_000,
      timeBudgetMs: 8_000,
      onProgress: ({ processed, copied, skipped }) => {
        const now = Date.now()
        if (now - lastProgressAt < 650) return
        lastProgressAt = now
        statusCallback?.(`Migrating existing plugins... ${processed} scanned, ${copied} updated (${skipped} skipped)`)
      }
    })
  }

  private async waitForPendingPluginsFinalization(statusCallback?: (status: string) => void): Promise<void> {
    if (!this.pendingPluginsFinalization) return
    statusCallback?.('Waiting for plugins sync to finish...')
    try {
      await this.pendingPluginsFinalization
    } finally {
      // Always clear if it resolved/rejected.
      this.pendingPluginsFinalization = null
    }
  }

  private getPluginsMirrorCacheKey(clientId: string, direction: 'client->game' | 'game->client'): string {
    return `${clientId}:${direction}`
  }

  private getPluginsMirrorCacheFile(clientPath: string, direction: 'client->game' | 'game->client'): string {
    return path.join(clientPath, 'settings', direction === 'client->game' ? 'plugins-cache-client-to-game.json' : 'plugins-cache-game-to-client.json')
  }

  private loadPluginsMirrorCache(clientId: string, cachePath: string): Map<string, number> {
    const existing = this.pluginsMirrorCache.get(clientId)
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

    this.pluginsMirrorCache.set(clientId, map)
    return map
  }

  private savePluginsMirrorCache(cachePath: string, cache: Map<string, number>): void {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      const obj: Record<string, number> = {}
      for (const [rel, mtime] of cache.entries()) obj[rel] = mtime
      fs.writeFileSync(cachePath, JSON.stringify(obj), 'utf8')
    } catch {
      // ignore
    }
  }

  private pluginsOwnerMarkerPath(dir: string): string {
    return path.join(dir, '.fivelaunch-plugins-owner.json')
  }

  private getManagedMarkerFile(dir: string): string {
    return path.join(dir, '.managed-by-fivem-clients')
  }

  private prepareGamePluginsDirForSyncMode(
    gamePluginsDir: string,
    clientId: string,
    statusCallback?: (status: string) => void
  ): void {
    const markerFile = this.getManagedMarkerFile(gamePluginsDir)

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
          const owner = this.readPluginsOwnerMarker(gamePluginsDir)
          const ownerId = owner?.clientId

          // If this folder isn't ours, or it was owned by another client, rotate it away.
          // This prevents cross-client plugin leakage in sync mode.
          if (!managed || !ownerId || ownerId !== clientId) {
            const ownerTag = ownerId ? this.fnv1a32Hex(ownerId) : 'unknown'
            const kind = managed ? `managed_${ownerTag}` : 'unmanaged'
            const backupPath = `${gamePluginsDir}_${kind}_backup_${Date.now()}`

            statusCallback?.('Isolating FiveM plugins folder for this client...')
            try {
              this.renameWithRetrySync(gamePluginsDir, backupPath)
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
    this.writePluginsOwnerMarker(gamePluginsDir, { clientId, mode: 'sync' })
  }

  private writePluginsOwnerMarker(dir: string, payload: { clientId: string; mode: 'sync' | 'junction' }): void {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        this.pluginsOwnerMarkerPath(dir),
        JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2),
        'utf8'
      )
    } catch {
      // ignore
    }
  }

  private readPluginsOwnerMarker(dir: string): { clientId?: string; mode?: string; at?: string } | null {
    try {
      const p = this.pluginsOwnerMarkerPath(dir)
      if (!fs.existsSync(p)) return null
      const raw = fs.readFileSync(p, 'utf8')
      return JSON.parse(raw) as { clientId?: string; mode?: string; at?: string }
    } catch {
      return null
    }
  }

  private fnv1a32Hex(input: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = (hash * 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }

  private appendTextLog(logFilePath: string, line: string): void {
    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
      fs.appendFileSync(logFilePath, line.endsWith('\n') ? line : `${line}\n`, 'utf8')
    } catch {
      // ignore
    }
  }

  private reshadeLog(
    reshadeClientDir: string,
    message: string,
    statusCallback?: (status: string) => void
  ): void {
    const line = `[ReShade] ${new Date().toISOString()} ${message}`
    console.log(line)
    this.appendTextLog(path.join(reshadeClientDir, 'diagnostics.log'), line)
    // Keep UI status minimal to avoid overwriting other launch messages.
    if (statusCallback && message.startsWith('ERROR')) {
      statusCallback('ReShade: error (see diagnostics.log)')
    }
  }

  private extractWindowsFilePaths(text: string): string[] {
    // Best-effort path extraction from logs.
    // Example: C:\Games\GTAV\ReShade.ini
    const matches = text.match(/[A-Za-z]:\\[^\r\n"']+?\.(?:ini|log)/g) ?? []
    const cleaned = matches
      .map((m) => m.trim())
      .map((m) => m.replace(/[\]\)\}\>,;]+$/g, ''))
    return Array.from(new Set(cleaned))
  }

  private readFileTailUtf8(filePath: string, maxBytes = 64 * 1024): string {
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size <= 0) return ''

      const start = Math.max(0, stat.size - maxBytes)
      const fd = fs.openSync(filePath, 'r')
      try {
        const buf = Buffer.alloc(stat.size - start)
        fs.readSync(fd, buf, 0, buf.length, start)
        return buf.toString('utf8')
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return ''
    }
  }

  private pickIniSummary(iniPath: string): Record<string, string> {
    try {
      if (!fs.existsSync(iniPath)) return {}
      const text = fs.readFileSync(iniPath, 'utf8')
      const kv = this.parseIniKeyValues(text)
      const wanted = [
        'currentpresetpath',
        'presetpath',
        'presetfiles',
        'effectsearchpaths',
        'texturesearchpaths',
        'performancemode'
      ]

      const out: Record<string, string> = {}
      for (const key of wanted) {
        if (kv[key] !== undefined) out[key] = kv[key]
      }
      return out
    } catch {
      return {}
    }
  }

  private parseIniKeyValues(iniText: string): Record<string, string> {
    const out: Record<string, string> = {}
    const lines = iniText.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim().toLowerCase()
      let value = trimmed.slice(eq + 1).trim()
      value = value.replace(/^"|"$/g, '')
      if (!key) continue
      out[key] = value
    }
    return out
  }

  private canOpenReadWrite(filePath: string): { ok: boolean; error?: string } {
    try {
      const fd = fs.openSync(filePath, 'r+')
      fs.closeSync(fd)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private extractPresetRelatedLines(iniPath: string, maxLines = 60): string[] {
    try {
      if (!fs.existsSync(iniPath)) return []
      const text = fs.readFileSync(iniPath, 'utf8')
      const lines = text.split(/\r?\n/)
      return lines
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith(';') && !l.startsWith('#'))
        .filter((l) => l.toLowerCase().includes('preset'))
        .slice(0, maxLines)
    } catch {
      return []
    }
  }

  private hashFileQuick(filePath: string, maxBytes = 256 * 1024): string {
    try {
      const st = fs.statSync(filePath)
      if (!st.isFile() || st.size <= 0) return ''
      const bytesToRead = Math.min(st.size, maxBytes)
      const fd = fs.openSync(filePath, 'r')
      try {
        const buf = Buffer.alloc(bytesToRead)
        fs.readSync(fd, buf, 0, bytesToRead, 0)
        // FNV-1a 32-bit
        let hash = 0x811c9dc5
        for (let i = 0; i < buf.length; i++) {
          hash ^= buf[i]
          hash = (hash * 0x01000193) >>> 0
        }
        return hash.toString(16).padStart(8, '0')
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return ''
    }
  }

  private extractPresetFileKeyLines(presetPath: string, maxLines = 40): string[] {
    try {
      if (!fs.existsSync(presetPath)) return []
      const text = fs.readFileSync(presetPath, 'utf8')
      const lines = text.split(/\r?\n/)
      const interesting = lines
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith(';') && !l.startsWith('#'))
        .filter((l) => {
          const lower = l.toLowerCase()
          return (
            lower.startsWith('techniques=') ||
            lower.startsWith('techniquesorting=') ||
            lower.startsWith('preprocessordefinitions=')
          )
        })
        .slice(0, maxLines)

      // If nothing obvious, at least show the first few non-comment lines (helps spot which file is loaded)
      if (interesting.length > 0) return interesting
      return lines
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith(';') && !l.startsWith('#'))
        .slice(0, Math.min(12, maxLines))
    } catch {
      return []
    }
  }

  private looksLikeReShadePresetFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size < 32) return false
      const text = fs.readFileSync(filePath, 'utf8').slice(0, 128 * 1024).toLowerCase()
      // Matches ReShade's own validity heuristic (see resolve_preset_path in upstream): preset usually has 'Techniques'.
      return text.includes('techniques=')
    } catch {
      return false
    }
  }

  private startReShadeFileMonitor(
    reshadeClientDir: string,
    filePath: string,
    label: string,
    shouldContinue: () => boolean
  ): void {
    try {
      let lastSig = ''
      let everRunning = false

      const interval = setInterval(() => {
        const running = shouldContinue()
        if (running) everRunning = true
        if (!running && everRunning) {
          clearInterval(interval)
          this.reshadeLog(reshadeClientDir, `Monitor stop: ${label}`)
          return
        }
        if (!running) return

        let statSig = ''
        try {
          const st = fs.statSync(filePath)
          statSig = `${st.size}:${st.mtimeMs}`
        } catch {
          statSig = 'missing'
        }

        if (statSig === lastSig) return
        lastSig = statSig

        const rw = this.canOpenReadWrite(filePath)
        const quickHash = this.hashFileQuick(filePath)

        if (label.startsWith('preset:')) {
          const keyLines = this.extractPresetFileKeyLines(filePath, 20)
          this.reshadeLog(
            reshadeClientDir,
            `${label} changed (${statSig}) hash=${quickHash} rw=${rw.ok ? 'ok' : `FAIL:${rw.error ?? ''}`} path=${filePath} keyLines=${JSON.stringify(keyLines)}`
          )
          return
        }

        const summary = this.pickIniSummary(filePath)
        const presetLines = this.extractPresetRelatedLines(filePath, 25)
        this.reshadeLog(
          reshadeClientDir,
          `${label} changed (${statSig}) hash=${quickHash} rw=${rw.ok ? 'ok' : `FAIL:${rw.error ?? ''}`} summary=${JSON.stringify(summary)} presetLines=${JSON.stringify(presetLines)}`
        )
      }, 2_000)

      interval.unref?.()
    } catch {
      // ignore
    }
  }

  private getGtaInstallDirCandidates(): string[] {
    const results: string[] = []

    // 1) Try CitizenFX.ini (often contains a game path for GTA V)
    const cfxIni = getCitizenFxIniPath()
    if (cfxIni && fs.existsSync(cfxIni)) {
      try {
        const text = fs.readFileSync(cfxIni, 'utf8')
        const kv = this.parseIniKeyValues(text)
        const candidateValues = Object.values(kv)
        for (const value of candidateValues) {
          if (!value) continue
          const normalized = value.replace(/\//g, path.sep)

          // Some configs store the exe path, some store the directory.
          const maybeExe = normalized.toLowerCase().endsWith('gta5.exe')
            ? normalized
            : path.join(normalized, 'GTA5.exe')

          if (fs.existsSync(maybeExe)) {
            results.push(path.dirname(maybeExe))
          }
        }
      } catch {
        // ignore
      }
    }

    // 2) Common install locations (Steam/Rockstar/Epic)
    const pf = process.env.ProgramFiles
    const pfx86 = process.env['ProgramFiles(x86)']

    const commonRoots = [
      pf ? path.join(pf, 'Rockstar Games', 'Grand Theft Auto V') : '',
      pf ? path.join(pf, 'Epic Games', 'GTAV') : '',
      pfx86 ? path.join(pfx86, 'Steam', 'steamapps', 'common', 'Grand Theft Auto V') : '',
      'C:\\Games\\Grand Theft Auto V',
      'C:\\Games\\GTAV',
      'D:\\Games\\Grand Theft Auto V',
      'D:\\Games\\GTAV'
    ].filter(Boolean)

    for (const dir of commonRoots) {
      try {
        if (fs.existsSync(path.join(dir, 'GTA5.exe'))) results.push(dir)
      } catch {
        // ignore
      }
    }

    return Array.from(new Set(results))
  }

  private stopActiveWatchers(): void {
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

  private *listFilesRecursive(
    baseDir: string,
    options?: {
      filterRel?: (relPath: string) => boolean
      skipDirRel?: (relDir: string) => boolean
      maxFiles?: number
    }
  ): IterableIterator<string> {
    const stack: string[] = ['']
    let yielded = 0

    while (stack.length > 0) {
      const relDir = stack.pop() ?? ''

      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(path.join(baseDir, relDir), { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        const childRel = relDir ? path.join(relDir, entry.name) : entry.name
        const abs = path.join(baseDir, childRel)

        let stat: fs.Stats
        try {
          stat = fs.lstatSync(abs)
        } catch {
          continue
        }

        // Avoid traversing into symlinks/junctions to prevent loops.
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) {
          if (options?.skipDirRel && options.skipDirRel(childRel)) {
            continue
          }
          stack.push(childRel)
          continue
        }
        if (!stat.isFile()) continue

        if (options?.filterRel && !options.filterRel(childRel)) continue
        yield childRel
        yielded += 1
        if (options?.maxFiles && yielded >= options.maxFiles) return
      }
    }
  }

  private async *listFilesRecursiveAsync(
    baseDir: string,
    options?: {
      filterRel?: (relPath: string) => boolean
      skipDirRel?: (relDir: string) => boolean
      maxFiles?: number
    }
  ): AsyncGenerator<string> {
    const stack: string[] = ['']
    let yielded = 0

    while (stack.length > 0) {
      const relDir = stack.pop() ?? ''

      let entries: fs.Dirent[] = []
      try {
        entries = await fs.promises.readdir(path.join(baseDir, relDir), { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        const childRel = relDir ? path.join(relDir, entry.name) : entry.name
        const abs = path.join(baseDir, childRel)

        let stat: fs.Stats
        try {
          stat = await fs.promises.lstat(abs)
        } catch {
          continue
        }

        // Avoid traversing into symlinks/junctions to prevent loops.
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) {
          if (options?.skipDirRel && options.skipDirRel(childRel)) {
            continue
          }
          stack.push(childRel)
          continue
        }
        if (!stat.isFile()) continue

        if (options?.filterRel && !options.filterRel(childRel)) continue
        yield childRel
        yielded += 1
        if (options?.maxFiles && yielded >= options.maxFiles) return
      }
    }
  }

  private mirrorFolderOneWay(
    sourceDir: string,
    targetDir: string,
    options?: { filterRel?: (relPath: string) => boolean; maxFiles?: number }
  ): void {
    try {
      fs.mkdirSync(sourceDir, { recursive: true })
      fs.mkdirSync(targetDir, { recursive: true })
    } catch {
      // ignore
    }

    for (const rel of this.listFilesRecursive(sourceDir, { filterRel: options?.filterRel, maxFiles: options?.maxFiles })) {
      const from = path.join(sourceDir, rel)
      const to = path.join(targetDir, rel)
      this.copyFileBestEffort(from, to)
    }
  }

  private async mirrorFolderPreferNewestOneWayAsync(
    sourceDir: string,
    targetDir: string,
    options?: {
      filterRel?: (relPath: string) => boolean
      skipDirRel?: (relDir: string) => boolean
      yieldEvery?: number
      maxFiles?: number
      timeBudgetMs?: number
      cacheGetMtime?: (relPath: string) => number | undefined
      cacheSetMtime?: (relPath: string, mtimeMs: number) => void
      onProgress?: (p: { processed: number; copied: number; skipped: number }) => void
    }
  ): Promise<void> {
    try {
      fs.mkdirSync(sourceDir, { recursive: true })
      fs.mkdirSync(targetDir, { recursive: true })
    } catch {
      // ignore
    }

    const yieldEvery = options?.yieldEvery ?? 250
    let processed = 0
    let copied = 0
    let skipped = 0

    const startedAt = Date.now()

    for await (const rel of this.listFilesRecursiveAsync(sourceDir, {
      filterRel: options?.filterRel,
      skipDirRel: options?.skipDirRel,
      maxFiles: options?.maxFiles
    })) {
      if (options?.timeBudgetMs && Date.now() - startedAt > options.timeBudgetMs) {
        options?.onProgress?.({ processed, copied, skipped })
        break
      }
      const from = path.join(sourceDir, rel)
      const to = path.join(targetDir, rel)

      try {
        fs.mkdirSync(path.dirname(to), { recursive: true })
      } catch {
        // ignore
      }

      const toExists = fs.existsSync(to)
      const fromTime = this.getMtimeMsSafe(from)
      const skewMs = 900

      if (!toExists) {
        const ok = await this.copyFileBestEffortAsync(from, to)
        if (ok) options?.cacheSetMtime?.(rel, fromTime)
        copied += 1
      } else {
        const cached = options?.cacheGetMtime?.(rel)
        if (typeof cached === 'number' && Math.abs(cached - fromTime) <= skewMs) {
          // Source hasn't changed since last time we mirrored it; assume target is already correct.
          skipped += 1
        } else {
          const toTime = this.getMtimeMsSafe(to)
          if (fromTime > toTime + skewMs) {
            const ok = await this.copyFileBestEffortAsync(from, to)
            if (ok) options?.cacheSetMtime?.(rel, fromTime)
            copied += 1
          } else {
            // Target is already newer/equal; still update cache so next run can skip the target stat.
            options?.cacheSetMtime?.(rel, fromTime)
            skipped += 1
          }
        }
      }

      processed += 1
      if (processed % yieldEvery === 0) {
        options?.onProgress?.({ processed, copied, skipped })
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    options?.onProgress?.({ processed, copied, skipped })
  }

  private async mirrorFolderSourceWinsOneWayAsync(
    sourceDir: string,
    targetDir: string,
    options?: {
      filterRel?: (relPath: string) => boolean
      skipDirRel?: (relDir: string) => boolean
      yieldEvery?: number
      maxFiles?: number
      timeBudgetMs?: number
      cacheGetMtime?: (relPath: string) => number | undefined
      cacheSetMtime?: (relPath: string, mtimeMs: number) => void
      onProgress?: (p: { processed: number; copied: number; skipped: number }) => void
    }
  ): Promise<void> {
    try {
      fs.mkdirSync(sourceDir, { recursive: true })
      fs.mkdirSync(targetDir, { recursive: true })
    } catch {
      // ignore
    }

    const yieldEvery = options?.yieldEvery ?? 250
    let processed = 0
    let copied = 0
    let skipped = 0

    const startedAt = Date.now()
    const skewMs = 900

    for await (const rel of this.listFilesRecursiveAsync(sourceDir, {
      filterRel: options?.filterRel,
      skipDirRel: options?.skipDirRel,
      maxFiles: options?.maxFiles
    })) {
      if (options?.timeBudgetMs && Date.now() - startedAt > options.timeBudgetMs) {
        options?.onProgress?.({ processed, copied, skipped })
        break
      }

      const from = path.join(sourceDir, rel)
      const to = path.join(targetDir, rel)

      try {
        fs.mkdirSync(path.dirname(to), { recursive: true })
      } catch {
        // ignore
      }

      const fromTime = this.getMtimeMsSafe(from)
      const cached = options?.cacheGetMtime?.(rel)
      const toExists = fs.existsSync(to)

      // Source-authoritative mirror:
      // - If source file didn't change since last time (cache hit), skip.
      // - Otherwise, copy from source to target (even if target is newer).
      if (toExists && typeof cached === 'number' && Math.abs(cached - fromTime) <= skewMs) {
        skipped += 1
      } else {
        const ok = await this.copyFileBestEffortAsync(from, to)
        if (ok) {
          options?.cacheSetMtime?.(rel, fromTime)
          copied += 1
        } else {
          // If copy failed (locked), don't poison the cache.
          skipped += 1
        }
      }

      processed += 1
      if (processed % yieldEvery === 0) {
        options?.onProgress?.({ processed, copied, skipped })
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    options?.onProgress?.({ processed, copied, skipped })
  }

  private async copyFileBestEffortAsync(source: string, target: string): Promise<boolean> {
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.copyFile(source, target)
      return true
    } catch {
      // ignore - target can be locked while GTA/FiveM writes it
      return false
    }
  }

  private isSafeRuntimePluginFile(relPath: string): boolean {
    const lower = relPath.toLowerCase()
    // Keep runtime sync conservative: avoid touching DLLs/binaries while FiveM is loading/running.
    // ReShade settings/presets are typically .ini; logs are useful for diagnostics.
    return (
      lower.endsWith('.ini') ||
      lower.endsWith('.log') ||
      lower.endsWith('.cfg') ||
      lower.endsWith('.txt')
    )
  }

  private copyFileBestEffort(source: string, target: string): void {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)

      try {
        const fd = fs.openSync(target, 'r+')
        fs.fsyncSync(fd)
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    } catch {
      // ignore - target can be locked while GTA/FiveM writes it
    }
  }

  private ensureFileExists(filePath: string, fallbackContents = ''): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, fallbackContents, 'utf8')
      }
    } catch {
      // ignore
    }
  }

  private getMtimeMsSafe(filePath: string): number {
    try {
      return fs.statSync(filePath).mtimeMs
    } catch {
      return 0
    }
  }

  private syncFilePreferNewest(a: string, b: string, tiePreference: 'a' | 'b' = 'b'): void {
    const aExists = fs.existsSync(a)
    const bExists = fs.existsSync(b)

    if (!aExists && !bExists) return
    if (aExists && !bExists) {
      this.ensureFileExists(b)
      this.copyFileBestEffort(a, b)
      return
    }
    if (bExists && !aExists) {
      this.ensureFileExists(a)
      this.copyFileBestEffort(b, a)
      return
    }

    const aTime = this.getMtimeMsSafe(a)
    const bTime = this.getMtimeMsSafe(b)
    const skewMs = 900

    if (aTime > bTime + skewMs) {
      this.copyFileBestEffort(a, b)
      return
    }
    if (bTime > aTime + skewMs) {
      this.copyFileBestEffort(b, a)
      return
    }

    // If timestamps are too close (common on some FS), fall back to content comparison.
    try {
      const aBuf = fs.readFileSync(a)
      const bBuf = fs.readFileSync(b)
      if (!aBuf.equals(bBuf)) {
        if (tiePreference === 'a') {
          this.copyFileBestEffort(a, b)
        } else {
          this.copyFileBestEffort(b, a)
        }
      }
    } catch {
      // ignore
    }
  }

  private seedAndStartTwoWaySync(
    clientFile: string,
    gameFile: string,
    shouldContinue?: () => boolean
  ): void {
    // IMPORTANT: Seed from client -> game when available. This avoids a race where a
    // stale game config overwrites the client config at launch.
    const clientExists = fs.existsSync(clientFile)
    const gameExists = fs.existsSync(gameFile)

    this.ensureFileExists(clientFile, '')
    this.ensureFileExists(gameFile, '')

    if (clientExists) {
      this.copyFileBestEffort(clientFile, gameFile)
    } else if (gameExists) {
      this.copyFileBestEffort(gameFile, clientFile)
    }

    // Then keep them in sync while the game runs and do a last pass after exit.
    this.startTwoWayFileSync(clientFile, gameFile)
    this.startPreferNewestSyncLoop(clientFile, gameFile, 21_600_000, 5_000, shouldContinue)
  }

  private startPreferNewestSyncLoop(
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
          this.syncFilePreferNewest(a, b, 'b')
          clearInterval(interval)
          return
        }
      }

      this.syncFilePreferNewest(a, b, 'b')
    }, intervalMs)

    interval.unref?.()
  }

  private startTwoWayFileSync(a: string, b: string): void {
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
      this.copyFileBestEffort(source, target)
    }

    // Seed whichever side exists.
    const aExists = fs.existsSync(a)
    const bExists = fs.existsSync(b)
    if (aExists && !bExists) {
      this.ensureFileExists(b)
      safeCopy(a, b)
    } else if (bExists && !aExists) {
      this.ensureFileExists(a)
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

  private parseReShadeIniPresetPaths(iniText: string): string[] {
    const results: string[] = []
    const lines = iniText.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue

      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue

      const key = trimmed.slice(0, eq).trim().toLowerCase()
      let value = trimmed.slice(eq + 1).trim()
      value = value.replace(/^"|"$/g, '')

      if (!value) continue
      if (key === 'presetpath' || key === 'currentpresetpath') {
        results.push(value)
      }
    }

    return Array.from(new Set(results))
  }

  private resolveMaybeRelativePath(baseDir: string, iniDir: string, value: string): string {
    const normalized = value.replace(/\//g, path.sep)
    if (path.isAbsolute(normalized)) return normalized

    // ReShade commonly uses relative paths; try ini directory first, then exe base dir.
    const fromIni = path.resolve(iniDir, normalized)
    if (fs.existsSync(fromIni)) return fromIni
    return path.resolve(baseDir, normalized)
  }

  private findFilesByName(rootDir: string, fileNameLower: string, maxDepth: number): string[] {
    const results: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return

      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, depth + 1)
          continue
        }
        if (entry.isFile() && entry.name.toLowerCase() === fileNameLower) {
          results.push(full)
        }
      }
    }

    walk(rootDir, 0)
    return results
  }

  private findIniFiles(rootDir: string, maxDepth: number): string[] {
    const results: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return

      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        if (entry.name.toLowerCase().endsWith('.ini')) {
          results.push(full)
        }
      }
    }

    walk(rootDir, 0)
    return results
  }

  private looksLikeReShadeConfigIni(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size < 16) return false
      // Read a small chunk to avoid slurping huge files.
      const head = fs.readFileSync(filePath, 'utf8').slice(0, 32_768).toLowerCase()
      if (!head.includes('presetpath') && !head.includes('currentpresetpath') && !head.includes('performancemode')) {
        // Some configs still have a [GENERAL] section but no preset path yet.
        if (!head.includes('[general]')) return false
      }
      // Avoid false positives from random INIs.
      return head.includes('reshade') || head.includes('presetpath') || head.includes('performancemode')
    } catch {
      return false
    }
  }

  private looksLikeGtaSettingsXml(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size < 32) return false
      const head = fs.readFileSync(filePath, 'utf8').slice(0, 2048)
      return head.includes('<Settings')
    } catch {
      return false
    }
  }

  private ensureClientGtaSettingsFile(clientPath: string): string {
    const settingsDir = path.join(clientPath, 'settings')
    const targetPath = path.join(settingsDir, 'gta5_settings.xml')
    const legacyPath = path.join(settingsDir, 'settings.xml')

    // If the file exists but is an empty placeholder, treat it as missing.
    // (New clients used to be created with an empty settings.xml, which would get migrated and cause GTA/FiveM to regenerate defaults.)
    if (this.looksLikeGtaSettingsXml(targetPath)) return targetPath

    // Migrate legacy filename if it exists
    if (this.looksLikeGtaSettingsXml(legacyPath)) {
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.copyFileSync(legacyPath, targetPath)
      return targetPath
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })

    const templateCandidates = [
      path.join(process.cwd(), 'resources', 'settings-template.xml'),
      path.join(__dirname, '../../resources/settings-template.xml')
    ]

    const templatePath = templateCandidates.find((p) => fs.existsSync(p))
    if (templatePath) {
      fs.copyFileSync(templatePath, targetPath)
      return targetPath
    }

    // small fallback so user can launch/edit immediately even without a template
    const minimal = `<?xml version="1.0" encoding="UTF-8"?>\n<Settings>\n  <configSource>SMC_USER</configSource>\n</Settings>\n`
    fs.writeFileSync(targetPath, minimal, 'utf8')
    return targetPath
  }

  private startGtaSettingsEnforcement(
    source: string,
    targets: string[],
    _statusCallback?: (status: string) => void
  ): void {
    let desired: Buffer
    try {
      desired = fs.readFileSync(source)
    } catch {
      return
    }

    const uniqueTargets = Array.from(new Set(targets.filter(Boolean)))
    if (uniqueTargets.length === 0) return

    const startedAt = Date.now()
    const durationMs = 180_000
    const intervalMs = 750
    // NOTE: Do not send long-running "finalizing" statuses to the UI.
    // Enforcement can run for minutes and would overwrite the "Launched!" status.

    const writes: Record<string, number> = {}

    const interval = setInterval(() => {
      const now = Date.now()
      if (now - startedAt > durationMs) {
        clearInterval(interval)
        return
      }

      for (const target of uniqueTargets) {
        let current: Buffer | null = null
        try {
          current = fs.readFileSync(target)
        } catch {
          current = null
        }

        if (!current || !current.equals(desired)) {
          writes[target] = (writes[target] ?? 0) + 1
          if (writes[target] === 1 || writes[target] % 25 === 0) {
            console.log(`[GTA Settings] Detected overwrite -> reapplying (${writes[target]}x):`, target)
          }
          this.copyFileBestEffort(source, target)
        }
      }
    }, intervalMs)

    // Don’t keep the Electron main process alive just for this timer
    interval.unref?.()
  }

  private isProcessRunning(processName: string): boolean {
    try {
      const result = execSync(`tasklist /FI "IMAGENAME eq ${processName}" /NH`, { encoding: 'utf8' })
      return result.toLowerCase().includes(processName.toLowerCase())
    } catch {
      return false
    }
  }

  public async launchClient(
    clientId: string,
    linkOptions: LinkOptions,
    statusCallback?: (status: string) => void
  ): Promise<boolean> {
    // Never allow a new launch while we are still finalizing plugin sync from a previous run.
    // Starting a new client during finalization can mix files across clients.
    await this.waitForPendingPluginsFinalization(statusCallback)

    // Stop any previous client sync (e.g., when launching a different client)
    this.stopActiveWatchers()

    const fiveMPath = getFiveMPath() // .../FiveM.app
    const fiveMExe = getFiveMExecutable() // .../FiveM.exe
    const appsDataPath = getClientsDataPath()

    if (!fiveMPath || !fiveMExe) {
      throw new Error('FiveM installation not found.')
    }

    const clientPath = path.join(appsDataPath, clientId)
    if (!fs.existsSync(clientPath)) {
      throw new Error(`Client data for ID ${clientId} not found.`)
    }

    try {
      statusCallback?.('Preparing launch...')

      // Check if GTA V or FiveM is already running
      if (this.isProcessRunning('GTA5.exe') || this.isProcessRunning('FiveM.exe')) {
        throw new Error('Please close GTA V and FiveM before launching a new client.')
      }

      // 1. Link Mods
      if (linkOptions.mods) {
        statusCallback?.('Linking mods...')
        this.linkFolder(path.join(clientPath, 'mods'), path.join(fiveMPath, 'mods'))
      }

      // 2. Link Plugins
      if (linkOptions.plugins) {
        const pluginsMode = linkOptions.pluginsMode ?? 'sync'
        const clientPluginsDir = path.join(clientPath, 'plugins')
        const gamePluginsDir = path.join(fiveMPath, 'plugins')

        try {
          console.log(`[Launch] clientId=${clientId} pluginsMode=${pluginsMode} clientPluginsDir=${clientPluginsDir} gamePluginsDir=${gamePluginsDir}`)
        } catch {
          // ignore
        }

        if (pluginsMode === 'sync') {
          statusCallback?.('Syncing plugins (copy mode)...')

          const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')
          try {
            fs.mkdirSync(reshadeClientDir, { recursive: true })
          } catch {
            // ignore
          }

          const step = (name: string, fn: () => void) => {
            try {
              fn()
            } catch (err) {
              try {
                this.reshadeLog(reshadeClientDir, `Plugins sync ERROR at step=${name}: ${(err as Error).message}`, statusCallback)
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
                this.reshadeLog(reshadeClientDir, `Plugins sync ERROR at step=${name}: ${(err as Error).message}`, statusCallback)
              } catch {
                // ignore
              }
              throw err
            }
          }

          // Make sure both directories exist
          step('mkdir client plugins', () => {
            fs.mkdirSync(clientPluginsDir, { recursive: true })
          })

          // NOTE: Avoid expensive mergeFolderContents here.
          // It can be huge and will freeze the launcher (sync IO on main thread).
          // Copy/Sync mode is non-destructive and doesn't delete game-side files anyway.

          // Ensure FiveM.app\plugins is isolated per client in sync mode.
          // If it was previously managed by another client (or was unmanaged), rotate it away.
          step('prepare isolated game plugins directory', () => {
            this.prepareGamePluginsDirForSyncMode(gamePluginsDir, clientId, statusCallback)
          })

          // Seed from client -> game so the per-client folder wins at launch.
          // IMPORTANT: do a one-way mirror here to avoid copying from game->client at launch.
          // Continuous full-folder syncing while FiveM is running can cause crashes if binaries
          // are copied while being loaded. Runtime syncing is limited to safe config files.
          await stepAsync('initial mirror client->game', async () => {
            const cachePath = this.getPluginsMirrorCacheFile(clientPath, 'client->game')
            const cache = this.loadPluginsMirrorCache(this.getPluginsMirrorCacheKey(clientId, 'client->game'), cachePath)
            let lastProgressAt = 0
            await this.mirrorFolderSourceWinsOneWayAsync(clientPluginsDir, gamePluginsDir, {
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

            this.savePluginsMirrorCache(cachePath, cache)
          })

          // Keep syncing *safe config files* while the game runs + do a full reconciliation after exit.
          const keepSyncingWhileGameRuns = () =>
            this.isProcessRunning('FiveM.exe') || this.isProcessRunning('GTA5.exe')

          try {
            let wasRunning = false
            const startedAt = Date.now()
            const durationMs = 21_600_000
            const intervalMs = 10_000
            const interval = this.registerInterval(setInterval(() => {
              try {
                const now = Date.now()
                if (now - startedAt > durationMs) {
                  clearInterval(interval)
                  this.activeIntervals = this.activeIntervals.filter((x) => x !== interval)
                  return
                }

                const running = keepSyncingWhileGameRuns()
                if (running) {
                  wasRunning = true
                  // Only sync safe files from game -> client while running.
                  this.mirrorFolderOneWay(gamePluginsDir, clientPluginsDir, {
                    filterRel: (rel) => this.isSafeRuntimePluginFile(rel),
                    maxFiles: 350
                  })
                  return
                }

                // Game is not running.
                // If it was running and just exited, do one last SAFE sync from game->client, then stop.
                // If it wasn't running at all, stop immediately (don't keep syncing in the background).
                clearInterval(interval)
                this.activeIntervals = this.activeIntervals.filter((x) => x !== interval)

                if (wasRunning) {
                  statusCallback?.('Finalizing plugins sync...')
                  const finalizePromise = this.mirrorFolderPreferNewestOneWayAsync(gamePluginsDir, clientPluginsDir, {
                    filterRel: (rel) => this.isSafeRuntimePluginFile(rel),
                    maxFiles: 5000,
                    yieldEvery: 250,
                    onProgress: ({ processed, copied }) => {
                      statusCallback?.(`Finalizing plugins sync... ${processed} scanned, ${copied} updated`)
                    }
                  }).then(
                    () => {
                      statusCallback?.('Plugins sync complete.')
                    },
                    (err) => {
                      try {
                        this.reshadeLog(reshadeClientDir, `Plugins final sync ERROR: ${(err as Error).message}`, statusCallback)
                      } catch {
                        // ignore
                      }
                    }
                  )

                  // Mark busy while the final sync is running, but clear automatically when done.
                  let tracked: Promise<void>
                  tracked = finalizePromise.finally(() => {
                    if (this.pendingPluginsFinalization === tracked) {
                      this.pendingPluginsFinalization = null
                    }
                  })
                  this.pendingPluginsFinalization = tracked
                }
              } catch (err) {
                try {
                  this.reshadeLog(reshadeClientDir, `Plugins sync loop ERROR: ${(err as Error).message}`)
                } catch {
                  // ignore
                }
              }
            }, intervalMs))
          } catch {
            // ignore
          }

          // Log which physical path is being used.
          try {
            const gamePluginsReal = fs.realpathSync.native
              ? fs.realpathSync.native(gamePluginsDir)
              : fs.realpathSync(gamePluginsDir)
            const clientPluginsReal = fs.realpathSync.native
              ? fs.realpathSync.native(clientPluginsDir)
              : fs.realpathSync(clientPluginsDir)

            const owner = this.readPluginsOwnerMarker(gamePluginsDir)
            this.reshadeLog(
              reshadeClientDir,
              `Plugins owner marker (game plugins): ${JSON.stringify(owner)}`,
              statusCallback
            )
            this.reshadeLog(
              reshadeClientDir,
              `Plugins mode=sync: game=${gamePluginsDir} -> real=${gamePluginsReal}; client=${clientPluginsDir} -> real=${clientPluginsReal}`,
              statusCallback
            )
            statusCallback?.('Note: Plugins are in copy/sync mode. ReShade should use the FiveM.app\\plugins path.')
          } catch (err) {
            try {
              this.reshadeLog(reshadeClientDir, `ERROR reading plugins realpath: ${(err as Error).message}`, statusCallback)
            } catch {
              // ignore
            }
          }
        } else {
          statusCallback?.('Linking plugins...')
          // Junction mode: migrate only ReShade-related plugin files to avoid huge sync/merge that can crash/freeze.
          await this.migrateExistingPluginsForJunctionAsync(gamePluginsDir, clientPluginsDir, clientId, statusCallback)
          this.linkFolder(clientPluginsDir, gamePluginsDir, {
            migrateExisting: false
          })

          // Record ownership on the client plugins folder for debugging.
          this.writePluginsOwnerMarker(clientPluginsDir, { clientId, mode: 'junction' })

          // Log where the junction points. This is critical for debugging "it was in plugins" cases.
          try {
            const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')
            fs.mkdirSync(reshadeClientDir, { recursive: true })
            const gamePluginsReal = fs.realpathSync.native
              ? fs.realpathSync.native(gamePluginsDir)
              : fs.realpathSync(gamePluginsDir)
            const clientPluginsReal = fs.realpathSync.native
              ? fs.realpathSync.native(clientPluginsDir)
              : fs.realpathSync(clientPluginsDir)

            this.reshadeLog(
              reshadeClientDir,
              `Plugins link: game=${gamePluginsDir} -> real=${gamePluginsReal}; client=${clientPluginsDir} -> real=${clientPluginsReal}`,
              statusCallback
            )

            statusCallback?.('Note: Plugins are linked (junction). ReShade may open the client plugins folder.')
          } catch (err) {
            try {
              const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')
              this.reshadeLog(reshadeClientDir, `ERROR reading plugins realpath: ${(err as Error).message}`, statusCallback)
            } catch {
              // ignore
            }
          }
        }
      }

      // Optional: Sync common ReShade config/preset files that live next to FiveM.exe.
      // Many ReShade installs write presets/config beside the executable instead of inside plugins.
      // This keeps client storage and the real install in sync while the app is open.
      try {
        const baseDir = path.dirname(fiveMExe)
        const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')

        const pluginsDir = path.join(fiveMPath, 'plugins')
        const appData = process.env.APPDATA
        const localAppData = process.env.LOCALAPPDATA

        fs.mkdirSync(reshadeClientDir, { recursive: true })
        this.reshadeLog(reshadeClientDir, `Scan start: baseDir=${baseDir}; fiveMPath=${fiveMPath}; pluginsDir=${pluginsDir}`, statusCallback)

        const gtaDirs = this.getGtaInstallDirCandidates()
        const commonReShadeDirs = [
          baseDir,
          fiveMPath,
          pluginsDir,
          ...gtaDirs,
          appData ? path.join(appData, 'ReShade') : '',
          localAppData ? path.join(localAppData, 'ReShade') : ''
        ].filter(Boolean)

        const discoveredIniPaths = new Set<string>()
        const discoveredPresetIniPaths = new Set<string>()
        const discoveredLogPaths = new Set<string>()

        for (const dir of commonReShadeDirs) {
          // Quick direct checks
          const iniDirect = path.join(dir, 'ReShade.ini')
          const presetDirect = path.join(dir, 'ReShadePreset.ini')
          const logDirect = path.join(dir, 'ReShade.log')
          if (fs.existsSync(iniDirect)) discoveredIniPaths.add(iniDirect)
          if (fs.existsSync(presetDirect)) discoveredPresetIniPaths.add(presetDirect)
          if (fs.existsSync(logDirect)) discoveredLogPaths.add(logDirect)

          // Shallow discovery (covers cases like plugins/reshade/..)
          for (const found of this.findFilesByName(dir, 'reshade.ini', 3)) discoveredIniPaths.add(found)
          for (const found of this.findFilesByName(dir, 'reshadepreset.ini', 3)) discoveredPresetIniPaths.add(found)
          for (const found of this.findFilesByName(dir, 'reshade.log', 3)) discoveredLogPaths.add(found)

          // Heuristic discovery: some installs use per-exe config names.
          // Scan INIs shallowly and pick the ones that look like ReShade configs.
          for (const iniPath of this.findIniFiles(dir, 3)) {
            if (iniPath.toLowerCase().endsWith('reshadepreset.ini')) continue
            if (iniPath.toLowerCase().endsWith('reshade.ini')) continue
            if (this.looksLikeReShadeConfigIni(iniPath)) {
              discoveredIniPaths.add(iniPath)
            }
          }
        }

        // Always dump a short list of "ReShade-ish" candidates inside plugins, even if discovery misses.
        try {
          const candidates = this
            .findIniFiles(pluginsDir, 5)
            .filter((p) => p.toLowerCase().includes('reshade') || this.looksLikeReShadeConfigIni(p))
            .slice(0, 25)

          if (candidates.length > 0) {
            this.reshadeLog(reshadeClientDir, `Plugins candidate INIs (${candidates.length} shown): ${candidates.join(' | ')}`)

            const likelyPresets = candidates
              .filter((p) => p.toLowerCase().includes(`${path.sep}presets${path.sep}`))
              .map((p) => ({ file: p, isPreset: this.looksLikeReShadePresetFile(p) }))
              .slice(0, 12)
            if (likelyPresets.length > 0) {
              this.reshadeLog(
                reshadeClientDir,
                `Plugins preset candidates: ${likelyPresets.map((x) => `${x.isPreset ? 'OK' : 'NOT_A_PRESET'}:${path.basename(x.file)}`).join(' | ')}`
              )
            }
          } else {
            this.reshadeLog(reshadeClientDir, 'Plugins candidate INIs: none found (by name/content heuristic).')
          }
        } catch {
          // ignore
        }

        const keepSyncingWhileGameRuns = () => this.isProcessRunning('FiveM.exe') || this.isProcessRunning('GTA5.exe')

        // Use ReShade.log to discover which config/preset paths are actually being used.
        for (const logPath of discoveredLogPaths) {
          const tail = this.readFileTailUtf8(logPath, 96 * 1024)
          if (!tail) continue
          const extracted = this.extractWindowsFilePaths(tail)
          if (extracted.length === 0) continue

          this.reshadeLog(
            reshadeClientDir,
            `Log hints from ${logPath}: ${extracted.slice(0, 6).join(' | ')}${extracted.length > 6 ? ' | ...' : ''}`
          )

          for (const p of extracted) {
            try {
              if (!fs.existsSync(p)) continue
              const lower = p.toLowerCase()
              if (lower.endsWith('reshadepreset.ini')) {
                discoveredPresetIniPaths.add(p)
                continue
              }
              if (lower.endsWith('reshade.ini')) {
                discoveredIniPaths.add(p)
                continue
              }
              if (lower.endsWith('.ini') && this.looksLikeReShadeConfigIni(p)) {
                discoveredIniPaths.add(p)
              }
            } catch {
              // ignore
            }
          }
        }

        statusCallback?.(`ReShade: found ${discoveredIniPaths.size} config file(s)`)
        statusCallback?.(`ReShade: found ${discoveredPresetIniPaths.size} preset-ini file(s)`)
        if (discoveredLogPaths.size > 0) statusCallback?.(`ReShade: found ${discoveredLogPaths.size} log file(s)`)

        const pluginReshadeIni: string[] = []
        const pluginReshadePresetIni: string[] = []
        try {
          const directConfig = path.join(pluginsDir, 'ReShade.ini')
          const directPresetIni = path.join(pluginsDir, 'ReShadePreset.ini')
          if (fs.existsSync(directConfig)) pluginReshadeIni.push(directConfig)
          if (fs.existsSync(directPresetIni)) pluginReshadePresetIni.push(directPresetIni)
          for (const found of this.findFilesByName(pluginsDir, 'reshade.ini', 3)) pluginReshadeIni.push(found)
          for (const found of this.findFilesByName(pluginsDir, 'reshadepreset.ini', 3)) pluginReshadePresetIni.push(found)
        } catch {
          // ignore
        }

        // Always dump a quick snapshot of any ReShade.ini inside plugins (your reported setup).
        try {
          for (const p of pluginReshadeIni) {
            const summary = this.pickIniSummary(p)
            const rw = this.canOpenReadWrite(p)
            const presetLines = this.extractPresetRelatedLines(p, 25)
            this.reshadeLog(
              reshadeClientDir,
              `Plugins config snapshot: ${p} rw=${rw.ok ? 'ok' : `FAIL:${rw.error ?? ''}`} -> ${JSON.stringify(summary)} presetLines=${JSON.stringify(presetLines)}`
            )
          }
          for (const p of pluginReshadePresetIni) {
            const summary = this.pickIniSummary(p)
            const rw = this.canOpenReadWrite(p)
            const presetLines = this.extractPresetRelatedLines(p, 25)
            this.reshadeLog(
              reshadeClientDir,
              `Plugins preset-ini snapshot: ${p} rw=${rw.ok ? 'ok' : `FAIL:${rw.error ?? ''}`} -> ${JSON.stringify(summary)} presetLines=${JSON.stringify(presetLines)}`
            )
          }
        } catch {
          // ignore
        }

        // Write a small debug file per-client so we can see what paths were detected even if the UI status gets overwritten.
        try {
          const debug = {
            at: new Date().toISOString(),
            fiveMExe,
            fiveMPath,
            pluginsDir,
            gtaDirs,
            configs: Array.from(discoveredIniPaths),
            presetInis: Array.from(discoveredPresetIniPaths),
            logs: Array.from(discoveredLogPaths)
          }
          fs.writeFileSync(path.join(reshadeClientDir, 'last-scan.json'), JSON.stringify(debug, null, 2), 'utf8')
        } catch {
          // ignore
        }

        // Sync all discovered ini locations to the client store (newest wins).
        for (const iniPath of discoveredIniPaths) {
          if (iniPath.toLowerCase().startsWith(pluginsDir.toLowerCase() + path.sep)) {
            this.reshadeLog(reshadeClientDir, `Using plugins-linked config (no extra sync): ${iniPath}`)
            continue
          }

          const id = this.fnv1a32Hex(path.resolve(iniPath).toLowerCase())
          const clientTarget = path.join(reshadeClientDir, 'sources', id, path.basename(iniPath))
          this.seedAndStartTwoWaySync(clientTarget, iniPath, keepSyncingWhileGameRuns)

          const summary = this.pickIniSummary(iniPath)
          if (Object.keys(summary).length > 0) {
            this.reshadeLog(reshadeClientDir, `Config summary: ${iniPath} -> ${JSON.stringify(summary)}`)
          }
        }

        for (const presetIniPath of discoveredPresetIniPaths) {
          if (presetIniPath.toLowerCase().startsWith(pluginsDir.toLowerCase() + path.sep)) {
            this.reshadeLog(reshadeClientDir, `Using plugins-linked preset-ini (no extra sync): ${presetIniPath}`)
            continue
          }

          const id = this.fnv1a32Hex(path.resolve(presetIniPath).toLowerCase())
          const clientTarget = path.join(reshadeClientDir, 'sources', id, path.basename(presetIniPath))
          this.seedAndStartTwoWaySync(clientTarget, presetIniPath, keepSyncingWhileGameRuns)

          const summary = this.pickIniSummary(presetIniPath)
          if (Object.keys(summary).length > 0) {
            this.reshadeLog(reshadeClientDir, `Preset-ini summary: ${presetIniPath} -> ${JSON.stringify(summary)}`)
          }
        }

        // Periodically snapshot active keys while the game is running.
        try {
          let everRunning = false
          const interval = setInterval(() => {
            const running = keepSyncingWhileGameRuns()
            if (running) everRunning = true
            if (!running && everRunning) {
              clearInterval(interval)
              this.reshadeLog(reshadeClientDir, 'Game closed: final ReShade snapshot complete.')
              return
            }
            if (!running) return

            const candidates = Array.from(discoveredIniPaths).slice(0, 4)
            for (const c of candidates) {
              const summary = this.pickIniSummary(c)
              if (Object.keys(summary).length > 0) {
                this.reshadeLog(reshadeClientDir, `Live snapshot: ${c} -> ${JSON.stringify(summary)}`)
              }
            }
          }, 15_000)
          interval.unref?.()
        } catch {
          // ignore
        }

        // Live monitor the plugins-linked ReShade INI files.
        try {
          const maybeConfig = path.join(pluginsDir, 'ReShade.ini')
          const maybePresetIni = path.join(pluginsDir, 'ReShadePreset.ini')
          this.startReShadeFileMonitor(reshadeClientDir, maybeConfig, 'plugins/ReShade.ini', keepSyncingWhileGameRuns)
          this.startReShadeFileMonitor(reshadeClientDir, maybePresetIni, 'plugins/ReShadePreset.ini', keepSyncingWhileGameRuns)
        } catch {
          // ignore
        }

        // Also attempt to sync the currently-selected preset file if the config points outside plugins.
        const configPathForPresetDiscovery = (() => {
          const pluginsConfig = path.join(pluginsDir, 'ReShade.ini')
          if (fs.existsSync(pluginsConfig)) return pluginsConfig
          const firstDiscovered = Array.from(discoveredIniPaths)[0]
          if (firstDiscovered && fs.existsSync(firstDiscovered)) return firstDiscovered
          return ''
        })()

        if (configPathForPresetDiscovery) {
          let iniText = ''
          try {
            iniText = fs.readFileSync(configPathForPresetDiscovery, 'utf8')
          } catch {
            iniText = ''
          }

          const baseIniDir = path.dirname(configPathForPresetDiscovery)
          const presetValues = this.parseReShadeIniPresetPaths(iniText)
          if (presetValues.length > 0) {
            this.reshadeLog(reshadeClientDir, `Preset discovery: from=${configPathForPresetDiscovery} -> ${presetValues.join(' | ')}`)
          }

          for (const presetValue of presetValues) {
            const presetAbs = this.resolveMaybeRelativePath(baseDir, baseIniDir, presetValue)

            this.reshadeLog(
              reshadeClientDir,
              `Preset resolved: value=${presetValue} -> abs=${presetAbs} exists=${fs.existsSync(presetAbs) ? 'yes' : 'no'} presetFile=${this.looksLikeReShadePresetFile(presetAbs) ? 'yes' : 'no'}`
            )

            if (fs.existsSync(presetAbs)) {
              this.startReShadeFileMonitor(reshadeClientDir, presetAbs, `preset:${path.basename(presetAbs)}`, keepSyncingWhileGameRuns)
            } else {
              this.reshadeLog(reshadeClientDir, `Preset path does not exist yet: ${presetAbs}`)
            }

            if (presetAbs.toLowerCase().startsWith(pluginsDir.toLowerCase() + path.sep)) {
              continue
            }

            const id = this.fnv1a32Hex(path.resolve(presetAbs).toLowerCase())
            const clientPresetPath = path.join(reshadeClientDir, 'sources', id, 'presets', path.basename(presetAbs))
            this.seedAndStartTwoWaySync(clientPresetPath, presetAbs, keepSyncingWhileGameRuns)
          }
        } else {
          this.reshadeLog(reshadeClientDir, 'Preset discovery: no readable config path found to parse PresetPath.')
        }
      } catch {
        // ignore
      }

      // 3. Link Citizen (Advanced) - BE CAREFUL
      // Only link if the client has specific citizen files, otherwise we might break the game if we link an empty folder.
      // Usually users want to replace specific files inside citizen/common/data etc.
      // Linking the whole 'citizen' folder requires a full copy of the game engine basically.
      // For now, I will implement it as requested but we might want to change this to partial linking later or overlay.
      // If the client folder is empty, maybe we shouldn't link it?
      // The user plan said: "linking the mods, plugins, citizens ... to the specified ones"
      // I will assume for now if the folder exists in client, we link it.
      // But if we link an empty folder, game won't start.
      // Better strategy: We don't link citizen by default unless specifically toggled or populated.
      // I will stick to mods/plugins for safety first, but include citizen logic commented or active.
      // Let's implement it active but check if not empty?
      // Actually, safest way is: Rename original -> citizen_original. Link new one.
      // If new one is missing essential files, game crashes. That's on the user to provide correct files.

      if (linkOptions.citizen) {
        this.linkFolder(path.join(clientPath, 'citizen'), path.join(fiveMPath, 'citizen'))
      }

      // 4. GTA Settings - FiveM reads from BOTH CitizenFX AppData AND FiveM.app!
      if (linkOptions.gtaSettings) {
        statusCallback?.('Applying GTA settings...')
        const source = this.ensureClientGtaSettingsFile(clientPath)
        console.log('GTA Settings - Source:', source, 'exists:', fs.existsSync(source))

          // NOTE: Temporarily disabled per request (testing whether KVS affects settings persistence).
          // CRITICAL: FiveM's profile data can OVERRIDE settings.xml.
          //
          // 1. Delete KVS cache (profile key-value store)
          // const kvsPath = path.join(process.env.APPDATA || '', 'CitizenFX', 'kvs')
          // if (fs.existsSync(kvsPath)) {
          //   try {
          //     console.log('Clearing FiveM profile cache (KVS)...')
          //     fs.rmSync(kvsPath, { recursive: true, force: true })
          //     console.log('KVS cache cleared')
          //   } catch (err) {
          //     console.warn('Could not clear KVS cache:', err)
          //   }
          // }

          // 2. Backup/remove fivem_sdk.cfg (contains profile console variables that override XML)
          const sdkCfgPath = path.join(process.env.APPDATA || '', 'CitizenFX', 'fivem_sdk.cfg')
          if (fs.existsSync(sdkCfgPath)) {
            try {
              console.log('Backing up fivem_sdk.cfg (profile console variables)...')
              const backupPath = `${sdkCfgPath}.backup_${Date.now()}`
              fs.renameSync(sdkCfgPath, backupPath)
              console.log('fivem_sdk.cfg backed up and removed')
            } catch (err) {
              console.warn('Could not backup fivem_sdk.cfg:', err)
            }
          }

        const targets: string[] = []

        // CitizenFX Roaming (PRIMARY)
        const citizenFxTarget = getGtaSettingsPath()
        if (citizenFxTarget) targets.push(citizenFxTarget)

        // FiveM.app settings.xml (some installs/flows still read/override from here)
        const fiveMAppSettings = getFiveMAppSettingsPath()
        if (fiveMAppSettings) targets.push(fiveMAppSettings)

        // CitizenFX LocalAppData (some installs use this)
        if (process.env.LOCALAPPDATA) targets.push(path.join(process.env.LOCALAPPDATA, 'CitizenFX', 'gta5_settings.xml'))

        for (const target of targets) {
          if (!target) continue
          console.log('GTA Settings - Applying to:', target)
          this.replaceFile(source, target)
        }

        console.log('GTA Settings applied. Startup enforcement will keep re-applying if overwritten.')
      }

      // 5. CitizenFX.ini (optional)
      if (linkOptions.citizenFxIni) {
        const clientIni = path.join(clientPath, 'settings', 'CitizenFX.ini')
        this.ensureFileExists(clientIni, '')
        const targetIni = getCitizenFxIniPath()
        if (!targetIni) {
          console.warn('CitizenFX.ini target not found (APPDATA missing?)')
        } else {
          statusCallback?.('Syncing CitizenFX.ini...')
          this.ensureFileExists(targetIni, '')
          // Seed the real INI from client at launch (client is the intentional source of truth)
          this.copyFileBestEffort(clientIni, targetIni)
          // Keep edits in sync both ways while the app is open
          this.startTwoWayFileSync(clientIni, targetIni)
        }
      }

      statusCallback?.('Starting FiveM...')
      console.log('Folders linked. Launching FiveM...')
      this.spawnProcess(fiveMExe)

      if (linkOptions.gtaSettings) {
        const source = this.ensureClientGtaSettingsFile(clientPath)
        const targets: string[] = [
          getGtaSettingsPath() || '',
          getFiveMAppSettingsPath() || '',
          process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'CitizenFX', 'gta5_settings.xml')
            : ''
        ]
        this.startGtaSettingsEnforcement(source, targets, statusCallback)
      }

      statusCallback?.('Launched!')
      return true
    } catch (e) {
      console.error('Failed to launch:', e)
      throw e
    }
  }

  private mergeFolderContents(fromDir: string, toDir: string): void {
    try {
      fs.mkdirSync(toDir, { recursive: true })
    } catch {
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(fromDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fromPath = path.join(fromDir, entry.name)
      const toPath = path.join(toDir, entry.name)

      let stat: fs.Stats
      try {
        stat = fs.lstatSync(fromPath)
      } catch {
        continue
      }

      if (stat.isSymbolicLink()) {
        continue
      }

      if (stat.isDirectory()) {
        this.mergeFolderContents(fromPath, toPath)
        continue
      }

      if (stat.isFile()) {
        if (fs.existsSync(toPath)) {
          continue
        }
        this.copyFileBestEffort(fromPath, toPath)
      }
    }
  }

  private linkFolder(
    source: string,
    target: string,
    options?: {
      migrateExisting?: boolean
    }
  ) {
    // source: The client's specific folder (e.g. clients/1/mods)
    // target: The real FiveM folder (e.g. FiveM.app/mods)

    // Ensure source exists
    if (!fs.existsSync(source)) {
      fs.mkdirSync(source, { recursive: true })
    }

    // Check target state
    if (fs.existsSync(target)) {
      const stats = fs.lstatSync(target)

      if (stats.isSymbolicLink()) {
        // It's already a link, remove it
        fs.unlinkSync(target)
      } else if (stats.isDirectory()) {
        if (options?.migrateExisting) {
          try {
            // Merge existing game-side files into the client folder before we take over.
            // This is especially helpful for ReShade presets/configs with arbitrary names.
            this.mergeFolderContents(target, source)
          } catch {
            // ignore
          }
        }
        // It's a real directory. We need to back it up so we don't lose user's original data.
        const backupPath = `${target}_original`
        if (!fs.existsSync(backupPath)) {
            // Only rename if backup doesn't exist yet, to avoid overwriting previous backup
            try {
              this.renameWithRetrySync(target, backupPath)
            } catch (err) {
              const code = (err as NodeJS.ErrnoException)?.code
              throw new Error(
                `Failed to back up existing folder (code=${code ?? 'unknown'}): ${target}. Close FiveM/any overlays and try again.`
              )
            }
        } else {
            // If backup exists, we assume current 'target' might be a stale folder or we can just move it to a temp name?
            // Or maybe the user manually fixed it.
            // Aggressive approach: If backup exists, assume 'target' is disposable or merge it?
            // Safer: Rename to _timestamp
            // fs.renameSync(target, `${target}_backup_${Date.now()}`)

            // For this implementation, let's assume if backup exists, we can remove the current folder as it shouldn't be there
            // if we are in "managed" mode. But since this is first run, let's be safe.
            // We will move it to _original (if we can), skipping if it exists is weird.
            // Let's just create unique backup.
            console.warn(`Backup already exists at ${backupPath}. Renaming current to unique backup.`)
            try {
              this.renameWithRetrySync(target, `${target}_backup_${Date.now()}`)
            } catch (err) {
              const code = (err as NodeJS.ErrnoException)?.code
              throw new Error(
                `Failed to move existing folder aside (code=${code ?? 'unknown'}): ${target}. Close FiveM/any overlays and try again.`
              )
            }
        }
      }
    }

    // Now target should be free. Create Symlink (Junction for Directories is safer on Windows without Admin)
    fs.symlinkSync(source, target, 'junction')
  }

  private replaceFile(source: string, target: string) {
    // Check if source exists - don't create empty file
    if (!fs.existsSync(source)) {
      console.warn(`Source file not found: ${source}. Skipping.`)
      throw new Error(`Settings file not found: ${source}. Please save settings first.`)
    }

    // Remove read-only flag from existing target if it exists
    if (fs.existsSync(target)) {
      try {
        fs.chmodSync(target, 0o666) // Make writable
      } catch (err) {
        console.warn('Failed to change permissions:', err)
      }

      const backupPath = `${target}.backup`
      try {
        fs.copyFileSync(target, backupPath)
        console.log(`Backed up existing file to ${backupPath}`)
      } catch (err) {
        console.warn('Failed to create backup:', err)
      }
    }

    // Ensure target directory exists with proper permissions
    fs.mkdirSync(path.dirname(target), { recursive: true })

    // Delete existing target to avoid any file lock issues
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target)
      } catch (err) {
        console.warn('Failed to delete existing target:', err)
      }
    }

    // Copy source to target
    fs.copyFileSync(source, target)

    // Force file system sync to ensure data is written to disk
    const fd = fs.openSync(target, 'r+')
    fs.fsyncSync(fd)
    fs.closeSync(fd)


    console.log(`Successfully replaced ${target} with ${source}`)
    console.log(`File size: ${fs.statSync(target).size} bytes`)
  }

  private spawnProcess(exePath: string) {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
    child.unref()
  }
}

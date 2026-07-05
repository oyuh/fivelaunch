import fs from 'fs'
import path from 'path'

const MTIME_SKEW_MS = 900

export type ListFilesOptions = {
  filterRel?: (relPath: string) => boolean
  skipDirRel?: (relDir: string) => boolean
  maxFiles?: number
}

export type MirrorAsyncOptions = ListFilesOptions & {
  yieldEvery?: number
  timeBudgetMs?: number
  cacheGetMtime?: (relPath: string) => number | undefined
  cacheSetMtime?: (relPath: string, mtimeMs: number) => void
  onProgress?: (p: { processed: number; copied: number; skipped: number }) => void
}

/**
 * Ensure a directory exists (best-effort).
 */
export function ensureDirExists(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // ignore
  }
}

/**
 * Ensure a file exists, creating it with optional fallback contents if missing (best-effort).
 */
export function ensureFileExists(filePath: string, fallbackContents = ''): void {
  try {
    ensureDirExists(path.dirname(filePath))
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, fallbackContents, 'utf8')
    }
  } catch {
    // ignore
  }
}

/**
 * Safe `mtimeMs` getter. Returns 0 on error.
 */
export function getMtimeMsSafe(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Best-effort copy that tolerates transient locks (common while the game is running).
 */
export function copyFileBestEffort(source: string, target: string): void {
  try {
    ensureDirExists(path.dirname(target))
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

/**
 * Async version of `copyFileBestEffort`.
 */
export async function copyFileBestEffortAsync(source: string, target: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.copyFile(source, target)
    return true
  } catch {
    // ignore - target can be locked while GTA/FiveM writes it
    return false
  }
}

/**
 * Two-way sync of files, copying whichever side is newer.
 *
 * If mtimes are too close to call, falls back to a content comparison.
 */
export function syncFilePreferNewest(a: string, b: string, tiePreference: 'a' | 'b' = 'b'): void {
  const aExists = fs.existsSync(a)
  const bExists = fs.existsSync(b)

  if (!aExists && !bExists) return
  if (aExists && !bExists) {
    ensureFileExists(b)
    copyFileBestEffort(a, b)
    return
  }
  if (bExists && !aExists) {
    ensureFileExists(a)
    copyFileBestEffort(b, a)
    return
  }

  const aTime = getMtimeMsSafe(a)
  const bTime = getMtimeMsSafe(b)
  const skewMs = MTIME_SKEW_MS

  if (aTime > bTime + skewMs) {
    copyFileBestEffort(a, b)
    return
  }
  if (bTime > aTime + skewMs) {
    copyFileBestEffort(b, a)
    return
  }

  // If timestamps are too close (common on some FS), fall back to content comparison.
  try {
    const aBuf = fs.readFileSync(a)
    const bBuf = fs.readFileSync(b)
    if (!aBuf.equals(bBuf)) {
      if (tiePreference === 'a') {
        copyFileBestEffort(a, b)
      } else {
        copyFileBestEffort(b, a)
      }
    }
  } catch {
    // ignore
  }
}

export function *listFilesRecursive(
  baseDir: string,
  options?: ListFilesOptions
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

export async function *listFilesRecursiveAsync(
  baseDir: string,
  options?: ListFilesOptions
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

/**
 * One-way mirror: copies all matching files from `sourceDir` to `targetDir`.
 */
export function mirrorFolderOneWay(
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

  for (const rel of listFilesRecursive(sourceDir, { filterRel: options?.filterRel, maxFiles: options?.maxFiles })) {
    const from = path.join(sourceDir, rel)
    const to = path.join(targetDir, rel)
    copyFileBestEffort(from, to)
  }
}

/**
 * One-way mirror that only copies a file if the source is newer than the target.
 *
 * Supports an optional mtime cache to avoid re-statting unchanged sources.
 */
export async function mirrorFolderPreferNewestOneWayAsync(
  sourceDir: string,
  targetDir: string,
  options?: MirrorAsyncOptions
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

  for await (const rel of listFilesRecursiveAsync(sourceDir, {
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
    const fromTime = getMtimeMsSafe(from)
    const skewMs = MTIME_SKEW_MS

    if (!toExists) {
      const ok = await copyFileBestEffortAsync(from, to)
      if (ok) options?.cacheSetMtime?.(rel, fromTime)
      copied += 1
    } else {
      const cached = options?.cacheGetMtime?.(rel)
      if (typeof cached === 'number' && Math.abs(cached - fromTime) <= skewMs) {
        // Source hasn't changed since last time we mirrored it; assume target is already correct.
        skipped += 1
      } else {
        const toTime = getMtimeMsSafe(to)
        if (fromTime > toTime + skewMs) {
          const ok = await copyFileBestEffortAsync(from, to)
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

/**
 * Source-authoritative mirror: copies from `sourceDir` to `targetDir` whenever the source changed.
 *
 * This is used at launch so the per-client plugin folder always "wins" over the game folder.
 */
export async function mirrorFolderSourceWinsOneWayAsync(
  sourceDir: string,
  targetDir: string,
  options?: MirrorAsyncOptions
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
  const skewMs = MTIME_SKEW_MS

  for await (const rel of listFilesRecursiveAsync(sourceDir, {
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

    const fromTime = getMtimeMsSafe(from)
    const cached = options?.cacheGetMtime?.(rel)
    const toExists = fs.existsSync(to)

    // Source-authoritative mirror:
    // - If source file didn't change since last time (cache hit), skip.
    // - Otherwise, copy from source to target (even if target is newer).
    if (toExists && typeof cached === 'number' && Math.abs(cached - fromTime) <= skewMs) {
      skipped += 1
    } else {
      const ok = await copyFileBestEffortAsync(from, to)
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

/**
 * Returns true if a file is safe to sync while FiveM/GTA is running.
 *
 * Keep this conservative: copying DLLs/binaries at runtime can crash the game.
 */
export function isSafeRuntimePluginFile(relPath: string): boolean {
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

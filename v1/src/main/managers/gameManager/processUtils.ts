import { exec, spawn } from 'child_process'

type ProcessCacheEntry = {
  running: boolean
  checkedAt: number
  pending: Promise<void> | null
}

const PROCESS_CACHE_TTL_MS = 750
const PROCESS_EXEC_TIMEOUT_MS = 6_000
const processCache = new Map<string, ProcessCacheEntry>()

function cacheKey(processName: string): string {
  return processName.trim().toLowerCase()
}

function ensureEntry(key: string): ProcessCacheEntry {
  const existing = processCache.get(key)
  if (existing) return existing
  const created: ProcessCacheEntry = { running: false, checkedAt: 0, pending: null }
  processCache.set(key, created)
  return created
}

async function runTasklist(processName: string): Promise<boolean> {
  const needle = processName.trim().toLowerCase()
  if (!needle) return false

  return await new Promise<boolean>((resolve) => {
    exec(
      `tasklist /FI "IMAGENAME eq ${processName}" /NH`,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: PROCESS_EXEC_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          resolve(false)
          return
        }
        resolve(String(stdout).toLowerCase().includes(needle))
      }
    )
  })
}

async function runTasklistAll(): Promise<string> {
  return await new Promise<string>((resolve) => {
    exec(
      'tasklist /NH',
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: PROCESS_EXEC_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      },
      (_error, stdout) => {
        resolve(String(stdout ?? ''))
      }
    )
  })
}

/**
 * Refresh multiple process names with a single `tasklist` call.
 *
 * This is much cheaper than running `tasklist` once per process.
 */
export async function refreshProcessRunningMany(
  processNames: string[]
): Promise<Record<string, boolean>> {
  const unique = Array.from(
    new Set(processNames.map((p) => p.trim()).filter(Boolean))
  )
  const keys = unique.map((n) => cacheKey(n))

  const entries = keys.map((k) => ensureEntry(k))
  const results: Record<string, boolean> = {}

  // If any of these are already being refreshed, just await them and return.
  const pending = entries.map((e) => e.pending).filter(Boolean) as Promise<void>[]
  if (pending.length > 0) {
    await Promise.all(pending)
    for (let i = 0; i < unique.length; i += 1) {
      results[unique[i]] = entries[i].running
    }
    return results
  }

  const now = Date.now()
  for (const entry of entries) {
    entry.pending = Promise.resolve()
  }

  const stdout = (await runTasklistAll()).toLowerCase()
  for (let i = 0; i < unique.length; i += 1) {
    const name = unique[i]
    const key = keys[i]
    const entry = ensureEntry(key)
    const running = stdout.includes(name.toLowerCase())
    entry.running = running
    entry.checkedAt = now
    entry.pending = null
    results[name] = running
  }

  return results
}

/**
 * Forces an async refresh of a process running state.
 *
 * Use this when you need an up-to-date answer (e.g. before launching).
 */
export async function refreshProcessRunning(processName: string): Promise<boolean> {
  const key = cacheKey(processName)
  const entry = ensureEntry(key)

  if (entry.pending) {
    await entry.pending
    return entry.running
  }

  entry.pending = (async () => {
    try {
      entry.running = await runTasklist(processName)
    } finally {
      entry.checkedAt = Date.now()
      entry.pending = null
    }
  })()

  await entry.pending
  return entry.running
}

/**
 * Returns true if a process with the given image name is running.
 *
 * Windows-only implementation via `tasklist` (the app targets Windows).
 */
export function isProcessRunning(processName: string): boolean {
  const key = cacheKey(processName)
  const entry = ensureEntry(key)

  // Kick off a refresh in the background if stale.
  const now = Date.now()
  if (now - entry.checkedAt > PROCESS_CACHE_TTL_MS && !entry.pending) {
    void refreshProcessRunning(processName)
  }

  return entry.running
}

/**
 * Launch an executable detached from the parent process.
 *
 * Used to start FiveM without keeping a handle open in the launcher.
 */
export function spawnDetachedProcess(exePath: string): void {
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
  child.unref()
}

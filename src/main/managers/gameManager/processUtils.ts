import { execSync, spawn } from 'child_process'

/**
 * Returns true if a process with the given image name is running.
 *
 * Windows-only implementation via `tasklist` (the app targets Windows).
 */
export function isProcessRunning(processName: string): boolean {
  try {
    const result = execSync(`tasklist /FI "IMAGENAME eq ${processName}" /NH`, { encoding: 'utf8' })
    return result.toLowerCase().includes(processName.toLowerCase())
  } catch {
    return false
  }
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

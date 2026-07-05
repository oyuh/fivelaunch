import fs from 'fs'

/**
 * Synchronously sleeps for a short time.
 *
 * Used as a backoff primitive for retry loops around Windows file locks.
 */
export function sleepSync(ms: number): void {
  try {
    // Synchronous small backoff for retry loops (Windows file locks).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // ignore
  }
}

/**
 * `renameSync` with retry/backoff for common transient Windows locking errors.
 */
export function renameWithRetrySync(from: string, to: string, retries = 20, delayMs = 75): void {
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
      sleepSync(delayMs)
    }
  }
}

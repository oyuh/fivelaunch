import type { BrowserWindow } from 'electron'

/**
 * Tiny helper to track startup milestones.
 *
 * It optionally logs timing to the console and can update the splash screen
 * status line (if present).
 */
export type StartupTracker = {
  /** Marks a milestone, optionally logging timing and updating splash status. */
  mark: (label: string) => void

  /** Updates the splash UI status line, if the splash window exists. */
  setSplashStatus: (text: string) => void
}

/**
 * Creates a startup tracker.
 */
export function createStartupTracker(opts: {
  timingEnabled: boolean
  getSplashWindow: () => BrowserWindow | null
}): StartupTracker {
  const startupT0 = Date.now()

  const setSplashStatus = (text: string): void => {
    try {
      const splash = opts.getSplashWindow()
      if (!splash || splash.isDestroyed()) return
      const safe = JSON.stringify(String(text))
      splash.webContents.executeJavaScript(`window.__setStatus && window.__setStatus(${safe});`, true)
    } catch {
      // ignore
    }
  }

  const mark = (label: string) => {
    setSplashStatus(label)
    if (!opts.timingEnabled) return
    const ms = Date.now() - startupT0
    // eslint-disable-next-line no-console
    console.log(`[startup +${ms}ms] ${label}`)
  }

  return { mark, setSplashStatus }
}

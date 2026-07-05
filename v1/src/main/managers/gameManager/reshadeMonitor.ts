import fs from 'fs'
import { getReshadeFileSnapshot } from './reshadeSync'

/**
 * Polls a file while the game runs and logs snapshots when it changes.
 *
 * This avoids relying on FS events, since many ReShade/GTA configs are written via
 * atomic save patterns (temp + rename).
 */
export function startReShadeFileMonitor(
  reshadeClientDir: string,
  filePath: string,
  label: string,
  shouldContinue: () => boolean,
  reshadeLog: (reshadeClientDir: string, message: string) => void
): void {
  try {
    let lastSig = ''
    let everRunning = false

    const interval = setInterval(() => {
      const running = shouldContinue()
      if (running) everRunning = true
      if (!running && everRunning) {
        clearInterval(interval)
        reshadeLog(reshadeClientDir, `Monitor stop: ${label}`)
        return
      }
      if (!running) return

      // Cheap stat check first; only read/hash the file if it actually changed.
      try {
        const st = fs.statSync(filePath)
        const sig = `${st.size}:${st.mtimeMs}`
        if (sig === lastSig) return
        lastSig = sig
      } catch {
        // If stat fails, fall through and let snapshot capture details.
      }

      const snapshot = getReshadeFileSnapshot(filePath)

      const rw = snapshot.canReadWrite.ok ? 'ok' : `FAIL:${snapshot.canReadWrite.error ?? ''}`

      if (label.startsWith('preset:')) {
        reshadeLog(
          reshadeClientDir,
          `${label} changed (${snapshot.statSig}) hash=${snapshot.quickHash} rw=${rw} path=${filePath} keyLines=${JSON.stringify(snapshot.presetKeyLines)}`
        )
        return
      }

      reshadeLog(
        reshadeClientDir,
        `${label} changed (${snapshot.statSig}) hash=${snapshot.quickHash} rw=${rw} summary=${JSON.stringify(snapshot.iniSummary)} presetLines=${JSON.stringify(snapshot.presetLines)}`
      )
    }, 2_000)

    interval.unref?.()
  } catch {
    // ignore
  }
}

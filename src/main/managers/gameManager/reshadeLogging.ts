import fs from 'fs'
import path from 'path'

/**
 * Append a single line to a log file (best-effort).
 */
export function appendTextLog(logFilePath: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
    fs.appendFileSync(logFilePath, line.endsWith('\n') ? line : `${line}\n`, 'utf8')
  } catch {
    // ignore
  }
}

/**
 * Write a ReShade-related diagnostic line to console and a per-client log.
 *
 * Note: we intentionally keep UI status updates minimal to avoid overwriting launch status.
 */
export function reshadeLog(
  reshadeClientDir: string,
  message: string,
  statusCallback?: (status: string) => void
): void {
  const line = `[ReShade] ${new Date().toISOString()} ${message}`
  console.log(line)
  appendTextLog(path.join(reshadeClientDir, 'diagnostics.log'), line)
  // Keep UI status minimal to avoid overwriting other launch messages.
  if (statusCallback && message.startsWith('ERROR')) {
    statusCallback('ReShade: error (see diagnostics.log)')
  }
}

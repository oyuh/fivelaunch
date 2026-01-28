import { format as formatUtil } from 'util'
import type { BrowserWindow } from 'electron'

/**
 * Lightweight log buffering for the main process.
 *
 * - Mirrors `console.*` output into a bounded buffer.
 * - Forwards new log entries to the renderer via `webContents.send('app-log', entry)`.
 */

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type AppLogEntry = {
  id: number
  ts: number
  level: AppLogLevel
  message: string
}

export type AppLogStore = {
  getLogs: () => AppLogEntry[]
  clearLogs: () => void
  push: (level: AppLogLevel, args: unknown[]) => void
  installConsoleMirror: () => void
}

const APP_LOG_BUFFER_LIMIT = 800

/**
 * Creates the log store.
 *
 * @param getMainWindow Provider for the current main window; used to forward logs.
 */
export function createAppLogStore(getMainWindow: () => BrowserWindow | null): AppLogStore {
  const buffer: AppLogEntry[] = []
  let seq = 0

  const push = (level: AppLogLevel, args: unknown[]): void => {
    const message = formatUtil(...(args as any[]))
    const entry: AppLogEntry = {
      id: (seq += 1),
      ts: Date.now(),
      level,
      message
    }

    buffer.push(entry)
    if (buffer.length > APP_LOG_BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - APP_LOG_BUFFER_LIMIT)
    }

    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('app-log', entry)
    }
  }

  const getLogs = () => buffer

  const clearLogs = () => {
    buffer.length = 0
  }

  /**
   * Installs a simple console mirror.
   *
   * This intentionally avoids throwing; logging should never crash the process.
   */
  const installConsoleMirror = (): void => {
    const original = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    }

    console.log = (...args: unknown[]) => {
      original.log(...args)
      push('info', args)
    }
    console.info = (...args: unknown[]) => {
      original.info(...args)
      push('info', args)
    }
    console.warn = (...args: unknown[]) => {
      original.warn(...args)
      push('warn', args)
    }
    console.error = (...args: unknown[]) => {
      original.error(...args)
      push('error', args)
    }
  }

  return { getLogs, clearLogs, push, installConsoleMirror }
}

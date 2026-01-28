/**
 * Utilities for command-line arguments and Windows shortcut naming.
 *
 * These functions are intentionally dependency-free so they can be used in
 * both main-process bootstrap and IPC handlers.
 */

/**
 * Sanitizes a string for use as a Windows filename.
 *
 * Used when generating `.lnk` files on the Desktop.
 */
export function sanitizeWindowsFileName(name: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim()
  return sanitized.length > 0 ? sanitized : 'shortcut'
}

/**
 * Parses a `--launch-client` argument from an argv list.
 *
 * Supported:
 * - `--launch-client=<id>`
 * - `--launch-client <id>`
 */
export function getLaunchClientArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--launch-client=')) {
      const value = arg.slice('--launch-client='.length).trim()
      if (value) return value
    }
    if (arg === '--launch-client') {
      const value = argv[i + 1]?.trim()
      if (value) return value
    }
  }
  return null
}

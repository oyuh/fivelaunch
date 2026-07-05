import fs from 'fs'
import path from 'path'
import { copyFileBestEffort } from './pluginsMirror'

/**
 * Merge files from `fromDir` into `toDir` without overwriting existing files.
 *
 * Used as a non-destructive migration step before switching a folder to junction mode.
 */
function mergeFolderContents(fromDir: string, toDir: string): void {
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
      mergeFolderContents(fromPath, toPath)
      continue
    }

    if (stat.isFile()) {
      if (fs.existsSync(toPath)) {
        continue
      }
      copyFileBestEffort(fromPath, toPath)
    }
  }
}

/**
 * Replace a real directory at `target` with a junction pointing at `source`.
 *
 * - Ensures `source` exists.
 * - If `target` is a directory, it is renamed aside first (to avoid data loss).
 * - If `target` is already a link, it is removed.
 */
export function linkFolder(
  source: string,
  target: string,
  renameWithRetrySync: (from: string, to: string) => void,
  options?: {
    migrateExisting?: boolean
  }
): void {
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
          mergeFolderContents(target, source)
        } catch {
          // ignore
        }
      }

      // It's a real directory. We need to back it up so we don't lose user's original data.
      const backupPath = `${target}_original`
      if (!fs.existsSync(backupPath)) {
        // Only rename if backup doesn't exist yet, to avoid overwriting previous backup
        try {
          renameWithRetrySync(target, backupPath)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code
          throw new Error(
            `Failed to back up existing folder (code=${code ?? 'unknown'}): ${target}. Close FiveM/any overlays and try again.`
          )
        }
      } else {
        console.warn(`Backup already exists at ${backupPath}. Renaming current to unique backup.`)
        try {
          renameWithRetrySync(target, `${target}_backup_${Date.now()}`)
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

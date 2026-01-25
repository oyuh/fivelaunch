import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import {
  getFiveMPath,
  getFiveMExecutable,
  getClientsDataPath,
  getGtaSettingsPath,
  getCitizenFxIniPath
} from '../utils/paths'
import type { LinkOptions } from '../types'

export class GameManager {

  public async launchClient(clientId: string, linkOptions: LinkOptions): Promise<boolean> {
    const fiveMPath = getFiveMPath() // .../FiveM.app
    const fiveMExe = getFiveMExecutable() // .../FiveM.exe
    const appsDataPath = getClientsDataPath()

    if (!fiveMPath || !fiveMExe) {
      throw new Error('FiveM installation not found.')
    }

    const clientPath = path.join(appsDataPath, clientId)
    if (!fs.existsSync(clientPath)) {
      throw new Error(`Client data for ID ${clientId} not found.`)
    }

    try {
      // 1. Link Mods
      if (linkOptions.mods) {
        this.linkFolder(path.join(clientPath, 'mods'), path.join(fiveMPath, 'mods'))
      }

      // 2. Link Plugins
      if (linkOptions.plugins) {
        this.linkFolder(path.join(clientPath, 'plugins'), path.join(fiveMPath, 'plugins'))
      }

      // 3. Link Citizen (Advanced) - BE CAREFUL
      // Only link if the client has specific citizen files, otherwise we might break the game if we link an empty folder.
      // Usually users want to replace specific files inside citizen/common/data etc.
      // Linking the whole 'citizen' folder requires a full copy of the game engine basically.
      // For now, I will implement it as requested but we might want to change this to partial linking later or overlay.
      // If the client folder is empty, maybe we shouldn't link it?
      // The user plan said: "linking the mods, plugins, citizens ... to the specified ones"
      // I will assume for now if the folder exists in client, we link it.
      // But if we link an empty folder, game won't start.
      // Better strategy: We don't link citizen by default unless specifically toggled or populated.
      // I will stick to mods/plugins for safety first, but include citizen logic commented or active.
      // Let's implement it active but check if not empty?
      // Actually, safest way is: Rename original -> citizen_original. Link new one.
      // If new one is missing essential files, game crashes. That's on the user to provide correct files.

      if (linkOptions.citizen) {
        this.linkFolder(path.join(clientPath, 'citizen'), path.join(fiveMPath, 'citizen'))
      }

      // 4. GTA Settings (AppData/Roaming/CitizenFX/gta5_settings.xml)
      if (linkOptions.gtaSettings) {
        const target = getGtaSettingsPath()
        const source = path.join(clientPath, 'settings', 'gta5_settings.xml')
        if (target) {
          this.linkFile(source, target)
        }
      }

      // 5. CitizenFX.ini (AppData/Roaming/CitizenFX/CitizenFX.ini)
      if (linkOptions.citizenFxIni) {
        const target = getCitizenFxIniPath()
        const source = path.join(clientPath, 'settings', 'CitizenFX.ini')
        if (target) {
          this.linkFile(source, target)
        }
      }

      console.log('Folders linked. Launching FiveM...')
      this.spawnProcess(fiveMExe)
      return true
    } catch (e) {
      console.error('Failed to launch:', e)
      throw e
    }
  }

  private linkFolder(source: string, target: string) {
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
        // It's a real directory. We need to back it up so we don't lose user's original data.
        const backupPath = `${target}_original`
        if (!fs.existsSync(backupPath)) {
            // Only rename if backup doesn't exist yet, to avoid overwriting previous backup
            fs.renameSync(target, backupPath)
        } else {
            // If backup exists, we assume current 'target' might be a stale folder or we can just move it to a temp name?
            // Or maybe the user manually fixed it.
            // Aggressive approach: If backup exists, assume 'target' is disposable or merge it?
            // Safer: Rename to _timestamp
            // fs.renameSync(target, `${target}_backup_${Date.now()}`)

            // For this implementation, let's assume if backup exists, we can remove the current folder as it shouldn't be there
            // if we are in "managed" mode. But since this is first run, let's be safe.
            // We will move it to _original (if we can), skipping if it exists is weird.
            // Let's just create unique backup.
            console.warn(`Backup already exists at ${backupPath}. Renaming current to unique backup.`)
            fs.renameSync(target, `${target}_backup_${Date.now()}`)
        }
      }
    }

    // Now target should be free. Create Symlink (Junction for Directories is safer on Windows without Admin)
    fs.symlinkSync(source, target, 'junction')
  }

  private linkFile(source: string, target: string) {
    // Ensure source exists
    if (!fs.existsSync(source)) {
      fs.writeFileSync(source, '')
    }

    // Backup existing target
    if (fs.existsSync(target)) {
      const backupPath = `${target}_original`
      if (!fs.existsSync(backupPath)) {
        fs.renameSync(target, backupPath)
      } else {
        fs.renameSync(target, `${target}_backup_${Date.now()}`)
      }
    }

    // Try hardlink first (no admin). Fallback to symlink.
    try {
      fs.linkSync(source, target)
    } catch {
      fs.symlinkSync(source, target, 'file')
    }
  }

  private spawnProcess(exePath: string) {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
    child.unref()
  }
}

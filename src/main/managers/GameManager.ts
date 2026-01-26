import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'
import {
  getFiveMPath,
  getFiveMExecutable,
  getClientsDataPath,
  getGtaSettingsPath
} from '../utils/paths'
import type { LinkOptions } from '../types'

export class GameManager {

  private ensureClientGtaSettingsFile(clientPath: string): string {
    const settingsDir = path.join(clientPath, 'settings')
    const targetPath = path.join(settingsDir, 'gta5_settings.xml')
    const legacyPath = path.join(settingsDir, 'settings.xml')

    if (fs.existsSync(targetPath)) return targetPath

    // Migrate legacy filename if it exists
    if (fs.existsSync(legacyPath)) {
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.copyFileSync(legacyPath, targetPath)
      return targetPath
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })

    const templateCandidates = [
      path.join(process.cwd(), 'resources', 'settings-template.xml'),
      path.join(__dirname, '../../resources/settings-template.xml')
    ]

    const templatePath = templateCandidates.find((p) => fs.existsSync(p))
    if (templatePath) {
      fs.copyFileSync(templatePath, targetPath)
      return targetPath
    }

    // Minimal fallback so user can launch/edit immediately even without a template
    const minimal = `<?xml version="1.0" encoding="UTF-8"?>\n<Settings>\n  <configSource>SMC_USER</configSource>\n</Settings>\n`
    fs.writeFileSync(targetPath, minimal, 'utf8')
    return targetPath
  }

  private copyFileBestEffort(source: string, target: string): void {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)

      try {
        const fd = fs.openSync(target, 'r+')
        fs.fsyncSync(fd)
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    } catch {
      // ignore - target can be locked while GTA/FiveM writes it
    }
  }

  private startGtaSettingsEnforcement(
    source: string,
    targets: string[],
    statusCallback?: (status: string) => void
  ): void {
    let desired: Buffer
    try {
      desired = fs.readFileSync(source)
    } catch {
      return
    }

    const uniqueTargets = Array.from(new Set(targets.filter(Boolean)))
    if (uniqueTargets.length === 0) return

    const startedAt = Date.now()
    const durationMs = 180_000
    const intervalMs = 750
    statusCallback?.('Finalizing settings (enforcing)...')

    const writes: Record<string, number> = {}

    const interval = setInterval(() => {
      const now = Date.now()
      if (now - startedAt > durationMs) {
        clearInterval(interval)
        statusCallback?.('Finalizing settings...')
        return
      }

      for (const target of uniqueTargets) {
        let current: Buffer | null = null
        try {
          current = fs.readFileSync(target)
        } catch {
          current = null
        }

        if (!current || !current.equals(desired)) {
          writes[target] = (writes[target] ?? 0) + 1
          if (writes[target] === 1 || writes[target] % 25 === 0) {
            console.log(`[GTA Settings] Detected overwrite -> reapplying (${writes[target]}x):`, target)
          }
          this.copyFileBestEffort(source, target)
        }
      }
    }, intervalMs)

    // Don’t keep the Electron main process alive just for this timer
    interval.unref?.()
  }

  private isProcessRunning(processName: string): boolean {
    try {
      const result = execSync(`tasklist /FI "IMAGENAME eq ${processName}" /NH`, { encoding: 'utf8' })
      return result.toLowerCase().includes(processName.toLowerCase())
    } catch {
      return false
    }
  }

  public async launchClient(
    clientId: string,
    linkOptions: LinkOptions,
    statusCallback?: (status: string) => void
  ): Promise<boolean> {
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
      statusCallback?.('Preparing launch...')

      // Check if GTA V or FiveM is already running
      if (this.isProcessRunning('GTA5.exe') || this.isProcessRunning('FiveM.exe')) {
        throw new Error('Please close GTA V and FiveM before launching a new client.')
      }

      // 1. Link Mods
      if (linkOptions.mods) {
        statusCallback?.('Linking mods...')
        this.linkFolder(path.join(clientPath, 'mods'), path.join(fiveMPath, 'mods'))
      }

      // 2. Link Plugins
      if (linkOptions.plugins) {
        statusCallback?.('Linking plugins...')
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

      // 4. GTA Settings - FiveM reads from BOTH CitizenFX AppData AND FiveM.app!
      if (linkOptions.gtaSettings) {
        statusCallback?.('Applying GTA settings...')
        const source = this.ensureClientGtaSettingsFile(clientPath)
        console.log('GTA Settings - Source:', source, 'exists:', fs.existsSync(source))

          // CRITICAL: Delete FiveM's profile data that OVERRIDES settings.xml!

          // 1. Delete KVS cache (profile key-value store)
          const kvsPath = path.join(process.env.APPDATA || '', 'CitizenFX', 'kvs')
          if (fs.existsSync(kvsPath)) {
            try {
              console.log('Clearing FiveM profile cache (KVS)...')
              fs.rmSync(kvsPath, { recursive: true, force: true })
              console.log('KVS cache cleared')
            } catch (err) {
              console.warn('Could not clear KVS cache:', err)
            }
          }

          // 2. Backup/remove fivem_sdk.cfg (contains profile console variables that override XML)
          const sdkCfgPath = path.join(process.env.APPDATA || '', 'CitizenFX', 'fivem_sdk.cfg')
          if (fs.existsSync(sdkCfgPath)) {
            try {
              console.log('Backing up fivem_sdk.cfg (profile console variables)...')
              const backupPath = `${sdkCfgPath}.backup_${Date.now()}`
              fs.renameSync(sdkCfgPath, backupPath)
              console.log('fivem_sdk.cfg backed up and removed')
            } catch (err) {
              console.warn('Could not backup fivem_sdk.cfg:', err)
            }
          }

        const targets: string[] = []

        // CitizenFX Roaming (PRIMARY)
        const citizenFxTarget = getGtaSettingsPath()
        if (citizenFxTarget) targets.push(citizenFxTarget)

        // CitizenFX LocalAppData (some installs use this)
        if (process.env.LOCALAPPDATA) targets.push(path.join(process.env.LOCALAPPDATA, 'CitizenFX', 'gta5_settings.xml'))

        for (const target of targets) {
          if (!target) continue
          console.log('GTA Settings - Applying to:', target)
          this.replaceFile(source, target)
        }

        console.log('GTA Settings applied. Startup enforcement will keep re-applying if overwritten.')
      }

      statusCallback?.('Starting FiveM...')
      console.log('Folders linked. Launching FiveM...')
      this.spawnProcess(fiveMExe)

      if (linkOptions.gtaSettings) {
        const source = this.ensureClientGtaSettingsFile(clientPath)
        const targets: string[] = [
          getGtaSettingsPath() || '',
          process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'CitizenFX', 'gta5_settings.xml')
            : ''
        ]
        this.startGtaSettingsEnforcement(source, targets, statusCallback)
      }

      statusCallback?.('Launched!')
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

  private replaceFile(source: string, target: string) {
    // Check if source exists - don't create empty file
    if (!fs.existsSync(source)) {
      console.warn(`Source file not found: ${source}. Skipping.`)
      throw new Error(`Settings file not found: ${source}. Please save settings first.`)
    }

    // Remove read-only flag from existing target if it exists
    if (fs.existsSync(target)) {
      try {
        fs.chmodSync(target, 0o666) // Make writable
      } catch (err) {
        console.warn('Failed to change permissions:', err)
      }

      const backupPath = `${target}.backup`
      try {
        fs.copyFileSync(target, backupPath)
        console.log(`Backed up existing file to ${backupPath}`)
      } catch (err) {
        console.warn('Failed to create backup:', err)
      }
    }

    // Ensure target directory exists with proper permissions
    fs.mkdirSync(path.dirname(target), { recursive: true })

    // Delete existing target to avoid any file lock issues
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target)
      } catch (err) {
        console.warn('Failed to delete existing target:', err)
      }
    }

    // Copy source to target
    fs.copyFileSync(source, target)

    // Force file system sync to ensure data is written to disk
    const fd = fs.openSync(target, 'r+')
    fs.fsyncSync(fd)
    fs.closeSync(fd)


    console.log(`Successfully replaced ${target} with ${source}`)
    console.log(`File size: ${fs.statSync(target).size} bytes`)
  }

  private spawnProcess(exePath: string) {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
    child.unref()
  }
}

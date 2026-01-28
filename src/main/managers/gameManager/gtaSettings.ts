import fs from 'fs'
import path from 'path'
import { copyFileBestEffort } from './pluginsMirror'
import { getFiveMAppSettingsPath, getGtaSettingsPath } from '../../utils/paths'

/**
 * Detects whether a file looks like GTA/FiveM settings XML.
 */
function looksLikeGtaSettingsXml(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size < 32) return false
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 2048)
    return head.includes('<Settings')
  } catch {
    return false
  }
}

/**
 * Ensures a per-client GTA settings file exists and returns its path.
 *
 * Prefers `gta5_settings.xml`, migrates legacy `settings.xml`, falls back to a template.
 */
export function ensureClientGtaSettingsFile(clientPath: string): string {
  const settingsDir = path.join(clientPath, 'settings')
  const targetPath = path.join(settingsDir, 'gta5_settings.xml')
  const legacyPath = path.join(settingsDir, 'settings.xml')

  // If the file exists but is an empty placeholder, treat it as missing.
  // (New clients used to be created with an empty settings.xml, which would get migrated and cause GTA/FiveM to regenerate defaults.)
  if (looksLikeGtaSettingsXml(targetPath)) return targetPath

  // Migrate legacy filename if it exists
  if (looksLikeGtaSettingsXml(legacyPath)) {
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

  // small fallback so user can launch/edit immediately even without a template
  const minimal = `<?xml version="1.0" encoding="UTF-8"?>\n<Settings>\n  <configSource>SMC_USER</configSource>\n</Settings>\n`
  fs.writeFileSync(targetPath, minimal, 'utf8')
  return targetPath
}

function getGtaSettingsTargets(): string[] {
  const targets: string[] = []

  // CitizenFX Roaming (PRIMARY)
  const citizenFxTarget = getGtaSettingsPath()
  if (citizenFxTarget) targets.push(citizenFxTarget)

  // FiveM.app settings.xml (some installs/flows still read/override from here)
  const fiveMAppSettings = getFiveMAppSettingsPath()
  if (fiveMAppSettings) targets.push(fiveMAppSettings)

  // CitizenFX LocalAppData (some installs use this)
  if (process.env.LOCALAPPDATA) {
    targets.push(path.join(process.env.LOCALAPPDATA, 'CitizenFX', 'gta5_settings.xml'))
  }

  return targets
}

function replaceFile(source: string, target: string): void {
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

export function applyGtaSettings(
  clientPath: string,
  statusCallback?: (status: string) => void
): { source: string; targets: string[] } {
  statusCallback?.('Applying GTA settings...')
  const source = ensureClientGtaSettingsFile(clientPath)
  console.log('GTA Settings - Source:', source, 'exists:', fs.existsSync(source))

  // NOTE: Temporarily disabled per request (testing whether KVS affects settings persistence).
  // CRITICAL: FiveM's profile data can OVERRIDE settings.xml.
  //
  // 1. Delete KVS cache (profile key-value store)
  // const kvsPath = path.join(process.env.APPDATA || '', 'CitizenFX', 'kvs')
  // if (fs.existsSync(kvsPath)) {
  //   try {
  //     console.log('Clearing FiveM profile cache (KVS)...')
  //     fs.rmSync(kvsPath, { recursive: true, force: true })
  //     console.log('KVS cache cleared')
  //   } catch (err) {
  //     console.warn('Could not clear KVS cache:', err)
  //   }
  // }

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

  const targets = getGtaSettingsTargets()

  for (const target of targets) {
    console.log('GTA Settings - Applying to:', target)
    replaceFile(source, target)
  }

  console.log('GTA Settings applied. Startup enforcement will keep re-applying if overwritten.')
  return { source, targets }
}

/**
 * While FiveM/GTA is launching, some profile writes may overwrite settings.
 * This loop re-applies the desired file for a short time window.
 */
export function startGtaSettingsEnforcement(source: string, targets: string[]): void {
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

  const writes: Record<string, number> = {}

  const interval = setInterval(() => {
    const now = Date.now()
    if (now - startedAt > durationMs) {
      clearInterval(interval)
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
        copyFileBestEffort(source, target)
      }
    }
  }, intervalMs)

  interval.unref?.()
}

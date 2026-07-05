import fs from 'fs'
import path from 'path'
import { getCitizenFxIniPath } from '../../utils/paths'

/**
 * ReShade sync/discovery for a given FiveM + client pairing.
 *
 * ReShade installs vary wildly (files next to exe, inside plugins, per-exe INIs, etc.).
 * This module uses conservative heuristics to:
 * - discover likely ReShade config/preset/log files
 * - log diagnostics to the per-client ReShade folder
 * - set up two-way syncing so presets/config changes persist
 */
export type ReshadeSyncDeps = {
  /** Absolute path to FiveM.exe (used to seed common lookup roots). */
  fiveMExe: string
  /** FiveM.app folder path. */
  fiveMPath: string
  /** Per-client root path. */
  clientPath: string
  statusCallback?: (status: string) => void

  /** Process liveness check for deciding whether to keep syncing/monitoring. */
  isProcessRunning: (processName: string) => boolean

  /** Start a lightweight two-way sync between a client-owned shadow file and the real file. */
  seedAndStartTwoWaySync: (clientFile: string, gameFile: string, shouldContinue?: () => boolean) => void

  /** Start monitoring a file for changes and emit snapshot logs (diagnostics only). */
  startReShadeFileMonitor: (
    reshadeClientDir: string,
    filePath: string,
    label: string,
    shouldContinue: () => boolean
  ) => void

  fnv1a32Hex: (input: string) => string
  reshadeLog: (reshadeClientDir: string, message: string, statusCallback?: (status: string) => void) => void
}

const RESHADE_INI_SUMMARY_KEYS = [
  'currentpresetpath',
  'presetpath',
  'presetfiles',
  'effectsearchpaths',
  'texturesearchpaths',
  'performancemode'
]

const parseIniKeyValues = (iniText: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const lines = iniText.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim().toLowerCase()
    let value = trimmed.slice(eq + 1).trim()
    value = value.replace(/^"|"$/g, '')
    if (!key) continue
    out[key] = value
  }
  return out
}

const pickIniSummary = (iniPath: string): Record<string, string> => {
  try {
    if (!fs.existsSync(iniPath)) return {}
    const text = fs.readFileSync(iniPath, 'utf8')
    const kv = parseIniKeyValues(text)

    const out: Record<string, string> = {}
    for (const key of RESHADE_INI_SUMMARY_KEYS) {
      if (kv[key] !== undefined) out[key] = kv[key]
    }
    return out
  } catch {
    return {}
  }
}

const canOpenReadWrite = (filePath: string): { ok: boolean; error?: string } => {
  try {
    const fd = fs.openSync(filePath, 'r+')
    fs.closeSync(fd)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

const extractPresetRelatedLines = (iniPath: string, maxLines = 60): string[] => {
  try {
    if (!fs.existsSync(iniPath)) return []
    const text = fs.readFileSync(iniPath, 'utf8')
    const lines = text.split(/\r?\n/)
    return lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(';') && !l.startsWith('#'))
      .filter((l) => l.toLowerCase().includes('preset'))
      .slice(0, maxLines)
  } catch {
    return []
  }
}

const hashFileQuick = (filePath: string, maxBytes = 256 * 1024): string => {
  try {
    const st = fs.statSync(filePath)
    if (!st.isFile() || st.size <= 0) return ''
    const bytesToRead = Math.min(st.size, maxBytes)
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(bytesToRead)
      fs.readSync(fd, buf, 0, bytesToRead, 0)
      // FNV-1a 32-bit
      let hash = 0x811c9dc5
      for (let i = 0; i < buf.length; i++) {
        hash ^= buf[i]
        hash = (hash * 0x01000193) >>> 0
      }
      return hash.toString(16).padStart(8, '0')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

const extractPresetFileKeyLines = (presetPath: string, maxLines = 40): string[] => {
  try {
    if (!fs.existsSync(presetPath)) return []
    const text = fs.readFileSync(presetPath, 'utf8')
    const lines = text.split(/\r?\n/)
    const interesting = lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(';') && !l.startsWith('#'))
      .filter((l) => {
        const lower = l.toLowerCase()
        return (
          lower.startsWith('techniques=') ||
          lower.startsWith('techniquesorting=') ||
          lower.startsWith('preprocessordefinitions=')
        )
      })
      .slice(0, maxLines)

    // If nothing obvious, at least show the first few non-comment lines (helps spot which file is loaded)
    if (interesting.length > 0) return interesting
    return lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(';') && !l.startsWith('#'))
      .slice(0, Math.min(12, maxLines))
  } catch {
    return []
  }
}

const looksLikeReShadePresetFile = (filePath: string): boolean => {
  try {
    if (!fs.existsSync(filePath)) return false
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size < 32) return false
    const text = fs.readFileSync(filePath, 'utf8').slice(0, 128 * 1024).toLowerCase()
    // Matches ReShade's own validity heuristic (see resolve_preset_path in upstream): preset usually has 'Techniques'.
    return text.includes('techniques=')
  } catch {
    return false
  }
}

const readFileTailUtf8 = (filePath: string, maxBytes = 64 * 1024): string => {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size <= 0) return ''

    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(stat.size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

const extractWindowsFilePaths = (text: string): string[] => {
  // Best-effort path extraction from logs.
  // Example: C:\Games\GTAV\ReShade.ini
  const matches = text.match(/[A-Za-z]:\\[^\r\n"']+?\.(?:ini|log)/g) ?? []
  const cleaned = matches
    .map((m) => m.trim())
    .map((m) => m.replace(/[\]\)\}\>,;]+$/g, ''))
  return Array.from(new Set(cleaned))
}

const parseReShadeIniPresetPaths = (iniText: string): string[] => {
  const results: string[] = []
  const lines = iniText.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue

    const key = trimmed.slice(0, eq).trim().toLowerCase()
    let value = trimmed.slice(eq + 1).trim()
    value = value.replace(/^"|"$/g, '')

    if (!value) continue
    if (key === 'presetpath' || key === 'currentpresetpath') {
      results.push(value)
    }
  }

  return Array.from(new Set(results))
}

const resolveMaybeRelativePath = (baseDir: string, iniDir: string, value: string): string => {
  const normalized = value.replace(/\//g, path.sep)
  if (path.isAbsolute(normalized)) return normalized

  // ReShade commonly uses relative paths; try ini directory first, then exe base dir.
  const fromIni = path.resolve(iniDir, normalized)
  if (fs.existsSync(fromIni)) return fromIni
  return path.resolve(baseDir, normalized)
}

const findFilesByName = (rootDir: string, fileNameLower: string, maxDepth: number): string[] => {
  const results: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (entry.isFile() && entry.name.toLowerCase() === fileNameLower) {
        results.push(full)
      }
    }
  }

  walk(rootDir, 0)
  return results
}

const findIniFiles = (rootDir: string, maxDepth: number): string[] => {
  const results: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.toLowerCase().endsWith('.ini')) {
        results.push(full)
      }
    }
  }

  walk(rootDir, 0)
  return results
}

const looksLikeReShadeConfigIni = (filePath: string): boolean => {
  try {
    if (!fs.existsSync(filePath)) return false
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size < 16) return false
    // Read a small chunk to avoid slurping huge files.
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 32_768).toLowerCase()
    if (!head.includes('presetpath') && !head.includes('currentpresetpath') && !head.includes('performancemode')) {
      // Some configs still have a [GENERAL] section but no preset path yet.
      if (!head.includes('[general]')) return false
    }
    // Avoid false positives from random INIs.
    return head.includes('reshade') || head.includes('presetpath') || head.includes('performancemode')
  } catch {
    return false
  }
}

const getGtaInstallDirCandidates = (): string[] => {
  const results: string[] = []

  // 1) Try CitizenFX.ini (often contains a game path for GTA V)
  const cfxIni = getCitizenFxIniPath()
  if (cfxIni && fs.existsSync(cfxIni)) {
    try {
      const text = fs.readFileSync(cfxIni, 'utf8')
      const kv = parseIniKeyValues(text)
      const candidateValues = Object.values(kv)
      for (const value of candidateValues) {
        if (!value) continue
        const normalized = value.replace(/\//g, path.sep)

        // Some configs store the exe path, some store the directory.
        const maybeExe = normalized.toLowerCase().endsWith('gta5.exe')
          ? normalized
          : path.join(normalized, 'GTA5.exe')

        if (fs.existsSync(maybeExe)) {
          results.push(path.dirname(maybeExe))
        }
      }
    } catch {
      // ignore
    }
  }

  // 2) Common install locations (Steam/Rockstar/Epic)
  const pf = process.env.ProgramFiles
  const pfx86 = process.env['ProgramFiles(x86)']

  const commonRoots = [
    pf ? path.join(pf, 'Rockstar Games', 'Grand Theft Auto V') : '',
    pf ? path.join(pf, 'Epic Games', 'GTAV') : '',
    pfx86 ? path.join(pfx86, 'Steam', 'steamapps', 'common', 'Grand Theft Auto V') : '',
    'C:\\Games\\Grand Theft Auto V',
    'C:\\Games\\GTAV',
    'D:\\Games\\Grand Theft Auto V',
    'D:\\Games\\GTAV'
  ].filter(Boolean)

  for (const dir of commonRoots) {
    try {
      if (fs.existsSync(path.join(dir, 'GTA5.exe'))) results.push(dir)
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(results))
}

/**
 * Discover and sync ReShade configuration/preset/log files.
 *
 * High-level flow:
 * - discover candidate `ReShade.ini` / `ReShadePreset.ini` / `ReShade.log` locations
 * - use log hints to resolve the actual config/preset paths when possible
 * - start two-way syncing between client-owned shadow copies and the real files
 * - start file monitors for diagnostics (readability + debugging)
 */
export async function runReshadeSync(deps: ReshadeSyncDeps): Promise<void> {
  const { fiveMExe, fiveMPath, clientPath, statusCallback } = deps

  // Optional: Sync common ReShade config/preset files that live next to FiveM.exe.
  // Many ReShade installs write presets/config beside the executable instead of inside plugins.
  // This keeps client storage and the real install in sync while the app is open.
  try {
    const baseDir = path.dirname(fiveMExe)
    const reshadeClientDir = path.join(clientPath, 'settings', 'reshade')

    const pluginsDir = path.join(fiveMPath, 'plugins')
    const appData = process.env.APPDATA
    const localAppData = process.env.LOCALAPPDATA

    fs.mkdirSync(reshadeClientDir, { recursive: true })
    deps.reshadeLog(reshadeClientDir, `Scan start: baseDir=${baseDir}; fiveMPath=${fiveMPath}; pluginsDir=${pluginsDir}`, statusCallback)

    const gtaDirs = getGtaInstallDirCandidates()
    const commonReShadeDirs = [
      baseDir,
      fiveMPath,
      pluginsDir,
      ...gtaDirs,
      appData ? path.join(appData, 'ReShade') : '',
      localAppData ? path.join(localAppData, 'ReShade') : ''
    ].filter(Boolean)

    const discoveredIniPaths = new Set<string>()
    const discoveredPresetIniPaths = new Set<string>()
    const discoveredLogPaths = new Set<string>()

    for (const dir of commonReShadeDirs) {
      // Quick direct checks
      const iniDirect = path.join(dir, 'ReShade.ini')
      const presetDirect = path.join(dir, 'ReShadePreset.ini')
      const logDirect = path.join(dir, 'ReShade.log')
      if (fs.existsSync(iniDirect)) discoveredIniPaths.add(iniDirect)
      if (fs.existsSync(presetDirect)) discoveredPresetIniPaths.add(presetDirect)
      if (fs.existsSync(logDirect)) discoveredLogPaths.add(logDirect)

      // Shallow discovery (covers cases like plugins/reshade/..)
      for (const found of findFilesByName(dir, 'reshade.ini', 3)) discoveredIniPaths.add(found)
      for (const found of findFilesByName(dir, 'reshadepreset.ini', 3)) discoveredPresetIniPaths.add(found)
      for (const found of findFilesByName(dir, 'reshade.log', 3)) discoveredLogPaths.add(found)

      // Heuristic discovery: some installs use per-exe config names.
      // Scan INIs shallowly and pick the ones that look like ReShade configs.
      for (const iniPath of findIniFiles(dir, 3)) {
        if (iniPath.toLowerCase().endsWith('reshadepreset.ini')) continue
        if (iniPath.toLowerCase().endsWith('reshade.ini')) continue
        if (looksLikeReShadeConfigIni(iniPath)) {
          discoveredIniPaths.add(iniPath)
        }
      }
    }

    // Always dump a short list of "ReShade-ish" candidates inside plugins, even if discovery misses.
    try {
      const candidates = findIniFiles(pluginsDir, 5)
        .filter((p) => p.toLowerCase().includes('reshade') || looksLikeReShadeConfigIni(p))
        .slice(0, 25)

      if (candidates.length > 0) {
        deps.reshadeLog(reshadeClientDir, `Plugins candidate INIs (${candidates.length} shown): ${candidates.join(' | ')}`)

        const likelyPresets = candidates
          .filter((p) => p.toLowerCase().includes(`${path.sep}presets${path.sep}`))
          .map((p) => ({ file: p, isPreset: looksLikeReShadePresetFile(p) }))
          .slice(0, 12)
        if (likelyPresets.length > 0) {
          deps.reshadeLog(
            reshadeClientDir,
            `Plugins preset candidates: ${likelyPresets
              .map((x) => `${x.isPreset ? 'OK' : 'NOT_A_PRESET'}:${path.basename(x.file)}`)
              .join(' | ')}`
          )
        }
      } else {
        deps.reshadeLog(reshadeClientDir, 'Plugins candidate INIs: none found (by name/content heuristic).')
      }
    } catch {
      // ignore
    }

    const keepSyncingWhileGameRuns = () => deps.isProcessRunning('FiveM.exe') || deps.isProcessRunning('GTA5.exe')

    // Use ReShade.log to discover which config/preset paths are actually being used.
    for (const logPath of discoveredLogPaths) {
      const tail = readFileTailUtf8(logPath, 96 * 1024)
      if (!tail) continue
      const extracted = extractWindowsFilePaths(tail)
      if (extracted.length === 0) continue

      deps.reshadeLog(
        reshadeClientDir,
        `Log hints from ${logPath}: ${extracted.slice(0, 6).join(' | ')}${extracted.length > 6 ? ' | ...' : ''}`
      )

      for (const p of extracted) {
        try {
          if (!fs.existsSync(p)) continue
          const lower = p.toLowerCase()
          if (lower.endsWith('reshadepreset.ini')) {
            discoveredPresetIniPaths.add(p)
            continue
          }
          if (lower.endsWith('reshade.ini')) {
            discoveredIniPaths.add(p)
            continue
          }
          if (lower.endsWith('.ini') && looksLikeReShadeConfigIni(p)) {
            discoveredIniPaths.add(p)
          }
        } catch {
          // ignore
        }
      }
    }

    statusCallback?.(`ReShade: found ${discoveredIniPaths.size} config file(s)`)
    statusCallback?.(`ReShade: found ${discoveredPresetIniPaths.size} preset-ini file(s)`)
    if (discoveredLogPaths.size > 0) statusCallback?.(`ReShade: found ${discoveredLogPaths.size} log file(s)`)

    const pluginReshadeIni: string[] = []
    const pluginReshadePresetIni: string[] = []
    try {
      const directConfig = path.join(pluginsDir, 'ReShade.ini')
      const directPresetIni = path.join(pluginsDir, 'ReShadePreset.ini')
      if (fs.existsSync(directConfig)) pluginReshadeIni.push(directConfig)
      if (fs.existsSync(directPresetIni)) pluginReshadePresetIni.push(directPresetIni)
      for (const found of findFilesByName(pluginsDir, 'reshade.ini', 3)) pluginReshadeIni.push(found)
      for (const found of findFilesByName(pluginsDir, 'reshadepreset.ini', 3)) pluginReshadePresetIni.push(found)
    } catch {
      // ignore
    }

    // Always dump a quick snapshot of any ReShade.ini inside plugins (your reported setup).
    try {
      for (const p of pluginReshadeIni) {
        const summary = pickIniSummary(p)
        const rw = canOpenReadWrite(p)
        const presetLines = extractPresetRelatedLines(p, 25)
        deps.reshadeLog(
          reshadeClientDir,
          `Plugins config snapshot: ${p} rw=${rw.ok ? 'ok' : `FAIL:${rw.error ?? ''}`} -> ${JSON.stringify(summary)} presetLines=${JSON.stringify(presetLines)}`
        )
      }
      for (const p of pluginReshadePresetIni) {
        const summary = pickIniSummary(p)
        const rw = canOpenReadWrite(p)
        const presetLines = extractPresetRelatedLines(p, 25)
        deps.reshadeLog(
          reshadeClientDir,
          `Plugins preset-ini snapshot: ${p} rw=${rw.ok ? 'ok' : `FAIL:${rw.error ?? ''}`} -> ${JSON.stringify(summary)} presetLines=${JSON.stringify(presetLines)}`
        )
      }
    } catch {
      // ignore
    }

    // Write a small debug file per-client so we can see what paths were detected even if the UI status gets overwritten.
    try {
      const debug = {
        at: new Date().toISOString(),
        fiveMExe,
        fiveMPath,
        pluginsDir,
        gtaDirs,
        configs: Array.from(discoveredIniPaths),
        presetInis: Array.from(discoveredPresetIniPaths),
        logs: Array.from(discoveredLogPaths)
      }
      fs.writeFileSync(path.join(reshadeClientDir, 'last-scan.json'), JSON.stringify(debug, null, 2), 'utf8')
    } catch {
      // ignore
    }

    // Sync all discovered ini locations to the client store (newest wins).
    for (const iniPath of discoveredIniPaths) {
      if (iniPath.toLowerCase().startsWith(pluginsDir.toLowerCase() + path.sep)) {
        deps.reshadeLog(reshadeClientDir, `Using plugins-linked config (no extra sync): ${iniPath}`)
        continue
      }

      const id = deps.fnv1a32Hex(path.resolve(iniPath).toLowerCase())
      const clientTarget = path.join(reshadeClientDir, 'sources', id, path.basename(iniPath))
      deps.seedAndStartTwoWaySync(clientTarget, iniPath, keepSyncingWhileGameRuns)

      const summary = pickIniSummary(iniPath)
      if (Object.keys(summary).length > 0) {
        deps.reshadeLog(reshadeClientDir, `Config summary: ${iniPath} -> ${JSON.stringify(summary)}`)
      }
    }

    for (const presetIniPath of discoveredPresetIniPaths) {
      if (presetIniPath.toLowerCase().startsWith(pluginsDir.toLowerCase() + path.sep)) {
        deps.reshadeLog(reshadeClientDir, `Using plugins-linked preset-ini (no extra sync): ${presetIniPath}`)
        continue
      }

      const id = deps.fnv1a32Hex(path.resolve(presetIniPath).toLowerCase())
      const clientTarget = path.join(reshadeClientDir, 'sources', id, path.basename(presetIniPath))
      deps.seedAndStartTwoWaySync(clientTarget, presetIniPath, keepSyncingWhileGameRuns)

      const summary = pickIniSummary(presetIniPath)
      if (Object.keys(summary).length > 0) {
        deps.reshadeLog(reshadeClientDir, `Preset-ini summary: ${presetIniPath} -> ${JSON.stringify(summary)}`)
      }
    }

    // Periodically snapshot active keys while the game is running.
    try {
      let everRunning = false
      const interval = setInterval(() => {
        const running = keepSyncingWhileGameRuns()
        if (running) everRunning = true
        if (!running && everRunning) {
          clearInterval(interval)
          deps.reshadeLog(reshadeClientDir, 'Game closed: final ReShade snapshot complete.')
          return
        }
        if (!running) return

        const candidates = Array.from(discoveredIniPaths).slice(0, 4)
        for (const c of candidates) {
          const summary = pickIniSummary(c)
          if (Object.keys(summary).length > 0) {
            deps.reshadeLog(reshadeClientDir, `Live snapshot: ${c} -> ${JSON.stringify(summary)}`)
          }
        }
      }, 15_000)
      interval.unref?.()
    } catch {
      // ignore
    }

    // Live monitor the plugins-linked ReShade INI files.
    try {
      const maybeConfig = path.join(pluginsDir, 'ReShade.ini')
      const maybePresetIni = path.join(pluginsDir, 'ReShadePreset.ini')
      deps.startReShadeFileMonitor(reshadeClientDir, maybeConfig, 'plugins/ReShade.ini', keepSyncingWhileGameRuns)
      deps.startReShadeFileMonitor(reshadeClientDir, maybePresetIni, 'plugins/ReShadePreset.ini', keepSyncingWhileGameRuns)
    } catch {
      // ignore
    }

    // Also attempt to sync the currently-selected preset file if the config points outside plugins.
    const configPathForPresetDiscovery = (() => {
      const pluginsConfig = path.join(pluginsDir, 'ReShade.ini')
      if (fs.existsSync(pluginsConfig)) return pluginsConfig
      const firstDiscovered = Array.from(discoveredIniPaths)[0]
      if (firstDiscovered && fs.existsSync(firstDiscovered)) return firstDiscovered
      return ''
    })()

    if (configPathForPresetDiscovery) {
      let iniText = ''
      try {
        iniText = fs.readFileSync(configPathForPresetDiscovery, 'utf8')
      } catch {
        iniText = ''
      }

      const baseIniDir = path.dirname(configPathForPresetDiscovery)
      const presetValues = parseReShadeIniPresetPaths(iniText)
      if (presetValues.length > 0) {
        deps.reshadeLog(reshadeClientDir, `Preset discovery: from=${configPathForPresetDiscovery} -> ${presetValues.join(' | ')}`)
      }

      for (const presetValue of presetValues) {
        const presetAbs = resolveMaybeRelativePath(baseDir, baseIniDir, presetValue)

        deps.reshadeLog(
          reshadeClientDir,
          `Preset resolved: value=${presetValue} -> abs=${presetAbs} exists=${fs.existsSync(presetAbs) ? 'yes' : 'no'} presetFile=${looksLikeReShadePresetFile(presetAbs) ? 'yes' : 'no'}`
        )

        if (fs.existsSync(presetAbs)) {
          deps.startReShadeFileMonitor(
            reshadeClientDir,
            presetAbs,
            `preset:${path.basename(presetAbs)}`,
            keepSyncingWhileGameRuns
          )
        } else {
          deps.reshadeLog(reshadeClientDir, `Preset path does not exist yet: ${presetAbs}`)
        }

        if (presetAbs.toLowerCase().startsWith(pluginsDir.toLowerCase() + path.sep)) {
          continue
        }

        const id = deps.fnv1a32Hex(path.resolve(presetAbs).toLowerCase())
        const clientPresetPath = path.join(reshadeClientDir, 'sources', id, 'presets', path.basename(presetAbs))
        deps.seedAndStartTwoWaySync(clientPresetPath, presetAbs, keepSyncingWhileGameRuns)
      }
    } else {
      deps.reshadeLog(reshadeClientDir, 'Preset discovery: no readable config path found to parse PresetPath.')
    }
  } catch {
    // ignore
  }
}

/**
 * Extracts Windows-style absolute file path hints from ReShade log text.
 */
export function getReshadeLogFileHints(text: string): string[] {
  return extractWindowsFilePaths(text)
}

/**
 * Snapshot a file with low-cost diagnostics used by file monitors/logging.
 *
 * This is best-effort: all fields are populated even if the file is missing.
 */
export function getReshadeFileSnapshot(filePath: string): {
  statSig: string
  quickHash: string
  canReadWrite: { ok: boolean; error?: string }
  iniSummary: Record<string, string>
  presetLines: string[]
  presetKeyLines: string[]
} {
  let statSig = ''
  try {
    const st = fs.statSync(filePath)
    statSig = `${st.size}:${st.mtimeMs}`
  } catch {
    statSig = 'missing'
  }

  const canReadWrite = canOpenReadWrite(filePath)
  const quickHash = hashFileQuick(filePath)
  const iniSummary = pickIniSummary(filePath)
  const presetLines = extractPresetRelatedLines(filePath, 25)
  const presetKeyLines = extractPresetFileKeyLines(filePath, 20)

  return { statSig, quickHash, canReadWrite, iniSummary, presetLines, presetKeyLines }
}

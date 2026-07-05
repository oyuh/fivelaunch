/**
 * Main-process asset helpers.
 *
 * These helpers centralize how we resolve resources in dev vs packaged builds.
 */

import { join, resolve } from 'path'
import { nativeImage, type NativeImage } from 'electron'
import fs from 'fs'
import { is } from '@electron-toolkit/utils'

/**
 * Returns the app icon path, taking dev vs packaged paths into account.
 */
export function getAppIconPath(): string {
  return is.dev
    ? resolve(process.cwd(), 'resources', 'Logo-Windows.ico')
    : join(process.resourcesPath, 'resources', 'Logo-Windows.ico')
}

/**
 * Returns a base64 `data:` URL for the splash logo, or null if unavailable.
 */
export function getSplashLogoDataUrl(): string | null {
  const logoPath = is.dev
    ? resolve(process.cwd(), 'resources', 'Logo.png')
    : join(process.resourcesPath, 'resources', 'Logo.png')

  try {
    if (!fs.existsSync(logoPath)) return null
    const buf = fs.readFileSync(logoPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Creates a tray icon input that works around Windows quirks.
 *
 * If `nativeImage.createFromPath` fails (empty image), fall back to the raw path.
 */
export function createTrayImage(iconPath: string): string | NativeImage {
  const img = nativeImage.createFromPath(iconPath)
  return img.isEmpty() ? iconPath : img
}

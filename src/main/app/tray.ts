import { app, Menu, Tray } from 'electron'
import type { BrowserWindow } from 'electron'
import { createTrayImage } from './assets'

/**
 * System tray integration.
 *
 * FiveLaunch only uses tray behavior when the user enables minimize-to-tray
 * (mostly during game launch).
 */

export type TrayController = {
  /** Ensures the tray icon/menu exists and returns it. */
  ensureTray: () => Tray

  /** Hides the main window and removes it from the taskbar. */
  minimizeToTray: () => void

  /** Shows the main window and restores it to the taskbar. */
  restoreFromTray: () => void
}

/**
 * Creates a controller for tray operations.
 */
export function createTrayController(opts: {
  getMainWindow: () => BrowserWindow | null
  setIsQuitting: (value: boolean) => void
  getIconPath: () => string
}): TrayController {
  let trayRef: Tray | null = null

  const ensureTray = (): Tray => {
    if (trayRef) return trayRef

    const iconPath = opts.getIconPath()
    const tray = new Tray(createTrayImage(iconPath))

    tray.setToolTip('FiveLaunch')

    tray.on('click', () => {
      const win = opts.getMainWindow()
      if (!win || win.isDestroyed()) return
      win.setSkipTaskbar(false)
      win.show()
      win.focus()
    })

    const menu = Menu.buildFromTemplate([
      {
        label: 'Show FiveLaunch',
        click: () => {
          const win = opts.getMainWindow()
          if (!win || win.isDestroyed()) return
          win.setSkipTaskbar(false)
          win.show()
          win.focus()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          opts.setIsQuitting(true)
          app.quit()
        }
      }
    ])
    tray.setContextMenu(menu)

    trayRef = tray
    return tray
  }

  const minimizeToTray = (): void => {
    ensureTray()
    const win = opts.getMainWindow()
    if (!win || win.isDestroyed()) return
    win.hide()
    win.setSkipTaskbar(true)
  }

  const restoreFromTray = (): void => {
    const win = opts.getMainWindow()
    if (!win || win.isDestroyed()) return
    win.setSkipTaskbar(false)
    win.show()
    win.focus()
  }

  return { ensureTray, minimizeToTray, restoreFromTray }
}

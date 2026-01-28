import { BrowserWindow, shell } from 'electron'
import type { SettingsManager } from '../managers/SettingsManager'

/**
 * Main window + splash window creation.
 *
 * This module owns:
 * - Splash HTML window
 * - Main BrowserWindow creation and event wiring
 * - Loading renderer URL (dev) or packaged index.html (prod)
 */

export type CreateMainWindowDeps = {
  getAppIconPath: () => string
  getSplashLogoDataUrl: () => string | null

  rendererUrl?: string
  preloadPath: string
  rendererIndexHtmlPath: string

  getSettingsManager: () => Promise<SettingsManager>
  ensureTray: () => void

  setMainWindowRef: (win: BrowserWindow | null) => void
  setSplashWindowRef: (win: BrowserWindow | null) => void

  getIsQuitting: () => boolean
}

/**
 * Creates the splash + main window.
 *
 * NOTE: This function does not register IPC handlers.
 */
export function createMainWindow(deps: CreateMainWindowDeps): BrowserWindow {
  const appIcon = deps.getAppIconPath()
  const splashLogo = deps.getSplashLogoDataUrl()

  const splashWindow = new BrowserWindow({
    width: 420,
    height: 240,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: true,
    icon: appIcon,
    webPreferences: {
      sandbox: false
    }
  })

  deps.setSplashWindowRef(splashWindow)

  const splashHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Starting…</title>
        <style>
          :root { color-scheme: dark; }
          * { box-sizing: border-box; }
          html, body {
            height: 100%;
            margin: 0;
            overflow: hidden;
            background: transparent;
            font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
            -webkit-font-smoothing: antialiased;
            user-select: none;
          }
          .card {
            height: 100%;
            display: grid;
            place-items: center;
            padding: 18px;
          }
          .panel {
            width: 100%;
            height: 100%;
            background: rgba(12, 12, 16, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 16px;
            box-shadow: 0 20px 80px rgba(0,0,0,0.45);
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 14px;
            padding: 22px;
            position: relative;
            -webkit-app-region: drag;
          }
          .logo {
            width: 86px;
            height: 86px;
            border-radius: 18px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.10);
            display: grid;
            place-items: center;
            overflow: hidden;
            box-shadow: 0 14px 40px rgba(0,0,0,0.35);
          }
          .logo img {
            width: 72px;
            height: 72px;
            object-fit: contain;
            filter: drop-shadow(0 10px 18px rgba(0,0,0,0.35));
          }
          .brandTitle {
            margin-top: 2px;
            font-size: 16px;
            font-weight: 800;
            color: rgba(255,255,255,0.92);
            letter-spacing: 0.2px;
            text-align: center;
          }
          .statusBox {
            width: 100%;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.10);
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .statusLabel {
            font-size: 12px;
            color: rgba(255,255,255,0.72);
            white-space: nowrap;
          }
          .statusText {
            font-size: 12px;
            color: rgba(255,255,255,0.58);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
          }
          .spinner {
            width: 16px;
            height: 16px;
            border-radius: 999px;
            border: 2px solid rgba(255,255,255,0.18);
            border-top-color: rgba(99, 102, 241, 0.95);
            animation: spin 0.9s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="panel">
            <div style="display:flex; flex-direction:column; align-items:center; gap: 12px;">
              <div class="logo">
                ${splashLogo ? `<img src="${splashLogo}" alt="FiveLaunch" />` : `<div style="font-weight:800;color:rgba(255,255,255,0.85);">FL</div>`}
              </div>
              <div class="brandTitle">FiveLaunch</div>
            </div>

            <div class="statusBox" style="margin-top: 2px;">
              <div class="spinner" aria-label="Loading"></div>
              <div class="statusLabel">Status</div>
              <div id="status" class="statusText">Starting…</div>
            </div>
          </div>
        </div>

        <script>
          (function () {
            var el = document.getElementById('status');
            var messages = [
              'Starting…',
              'Loading renderer…',
              'Warming up…',
              'Almost there…'
            ];
            var i = 0;
            window.__setStatus = function (text) {
              if (!el) return;
              el.textContent = String(text || '');
            };
            setInterval(function () {
              if (!el) return;
              if (el.textContent && el.textContent !== 'Starting…') return;
              i = (i + 1) % messages.length;
              el.textContent = messages[i];
            }, 750);
          })();
        </script>
      </body>
    </html>
  `

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`)

  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: appIcon,
    webPreferences: {
      preload: deps.preloadPath,
      sandbox: false
    }
  })

  deps.setMainWindowRef(mainWindow)

  // If the user minimizes the window via OS controls/taskbar, optionally route it to tray.
  mainWindow.on('minimize', (event) => {
    void (async () => {
      try {
        const settings = (await deps.getSettingsManager()).getSettings()
        if (!settings.minimizeToTrayOnGameLaunch) return

        ;(event as any)?.preventDefault?.()
        deps.ensureTray()
        mainWindow.hide()
        mainWindow.setSkipTaskbar(true)
      } catch {
        // ignore
      }
    })()
  })

  const showMainAndCloseSplash = () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
    deps.setSplashWindowRef(null)
  }

  mainWindow.webContents.once('did-finish-load', showMainAndCloseSplash)
  mainWindow.once('ready-to-show', showMainAndCloseSplash)

  const splashFallback = setTimeout(showMainAndCloseSplash, 3500)
  splashFallback.unref?.()

  mainWindow.on('closed', () => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  })

  mainWindow.on('close', () => {
    if (deps.getIsQuitting()) return
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (deps.rendererUrl) {
    mainWindow.loadURL(deps.rendererUrl)
  } else {
    mainWindow.loadFile(deps.rendererIndexHtmlPath)
  }

  return mainWindow
}

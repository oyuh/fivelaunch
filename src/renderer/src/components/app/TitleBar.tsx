import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { FolderOpen, Minus, Save, Settings as SettingsIcon, Square, X } from 'lucide-react'
import { hexToHsl, hslToHex, isHexColor, type Hsl } from '@/lib/theme'

export type TitleBarProps = {
  logoSrc: string

  appVersion?: string

  primaryHex: string
  onPrimaryHexChange: (hex: string) => void
  onResetPrimaryHex: () => void

  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void

  gamePath: string
  onGamePathChange: (value: string) => void

  minimizeToTrayOnGameLaunch: boolean
  onMinimizeToTrayOnGameLaunchChange: (enabled: boolean) => void

  onBrowseGamePath: () => void
  onSaveGamePath: () => void

  onWindowMinimize: () => void
  onWindowToggleMaximize: () => void
  onWindowClose: () => void
}

export function TitleBar(props: TitleBarProps): JSX.Element {
  const {
    logoSrc,
    appVersion,
    primaryHex,
    onPrimaryHexChange,
    onResetPrimaryHex,
    settingsOpen,
    onSettingsOpenChange,
    gamePath,
    onGamePathChange,
    minimizeToTrayOnGameLaunch,
    onMinimizeToTrayOnGameLaunchChange,
    onBrowseGamePath,
    onSaveGamePath,
    onWindowMinimize,
    onWindowToggleMaximize,
    onWindowClose
  } = props

  const [hexDraft, setHexDraft] = useState(primaryHex)
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(primaryHex))

  useEffect(() => {
    setHexDraft(primaryHex)
    try {
      setHsl(hexToHsl(primaryHex))
    } catch {
      // ignore
    }
  }, [primaryHex])

  const hueTrack = useMemo(
    () =>
      'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
    []
  )

  const satTrack = useMemo(() => {
    const h = hsl.h
    const l = hsl.l
    return `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`
  }, [hsl.h, hsl.l])

  const lightTrack = useMemo(() => {
    const h = hsl.h
    const s = hsl.s
    return `linear-gradient(to right, hsl(${h} ${s}% 0%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 100%))`
  }, [hsl.h, hsl.s])

  const setHslAndEmit = (next: Hsl) => {
    const normalized: Hsl = {
      h: Math.max(0, Math.min(360, Math.round(next.h))),
      s: Math.max(0, Math.min(100, Math.round(next.s))),
      l: Math.max(0, Math.min(100, Math.round(next.l)))
    }
    setHsl(normalized)
    const hex = hslToHex(normalized)
    onPrimaryHexChange(hex)
  }

  const canSave = Boolean(gamePath.trim())

  return (
    <div className="titlebar fixed left-0 top-0 z-50 flex h-12 w-full items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <img src={logoSrc} alt="FiveLaunch" className="h-5 w-auto opacity-90 brightness-0 invert" />
        <span>FiveLaunch</span>
        {appVersion ? (
          <span className="font-mono text-xs font-normal text-muted-foreground">v{appVersion}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange}>
          <DialogTrigger asChild>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    aria-label="Settings"
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Global settings</TooltipContent>
            </Tooltip>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Global Settings</DialogTitle>
              <DialogDescription>Set the default FiveM game data location (FiveM.app).</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-3">
              <Input
                placeholder="C:\\Users\\...\\AppData\\Local\\FiveM\\FiveM.app"
                value={gamePath}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onGamePathChange(e.target.value)}
              />

              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={minimizeToTrayOnGameLaunch}
                  onChange={(e) => onMinimizeToTrayOnGameLaunchChange(e.target.checked)}
                />
                <div className="space-y-0.5">
                  <div className="font-medium text-foreground">Minimize to system tray on game launch</div>
                  <div className="text-xs text-muted-foreground">
                    When you launch a client, FiveLaunch will hide to the tray. Click the tray icon to restore.
                  </div>
                </div>
              </label>

              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-foreground">Theme color</div>
                    <div className="text-xs text-muted-foreground">Changes the app primary color (buttons, highlights).</div>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onResetPrimaryHex}>
                    Reset
                  </Button>
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-9 w-12 shrink-0 rounded-md border border-border"
                      style={{ backgroundColor: primaryHex }}
                      aria-label="Current theme color"
                    />
                    <Input
                      value={hexDraft}
                      onChange={(e) => {
                        const v = e.target.value
                        setHexDraft(v)
                        const trimmed = v.trim()
                        if (isHexColor(trimmed)) {
                          onPrimaryHexChange(trimmed.toLowerCase())
                        }
                      }}
                      placeholder="#rrggbb"
                      className="font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-20 text-xs font-mono text-muted-foreground">Hue</span>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        value={hsl.h}
                        onChange={(e) => setHslAndEmit({ ...hsl, h: Number(e.target.value) })}
                        className="theme-slider flex-1"
                        style={{ ['--theme-slider-track' as any]: hueTrack }}
                        aria-label="Hue"
                      />
                      <span className="w-12 text-right text-xs font-mono text-muted-foreground">{hsl.h}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="w-20 text-xs font-mono text-muted-foreground">Saturation</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={hsl.s}
                        onChange={(e) => setHslAndEmit({ ...hsl, s: Number(e.target.value) })}
                        className="theme-slider flex-1"
                        style={{ ['--theme-slider-track' as any]: satTrack }}
                        aria-label="Saturation"
                      />
                      <span className="w-12 text-right text-xs font-mono text-muted-foreground">{hsl.s}%</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="w-20 text-xs font-mono text-muted-foreground">Lightness</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={hsl.l}
                        onChange={(e) => setHslAndEmit({ ...hsl, l: Number(e.target.value) })}
                        className="theme-slider flex-1"
                        style={{ ['--theme-slider-track' as any]: lightTrack }}
                        aria-label="Lightness"
                      />
                      <span className="w-12 text-right text-xs font-mono text-muted-foreground">{hsl.l}%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="secondary" onClick={onBrowseGamePath}>
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Pick your FiveM.app folder</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={onSaveGamePath} disabled={!canSave}>
                      <Save className="h-4 w-4" />
                      Save
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save the global FiveM.app path</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={onWindowMinimize}
              aria-label="Minimize"
            >
              <Minus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Minimize</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={onWindowToggleMaximize}
              aria-label="Maximize"
            >
              <Square className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Maximize</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={onWindowClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

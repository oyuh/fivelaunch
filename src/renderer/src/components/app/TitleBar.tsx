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

export type TitleBarProps = {
  logoSrc: string

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

  const canSave = Boolean(gamePath.trim())

  return (
    <div className="titlebar fixed left-0 top-0 z-50 flex h-12 w-full items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <img src={logoSrc} alt="FiveLaunch" className="h-5 w-auto opacity-90 brightness-0 invert" />
        <span>FiveLaunch</span>
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

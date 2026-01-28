import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FolderOpen } from 'lucide-react'

export type FirstRunDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onContinue: () => void
  onOpenCitizenFxFolder: () => void
  onOpenFiveMFolder: () => void
}

export function FirstRunDialog(props: FirstRunDialogProps): JSX.Element {
  const { open, onOpenChange, onContinue, onOpenCitizenFxFolder, onOpenFiveMFolder } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome to FiveLaunch</DialogTitle>
          <DialogDescription>
            Before linking files, please back up your original FiveM data. We will rename existing folders and settings
            files the first time you link a client.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-md border border-border p-4">
            <div className="font-medium">Back up these items</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>FiveM.app folders: mods, plugins, citizen</li>
              <li>GTA settings: settings.xml</li>
              <li>CitizenFX.ini</li>
            </ul>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="font-medium">Where they live</div>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <div>
                CitizenFX folder: <span className="text-foreground">%APPDATA%\CitizenFX</span>
              </div>
              <div>
                FiveM app data: <span className="text-foreground">%LOCALAPPDATA%\FiveM\FiveM.app</span>
              </div>
              <div>
                GTA V settings:{' '}
                <span className="text-foreground">%USERPROFILE%\Documents\Rockstar Games\GTA V\settings.xml</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" onClick={onOpenCitizenFxFolder}>
                    <FolderOpen className="h-4 w-4" />
                    Open CitizenFX Folder
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Opens %APPDATA%\CitizenFX</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" onClick={onOpenFiveMFolder}>
                    <FolderOpen className="h-4 w-4" />
                    Open FiveM Folder
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Opens %LOCALAPPDATA%\FiveM\FiveM.app</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={onContinue}>I Understand</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

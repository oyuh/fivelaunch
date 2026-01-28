import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ClientProfile } from '@/types'
import { FolderOpen } from 'lucide-react'

export type RefsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void

  client: ClientProfile | null

  onOpenClientFolder: () => void
  onOpenClientPluginsFolder: () => void
  onOpenFiveMFolder: () => void
  onOpenFiveMPluginsFolder: () => void
  onOpenCitizenFxFolder: () => void
}

export function RefsDialog(props: RefsDialogProps): JSX.Element {
  const {
    open,
    onOpenChange,
    client,
    onOpenClientFolder,
    onOpenClientPluginsFolder,
    onOpenFiveMFolder,
    onOpenFiveMPluginsFolder,
    onOpenCitizenFxFolder
  } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refs</DialogTitle>
          <DialogDescription>Quick links to open useful folders.</DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" disabled={!client} onClick={onOpenClientFolder}>
            <FolderOpen className="h-4 w-4" />
            Client Folder
          </Button>
          <Button variant="secondary" disabled={!client} onClick={onOpenClientPluginsFolder}>
            <FolderOpen className="h-4 w-4" />
            Client Plugins
          </Button>
          <Button variant="secondary" onClick={onOpenFiveMFolder}>
            <FolderOpen className="h-4 w-4" />
            FiveM Folder
          </Button>
          <Button variant="secondary" onClick={onOpenFiveMPluginsFolder}>
            <FolderOpen className="h-4 w-4" />
            FiveM Plugins
          </Button>
          <Button variant="secondary" onClick={onOpenCitizenFxFolder}>
            <FolderOpen className="h-4 w-4" />
            CitizenFX Folder
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

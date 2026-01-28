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
import { Plus } from 'lucide-react'

export type CreateClientDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void

  newClientName: string
  onNewClientNameChange: (value: string) => void
  onCreate: () => void
}

export function CreateClientDialog(props: CreateClientDialogProps): JSX.Element {
  const { open, onOpenChange, newClientName, onNewClientNameChange, onCreate } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button size="sm" aria-label="Create client">
                <Plus className="h-4 w-4" />
                New Client
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Create a new client profile</TooltipContent>
        </Tooltip>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Client</DialogTitle>
          <DialogDescription>Give your client a name. You can edit details later.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="New client name"
            value={newClientName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onNewClientNameChange(e.target.value)}
          />
          <Button onClick={onCreate} disabled={!newClientName.trim()}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ClientProfile, ClientStats } from '@/types'
import { FolderOpen } from 'lucide-react'

export type ClientDetailsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void

  client: ClientProfile | null

  clientStats: ClientStats | null
  clientStatsLoading: boolean
  lastPlayedText: string
  storageText: string

  renameValue: string
  onRenameValueChange: (value: string) => void
  onRename: () => void

  modsEntries: string[]
  modsLoading: boolean
  modsError: string | null

  onOpenClientFolder: () => void
  onCreateShortcut: () => void
  onDeleteClient: () => void
}

export function ClientDetailsDialog(props: ClientDetailsDialogProps): JSX.Element {
  const {
    open,
    onOpenChange,
    client,
    clientStats,
    clientStatsLoading,
    lastPlayedText,
    storageText,
    renameValue,
    onRenameValueChange,
    onRename,
    modsEntries,
    modsLoading,
    modsError,
    onOpenClientFolder,
    onCreateShortcut,
    onDeleteClient
  } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Client Details</DialogTitle>
          <DialogDescription>Rename, view stats, delete, and see this client’s mods folder.</DialogDescription>
        </DialogHeader>

        {!client ? (
          <div className="mt-4 text-sm text-muted-foreground">Select a client first.</div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-border p-4 text-sm">
              <div className="grid gap-2 text-muted-foreground">
                <div>
                  <span className="text-foreground">Name:</span> {client.name}
                </div>
                <div>
                  <span className="text-foreground">Client ID:</span>{' '}
                  <span className="font-mono text-xs">{client.id}</span>
                </div>
                <div>
                  <span className="text-foreground">Files:</span>{' '}
                  {clientStatsLoading ? 'Loading…' : `${clientStats?.fileCount ?? 0} files`}
                </div>
                <div>
                  <span className="text-foreground">Storage:</span> {clientStatsLoading ? 'Loading…' : storageText}
                </div>
                <div>
                  <span className="text-foreground">Last Played:</span> {lastPlayedText}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Rename client"
                value={renameValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onRenameValueChange(e.target.value)}
              />
              <Button variant="secondary" onClick={onRename} disabled={!renameValue.trim()}>
                Rename
              </Button>
            </div>

            <div className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Mods folder</div>
                  <div className="text-xs text-muted-foreground">Entries inside this client’s mods folder.</div>
                </div>
                <div className="text-xs text-muted-foreground">{modsLoading ? 'Loading…' : `${modsEntries.length} item(s)`}</div>
              </div>

              {modsError && (
                <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {modsError}
                </div>
              )}

              {!modsError && (
                <div className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-muted/20 p-3">
                  {modsLoading ? (
                    <div className="text-sm text-muted-foreground">Loading…</div>
                  ) : modsEntries.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No mods found.</div>
                  ) : (
                    <div className="space-y-1 font-mono text-xs">
                      {modsEntries.map((name) => (
                        <div key={name} className="truncate text-foreground/90">
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onOpenClientFolder}>
                <FolderOpen className="h-4 w-4" />
                Open Client Folder
              </Button>
              <Button variant="secondary" onClick={onCreateShortcut}>
                Create Desktop Shortcut
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="destructive" onClick={onDeleteClient}>
                Delete Client
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

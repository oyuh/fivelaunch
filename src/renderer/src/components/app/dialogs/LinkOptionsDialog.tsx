import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ClientProfile, LinkOptions } from '@/types'

type ToggleLinkKey = Exclude<keyof LinkOptions, 'pluginsMode'>

export type LinkOptionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: ClientProfile | null

  onToggleLink: (key: ToggleLinkKey) => void
  onSetPluginsMode: (mode: NonNullable<LinkOptions['pluginsMode']>) => void
}

export function LinkOptionsDialog(props: LinkOptionsDialogProps): JSX.Element {
  const { open, onOpenChange, client, onToggleLink, onSetPluginsMode } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Options</DialogTitle>
          <DialogDescription>
            Choose what this client controls inside <span className="text-foreground">FiveM.app</span>. Plugins defaults
            to <span className="text-foreground">Copy/Sync</span>.
          </DialogDescription>
        </DialogHeader>

        {!client ? (
          <div className="mt-4 text-sm text-muted-foreground">Select a client first.</div>
        ) : (
          <div className="mt-4 space-y-2">
            {(
              [
                ['mods', 'Mods', 'Link client mods folder'],
                ['plugins', 'Plugins', 'Link client plugins folder'],
                ['citizen', 'Citizen', 'Advanced: replaces core citizen files'],
                ['gtaSettings', 'GTA Settings', 'Copy client XML into game locations'],
                ['citizenFxIni', 'CitizenFX.ini', 'Link/replace CitizenFX.ini']
              ] as const
            ).map(([key, label, hint]) => {
              const enabled = !!client.linkOptions?.[key]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggleLink(key)}
                  className={`flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    enabled ? 'border-primary/50 bg-primary/10' : 'border-border bg-card hover:bg-muted/30'
                  }`}
                >
                  <div>
                    <div className="font-medium text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground">{hint}</div>
                  </div>
                  <div className="mt-1">
                    <div
                      className={`h-5 w-9 rounded-full border transition-colors ${
                        enabled ? 'border-primary/60 bg-primary/60' : 'border-border bg-muted'
                      }`}
                      aria-hidden="true"
                    >
                      <div
                        className={`h-4 w-4 translate-y-[2px] rounded-full bg-background shadow transition-transform ${
                          enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </div>
                  </div>
                </button>
              )
            })}

            {!!client.linkOptions?.plugins && (
              <div className="mt-2 rounded-md border border-border bg-card px-3 py-2">
                <div className="text-sm font-medium text-foreground">Plugins mode</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <span className="text-foreground">Copy/Sync</span> is recommended. It keeps
                  <span className="text-foreground"> %LOCALAPPDATA%\FiveM\FiveM.app\plugins</span> as a real folder so
                  in-game “Open folder” points where you expect. Junction is faster, but Windows apps often resolve the
                  junction to the client folder.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSetPluginsMode('sync')}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      (client.linkOptions.pluginsMode ?? 'sync') === 'sync'
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border bg-card hover:bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    Copy/Sync (default)
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetPluginsMode('junction')}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      client.linkOptions.pluginsMode === 'junction'
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border bg-card hover:bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    Junction (fast)
                  </button>
                </div>

                {client.linkOptions.pluginsMode === 'junction' && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Note: Junction mode is intentionally “dumb” — it only links folders. No background syncing/monitoring
                    runs while the game is open (and minimize-on-launch won’t auto-restore).
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ClientProfile, ClientStats, GameBusyState } from '@/types'
import { Info, FolderOpen, Link2, Wrench } from 'lucide-react'
import { ActionTile } from './ActionTile'
import { LaunchLogo } from './LaunchLogo'

export type ClientOverviewCardProps = {
  selectedClient: ClientProfile | null

  canLaunch: boolean
  launchDisabledReason: string | null
  isLaunching: boolean
  gameBusyState: GameBusyState

  onLaunch: () => void
  onOpenDetails: () => void
  onOpenLinks: () => void
  onOpenGtaSettings: () => void
  onOpenTools: () => void

  clientStats: ClientStats | null
  clientStatsLoading: boolean
  lastPlayedText: string
  storageText: string
}

export function ClientOverviewCard(props: ClientOverviewCardProps): JSX.Element {
  const {
    selectedClient,
    canLaunch,
    launchDisabledReason,
    isLaunching,
    gameBusyState,
    onLaunch,
    onOpenDetails,
    onOpenLinks,
    onOpenGtaSettings,
    onOpenTools,
    clientStats,
    clientStatsLoading,
    lastPlayedText,
    storageText
  } = props

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {!selectedClient ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">No client selected</div>
            <div className="mt-1">Pick a client from the list on the left.</div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[260px_1fr]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!canLaunch}
                    onClick={onLaunch}
                    className={`relative h-[260px] w-full rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      canLaunch
                        ? 'border-primary/30 bg-primary/10 hover:border-primary/50 hover:bg-primary/15'
                        : 'cursor-not-allowed border-border bg-muted/20 opacity-70'
                    }`}
                  >
                    <div className="absolute inset-0 overflow-hidden rounded-2xl">
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-amber-500/10" />
                      <div
                        className="absolute inset-0 opacity-90"
                        style={{
                          backgroundImage:
                            'radial-gradient(800px 420px at 20% 15%, hsl(var(--primary) / 0.18), transparent 60%), radial-gradient(600px 380px at 85% 30%, rgba(245, 158, 11, 0.14), transparent 60%), radial-gradient(520px 360px at 50% 110%, rgba(16, 185, 129, 0.10), transparent 60%)'
                        }}
                      />
                      <div
                        className="absolute inset-0 opacity-[0.09]"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(115deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 1px, transparent 1px, transparent 14px)'
                        }}
                      />
                    </div>

                    <div className="relative z-10 flex h-full flex-col justify-between">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{selectedClient.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {canLaunch ? 'Ready' : launchDisabledReason}
                          </div>
                        </div>
                        <div
                          className={`h-3 w-3 shrink-0 rounded-full ${
                            gameBusyState.pluginsSyncBusy
                              ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)] animate-pulse'
                              : isLaunching
                                ? 'bg-primary shadow-[0_0_14px_hsl(var(--primary))] animate-pulse'
                                : canLaunch
                                  ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)]'
                                  : 'bg-muted'
                          }`}
                          aria-hidden="true"
                        />
                      </div>

                      <div className="flex flex-col items-center justify-center gap-3">
                        <LaunchLogo />
                        <div className="text-sm font-semibold text-foreground">Launch</div>
                        <div className="text-xs text-muted-foreground">
                          {canLaunch ? 'Click to launch this client' : 'Fix the requirement above'}
                        </div>
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        {gameBusyState.pluginsSyncBusy
                          ? 'Waiting for plugin sync to finish…'
                          : isLaunching
                            ? 'Launching…'
                            : 'Launch is ready.'}
                      </div>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {canLaunch ? 'Launch selected client' : launchDisabledReason ?? 'Cannot launch right now'}
                </TooltipContent>
              </Tooltip>

              <div className="grid gap-3 sm:grid-cols-2">
                <ActionTile
                  title="Details"
                  description="Rename/delete + stats + mods list"
                  icon={<Info className="h-4 w-4" />}
                  onClick={onOpenDetails}
                />
                <ActionTile
                  title="Link Options"
                  description="What gets linked + plugins mode"
                  icon={<Link2 className="h-4 w-4" />}
                  onClick={onOpenLinks}
                />
                <ActionTile
                  title="GTA Settings"
                  description="Edit settings.xml for this client"
                  icon={<Wrench className="h-4 w-4" />}
                  disabled={!selectedClient.linkOptions?.gtaSettings}
                  disabledReason="Enable GTA Settings in Link Options first"
                  onClick={onOpenGtaSettings}
                />
                <ActionTile
                  title="Refs"
                  description="Open folders (client, FiveM, CitizenFX)"
                  icon={<FolderOpen className="h-4 w-4" />}
                  onClick={onOpenTools}
                />
              </div>
            </div>

            <div className="space-y-1 text-xs text-muted-foreground">
              <div>
                Files: {clientStatsLoading ? 'Loading…' : `${clientStats?.fileCount ?? 0}`}
                {' · '}Storage: {clientStatsLoading ? 'Loading…' : storageText}
                {' · '}Last played: {lastPlayedText}
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground/80">{selectedClient.id}</div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

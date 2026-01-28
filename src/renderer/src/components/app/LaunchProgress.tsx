export type LaunchProgressProps = {
  launchStatus: string | null
  isLaunching: boolean
  onDismiss: () => void
}

const LAUNCH_STEPS = [
  { key: 'prepare', label: 'Prepare', match: /Preparing/i },
  { key: 'wait', label: 'Wait', match: /Waiting for plugins sync/i },
  { key: 'link', label: 'Link', match: /Linking/i },
  { key: 'settings', label: 'Settings', match: /(Applying GTA settings|GTA Settings|Finalizing settings)/i },
  { key: 'start', label: 'Start', match: /Starting FiveM/i },
  { key: 'done', label: 'Done', match: /Launched!/i }
] as const

export function LaunchProgress(props: LaunchProgressProps): JSX.Element | null {
  const { launchStatus, isLaunching, onDismiss } = props

  if (!launchStatus) return null

  // These statuses are surfaced via the bottom-right toast in App;
  // keeping them here creates a duplicate, harder-to-miss banner.
  if (/^Plugins sync complete\./i.test(launchStatus) || /^Game closed\./i.test(launchStatus)) {
    return null
  }

  const isError = launchStatus.startsWith('Error:')
  const isWaitingForSync = /Waiting for plugins sync/i.test(launchStatus)

  const currentIndex = isError
    ? -1
    : Math.max(
        0,
        LAUNCH_STEPS.findIndex((s) => s.match.test(launchStatus))
      )

  const isDone = launchStatus === 'Launched!'

  return (
    <div className="mt-2 w-full rounded-lg border border-border bg-card/60 px-3 py-2 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isWaitingForSync && (
              <div
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground"
                aria-label="Waiting for sync"
                title="Waiting for sync"
              />
            )}

            {isLaunching && !isDone && !isError && (
              <div className="flex items-center gap-1">
                {LAUNCH_STEPS.slice(0, 5).map((step, idx) => {
                  const completed = idx < currentIndex
                  const active = idx === currentIndex
                  const base = 'h-2.5 w-2.5 rounded-full transition-colors'

                  if (isDone) {
                    return (
                      <div key={step.key} className={`${base} bg-emerald-500/90`} title={step.label} />
                    )
                  }

                  if (completed) {
                    return (
                      <div key={step.key} className={`${base} bg-primary/80`} title={step.label} />
                    )
                  }

                  if (active) {
                    return (
                      <div key={step.key} className={`${base} bg-primary animate-pulse`} title={step.label} />
                    )
                  }

                  return <div key={step.key} className={`${base} bg-muted`} title={step.label} />
                })}
              </div>
            )}

            {isError && <div className="h-2.5 w-2.5 rounded-full bg-destructive" />}
            {isDone && <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />}

            <div className="truncate text-sm text-foreground">{launchStatus}</div>
          </div>

          {isWaitingForSync && (
            <div className="mt-1 text-xs text-muted-foreground">
              Finishing the last plugins sync to keep clients isolated.
            </div>
          )}
        </div>

        {!isLaunching && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss status"
            title="Dismiss"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}

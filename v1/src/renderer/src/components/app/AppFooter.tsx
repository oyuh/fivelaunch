export type AppFooterProps = {
  repoUrl: string
  commitInfo: {
    sha: string
    shortSha: string
    message: string
    date: string
    url: string
    apiUrl: string
  } | null
  updateStatus: {
    latestVersion: string | null
    latestUrl: string | null
    isUpdateAvailable: boolean
  } | null
  onResetFirstRun: () => void
  showDevResetFirstRun: boolean
}

export function AppFooter(props: AppFooterProps): JSX.Element {
  const { repoUrl, commitInfo, updateStatus, onResetFirstRun, showDevResetFirstRun } = props

  return (
    <footer className="mx-auto mt-8 flex w-full max-w-6xl flex-col items-start justify-between gap-2 border-t border-border px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
      <div className="flex flex-wrap items-center gap-3">
        <span>© {new Date().getFullYear()} FiveLaunch</span>
        <a href={repoUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
          Open Source
        </a>
        {updateStatus?.isUpdateAvailable && updateStatus.latestUrl && (
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => window.open(updateStatus.latestUrl!, '_blank', 'noopener,noreferrer')}
            title={
              updateStatus.latestVersion ? `Update available: v${updateStatus.latestVersion}` : 'Update available'
            }
          >
            Update available{updateStatus.latestVersion ? ` (v${updateStatus.latestVersion})` : ''}
          </button>
        )}
        <a
          href="https://fivelaunch.help/support"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground"
        >
          Help & Support
        </a>
        {showDevResetFirstRun && (
          <button onClick={onResetFirstRun} className="hover:text-foreground" type="button">
            Reset First-Run
          </button>
        )}
      </div>
      {commitInfo ? (
        <a
          href={commitInfo.url}
          target="_blank"
          rel="noreferrer"
          title={`Commit ${commitInfo.shortSha} · ${commitInfo.message}\nAPI: ${commitInfo.apiUrl}`}
          className="hover:text-foreground"
        >
          Commit {commitInfo.shortSha} · {commitInfo.date ? new Date(commitInfo.date).toLocaleDateString() : '—'}
        </a>
      ) : (
        <span className="text-muted-foreground">Commit info available in build</span>
      )}
    </footer>
  )
}

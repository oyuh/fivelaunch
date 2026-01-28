import { useState, useEffect, useMemo, useRef } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  ClientProfile,
  LinkOptions,
  GtaSettingsItem,
  ClientStats,
  AppLogEntry,
  GameBusyState
} from '@/types'
import appLogo from '@resources/Logo.png'
import { LogsPanel } from '@/components/LogsPanel'
import { TitleBar } from '@/components/app/TitleBar'
import { FirstRunDialog } from '@/components/app/dialogs/FirstRunDialog'
import { CreateClientDialog } from '@/components/app/dialogs/CreateClientDialog'
import { ClientListCard } from '@/components/app/ClientListCard'
import { ClientOverviewCard } from '@/components/app/ClientOverviewCard'
import { ClientDetailsDialog } from '@/components/app/dialogs/ClientDetailsDialog'
import { LinkOptionsDialog } from '@/components/app/dialogs/LinkOptionsDialog'
import { RefsDialog } from '@/components/app/dialogs/RefsDialog'
import { GtaSettingsDialog } from '@/components/app/dialogs/GtaSettingsDialog'
import { LaunchProgress } from '@/components/app/LaunchProgress'
import { AppFooter } from '@/components/app/AppFooter'
import { formatBytes } from '@/lib/format'

function App(): JSX.Element {
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [clientQuery, setClientQuery] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [firstRunOpen, setFirstRunOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [modsEntries, setModsEntries] = useState<string[]>([])
  const [modsLoading, setModsLoading] = useState(false)
  const [modsError, setModsError] = useState<string | null>(null)
  const [gamePath, setGamePath] = useState('')
  const [minimizeToTrayOnGameLaunch, setMinimizeToTrayOnGameLaunch] = useState(false)
  const [gtaSettingsOpen, setGtaSettingsOpen] = useState(false)
  const [gtaSettingsLoading, setGtaSettingsLoading] = useState(false)
  const [gtaSettingsError, setGtaSettingsError] = useState<string | null>(null)
  const [gtaSettingsRoot, setGtaSettingsRoot] = useState('Settings')
  const [gtaSettingsItems, setGtaSettingsItems] = useState<GtaSettingsItem[]>([])
  const [gtaSettingsDirty, setGtaSettingsDirty] = useState(false)
  const [clientStats, setClientStats] = useState<ClientStats | null>(null)
  const [clientStatsLoading, setClientStatsLoading] = useState(false)
  const [launchStatus, setLaunchStatus] = useState<string | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchStatusUpdatedAt, setLaunchStatusUpdatedAt] = useState<number>(0)
  const [gameBusyState, setGameBusyState] = useState<GameBusyState>({ pluginsSyncBusy: false })
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [updateStatus, setUpdateStatus] = useState<
    | {
        latestVersion: string | null
        latestUrl: string | null
        isUpdateAvailable: boolean
      }
    | null
  >(null)
  const launchLogSeq = useRef(0)
  const toastSeq = useRef(0)
  const toastTimer = useRef<number | null>(null)
  const [toast, setToast] = useState<null | { id: number; title: string; message: string; level: 'info' | 'success' | 'warn' | 'error' }>(
    null
  )
  const selectedClientData = clients.find((c) => c.id === selectedClient) || null

  const showToast = (title: string, message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, title, message, level })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 6000)
  }

  const appendLog = (entry: AppLogEntry) => {
    setLogs((prev) => {
      const next = [...prev, entry]
      // Keep memory bounded.
      if (next.length > 900) return next.slice(next.length - 900)
      return next
    })
  }

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
  }, [clients, clientQuery])

  useEffect(() => {
    if (!window.api) return
    loadClients()
  }, [])

  useEffect(() => {
    if (!window.api) return
    let cancelled = false

    const run = async () => {
      try {
        const status = await window.api.getUpdateStatus()
        if (cancelled) return
        setUpdateStatus({
          latestVersion: status.latestVersion,
          latestUrl: status.latestUrl,
          isUpdateAvailable: Boolean(status.isUpdateAvailable)
        })
      } catch {
        // ignore
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const acknowledged = localStorage.getItem('fivelaunch.firstRunAck')
    if (!acknowledged) {
      setFirstRunOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!window.api) return
    let cancelled = false

    const load = async () => {
      try {
        const settings = await window.api.getSettings()
        if (cancelled) return

        const saved = (settings.gamePath || '').trim()
        setMinimizeToTrayOnGameLaunch(Boolean(settings.minimizeToTrayOnGameLaunch))
        if (saved) {
          setGamePath(saved)
          return
        }

        // If the user hasn't saved a path yet, try to auto-detect it.
        const resolved = await window.api.getResolvedGamePath()
        if (cancelled) return
        if (resolved) setGamePath(resolved)
      } catch {
        // ignore
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!gtaSettingsOpen || !selectedClientData) return
    void loadGtaSettings(selectedClientData.id)
  }, [gtaSettingsOpen, selectedClientData?.id])

  useEffect(() => {
    if (!detailsOpen || !selectedClientData) return
    let cancelled = false

    const run = async () => {
      try {
        if (typeof window.api.listClientMods !== 'function') {
          setModsEntries([])
          setModsError('Mods listing is unavailable (restart the app to reload the preload script).')
          return
        }
        setModsError(null)
        setModsLoading(true)
        const entries = await window.api.listClientMods(selectedClientData.id)
        if (!cancelled) setModsEntries(entries)
      } catch (error) {
        if (!cancelled) {
          setModsEntries([])
          setModsError((error as Error).message || 'Failed to load mods folder.')
        }
      } finally {
        if (!cancelled) setModsLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [detailsOpen, selectedClientData?.id])

  useEffect(() => {
    if (!selectedClientData || !window.api) {
      setClientStats(null)
      return
    }
    const loadStats = async () => {
      try {
        setClientStatsLoading(true)
        const stats = await window.api.getClientStats(selectedClientData.id)
        setClientStats(stats)
      } finally {
        setClientStatsLoading(false)
      }
    }
    void loadStats()
  }, [selectedClientData?.id])

  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onLaunchStatus((status: string) => {
      setLaunchStatus(status)
      setLaunchStatusUpdatedAt(Date.now())

      const level = status.startsWith('Error:') ? 'error' : /Waiting for plugins sync/i.test(status) ? 'warn' : 'info'
      launchLogSeq.current += 1
      appendLog({
        id: launchLogSeq.current,
        ts: Date.now(),
        level,
        message: status,
        source: 'launch'
      })

      // Bottom-right toast for high-signal events.
      if (/^Plugins sync complete\./i.test(status)) {
        showToast('Plugins sync', 'Complete.', 'success')
      } else if (/^Finalizing plugins sync/i.test(status)) {
        showToast('Plugins sync', 'Finalizing changes…', 'info')
      } else if (/^Game closed\./i.test(status)) {
        showToast('Game', 'Closed. Welcome back.', 'info')
      } else if (/Plugins sync ERROR/i.test(status)) {
        showToast('Plugins sync', status, 'error')
      }

      if (status === 'Launched!') {
        setTimeout(() => {
          setLaunchStatus(null)
          setIsLaunching(false)
        }, 2000)
      }
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!window.api) return

    let cancelled = false

    const loadInitial = async () => {
      try {
        const initial = await window.api.getAppLogs()
        if (cancelled) return
        setLogs((prev) => {
          // Preserve any launch logs that might have arrived already.
          const launchOnly = prev.filter((l) => l.source === 'launch')
          const mainLogs: AppLogEntry[] = initial.map((l) => ({ ...l, source: 'main' }))
          const merged = [...mainLogs, ...launchOnly]
          return merged.slice(Math.max(0, merged.length - 900))
        })
      } catch {
        // ignore
      }
    }

    loadInitial()

    const unsubscribe = window.api.onAppLog((entry) => {
      if (cancelled) return
      appendLog({ ...entry, source: 'main' })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!window.api) return
    let cancelled = false

    const tick = async () => {
      try {
        const state = await window.api.getGameBusyState()
        if (!cancelled) setGameBusyState(state)
      } catch {
        // ignore
      }
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // Watchdog: never leave the UI in a "launching" state indefinitely.
  useEffect(() => {
    if (!isLaunching) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      // Clear after 60s without reaching "Launched!".
      // This is UI-only; the actual launch may still succeed.
      if (Date.now() - startedAt > 60_000) {
        setIsLaunching(false)
        setLaunchStatus((prev) => prev ?? 'Launch taking longer than expected')
        window.clearInterval(timer)
        return
      }

      // If status hasn't updated in a while, show a friendly hint.
      // Don't overwrite a purposeful waiting state.
      if (
        launchStatusUpdatedAt &&
        Date.now() - launchStatusUpdatedAt > 15_000 &&
        !(launchStatus && /Waiting for plugins sync/i.test(launchStatus))
      ) {
        setLaunchStatus('Launching... (still working)')
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isLaunching, launchStatusUpdatedAt])

  const loadClients = async () => {
    const data = await window.api.getClients()
    setClients(data)
  }

  const handleCreate = async () => {
    if (!newClientName) return
    await window.api.createClient(newClientName)
    setNewClientName('')
    loadClients()
    setCreateOpen(false)
  }

  const handleDelete = async (id: string, e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.stopPropagation()
    const client = clients.find((c) => c.id === id)
    const name = client?.name || 'this client'
    const confirmed = window.confirm(`Delete ${name}? This will remove its local folder.`)
    if (!confirmed) return
    await window.api.deleteClient(id)
    if (selectedClient === id) setSelectedClient(null)
    loadClients()
  }

  const handleLaunch = async () => {
    if (!selectedClient) return
    try {
      setIsLaunching(true)
      setLaunchStatus('Preparing...')
      const result = await window.api.launchClient(selectedClient)
      if (!result.success) {
        setLaunchStatus(`Error: ${result.error}`)
        setTimeout(() => {
          setLaunchStatus(null)
          setIsLaunching(false)
        }, 3000)
      }
    } catch (error) {
      setLaunchStatus(`Error: ${(error as Error).message}`)
      setTimeout(() => {
        setLaunchStatus(null)
        setIsLaunching(false)
      }, 3000)
    }
  }

  const clearAllLogs = async () => {
    try {
      await window.api.clearAppLogs()
    } catch {
      // ignore
    }
    setLogs([])
    launchLogSeq.current = 0
  }

  const handleOpenFolder = async () => {
    if (!selectedClient) return
    await window.api.openClientFolder(selectedClient)
  }

  const handleCreateShortcut = async () => {
    if (!selectedClient) return
    try {
      const result = await window.api.createClientShortcut(selectedClient)
      if (result?.success) {
        setLaunchStatus(`Shortcut created: ${result.path}`)
        setTimeout(() => setLaunchStatus(null), 3000)
      }
    } catch (error) {
      setLaunchStatus(`Error: ${(error as Error).message}`)
      setTimeout(() => setLaunchStatus(null), 3000)
    }
  }

  const handleBrowseGamePath = async () => {
    const selected = await window.api.browseGamePath()
    if (selected) setGamePath(selected)
  }

  const handleSaveGamePath = async () => {
    if (!gamePath.trim()) return
    await window.api.setGamePath(gamePath.trim())
    await window.api.setMinimizeToTrayOnGameLaunch(minimizeToTrayOnGameLaunch)
    setSettingsOpen(false)
  }

  const handleRename = async () => {
    if (!selectedClientData) return
    const trimmed = renameValue.trim()
    if (!trimmed) return
    await window.api.renameClient(selectedClientData.id, trimmed)
    setRenameValue('')
    loadClients()
  }

  type ToggleLinkKey = Exclude<keyof LinkOptions, 'pluginsMode'>

  const handleToggleLink = async (key: ToggleLinkKey) => {
    if (!selectedClientData) return
    const nextValue = !selectedClientData.linkOptions[key]
    const updated: LinkOptions = {
      ...selectedClientData.linkOptions,
      [key]: nextValue
    }

    // If enabling plugins and the user hasn't chosen a mode, default to Copy/Sync.
    if (key === 'plugins' && nextValue && !updated.pluginsMode) {
      updated.pluginsMode = 'sync'
    }
    await window.api.updateClientLinks(selectedClientData.id, updated)
    setClients((prev) =>
      prev.map((c) => (c.id === selectedClientData.id ? { ...c, linkOptions: updated } : c))
    )
  }

  const handleSetPluginsMode = async (mode: NonNullable<LinkOptions['pluginsMode']>) => {
    if (!selectedClientData) return
    const updated: LinkOptions = {
      ...selectedClientData.linkOptions,
      pluginsMode: mode
    }
    await window.api.updateClientLinks(selectedClientData.id, updated)
    setClients((prev) =>
      prev.map((c) => (c.id === selectedClientData.id ? { ...c, linkOptions: updated } : c))
    )
  }

  useEffect(() => {
    setRenameValue(selectedClientData?.name || '')
  }, [selectedClientData?.id])

  const loadGtaSettings = async (id: string) => {
    try {
      setGtaSettingsLoading(true)
      setGtaSettingsError(null)
      const doc = await window.api.getClientGtaSettings(id)
      setGtaSettingsRoot(doc.rootName || 'Settings')
      setGtaSettingsItems(doc.items.map((item) => ({ ...item, id: crypto.randomUUID() })))
      setGtaSettingsDirty(false)
    } catch (error) {
      setGtaSettingsError((error as Error).message || 'Failed to load GTA settings.')
    } finally {
      setGtaSettingsLoading(false)
    }
  }

  const handleImportGtaSettings = async () => {
    if (!selectedClientData) return
    try {
      setGtaSettingsError(null)
      const doc = await window.api.importGtaSettingsFromDocuments(selectedClientData.id)
      setGtaSettingsRoot(doc.rootName || 'Settings')
      setGtaSettingsItems(doc.items.map((item) => ({ ...item, id: crypto.randomUUID() })))
      setGtaSettingsDirty(true)
    } catch (error) {
      setGtaSettingsError((error as Error).message || 'Failed to import settings.')
    }
  }

  const handleLoadFullExample = async () => {
    if (!selectedClientData) return
    try {
      setGtaSettingsError(null)
      const doc = await window.api.importGtaSettingsFromTemplate(selectedClientData.id)
      setGtaSettingsRoot(doc.rootName || 'Settings')
      setGtaSettingsItems(doc.items.map((item: any) => ({ ...item, id: crypto.randomUUID() })))
      setGtaSettingsDirty(true)
    } catch (error) {
      setGtaSettingsError((error as Error).message || 'Failed to load template.')
    }
  }

  const handleSaveGtaSettings = async () => {
    if (!selectedClientData) return
    try {
      setGtaSettingsError(null)
      await window.api.saveClientGtaSettings(selectedClientData.id, {
        rootName: gtaSettingsRoot,
        items: gtaSettingsItems
      })
      setGtaSettingsDirty(false)
    } catch (error) {
      setGtaSettingsError((error as Error).message || 'Failed to save settings.')
    }
  }

  const handleUpdateGtaAttribute = (itemId: string, attrKey: string, newValue: string) => {
    setGtaSettingsItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, attributes: { ...item.attributes, [attrKey]: newValue } }
          : item
      )
    )
    setGtaSettingsDirty(true)
  }

  const handleFirstRunContinue = () => {
    localStorage.setItem('fivelaunch.firstRunAck', 'true')
    setFirstRunOpen(false)
  }

  const handleResetFirstRun = () => {
    localStorage.removeItem('fivelaunch.firstRunAck')
    setFirstRunOpen(true)
  }
  const lastPlayedText = selectedClientData?.lastPlayed
    ? new Date(selectedClientData.lastPlayed).toLocaleString()
    : 'Never'

  const commitInfo = __COMMIT_INFO__
  const repoUrl = __REPO_URL__

  const launchDisabledReason = !selectedClientData
    ? 'Select a client to launch'
    : !gamePath.trim()
      ? 'Set your FiveM.app path in Settings first'
      : gameBusyState.pluginsSyncBusy
        ? 'Finishing previous plugins sync'
        : isLaunching
          ? 'Launch already in progress'
          : null

  const canLaunch = Boolean(selectedClientData) && Boolean(gamePath.trim()) && !gameBusyState.pluginsSyncBusy && !isLaunching

  if (!window.api) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          <div className="text-base font-semibold text-foreground">Renderer failed to load</div>
          <p className="mt-2">
            The preload API is missing. Restart the dev server and Electron so the
            preload script is loaded.
          </p>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen w-full bg-background">
        {toast && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
            <div
              key={toast.id}
              className={
                'pointer-events-auto rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur ' +
                (toast.level === 'success'
                  ? 'border-emerald-500/30'
                  : toast.level === 'error'
                    ? 'border-red-500/30'
                    : toast.level === 'warn'
                      ? 'border-yellow-500/30'
                      : 'border-border')
              }
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-5">{toast.title}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{toast.message}</div>
                </div>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setToast(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
        <TitleBar
          logoSrc={appLogo}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          gamePath={gamePath}
          onGamePathChange={setGamePath}
          minimizeToTrayOnGameLaunch={minimizeToTrayOnGameLaunch}
          onMinimizeToTrayOnGameLaunchChange={setMinimizeToTrayOnGameLaunch}
          onBrowseGamePath={handleBrowseGamePath}
          onSaveGamePath={handleSaveGamePath}
          onWindowMinimize={() => window.api.windowMinimize()}
          onWindowToggleMaximize={() => window.api.windowToggleMaximize()}
          onWindowClose={() => window.api.windowClose()}
        />

        <div className="flex min-h-screen flex-col pt-12">
          <FirstRunDialog
            open={firstRunOpen}
            onOpenChange={(open) => {
              if (!open) {
                localStorage.setItem('fivelaunch.firstRunAck', 'true')
              }
              setFirstRunOpen(open)
            }}
            onContinue={handleFirstRunContinue}
            onOpenCitizenFxFolder={() => window.api.openCitizenFxFolder()}
            onOpenFiveMFolder={() => window.api.openFiveMFolder()}
          />
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-6 pt-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">FiveLaunch Clients</h1>
              <p className="text-sm text-muted-foreground">
                Create profiles, manage links, and launch FiveM.
              </p>
            </div>
            <CreateClientDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              newClientName={newClientName}
              onNewClientNameChange={setNewClientName}
              onCreate={handleCreate}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <ClientListCard
              clients={clients}
              filteredClients={filteredClients}
              query={clientQuery}
              onQueryChange={setClientQuery}
              selectedClientId={selectedClient}
              onSelectClient={(id) => setSelectedClient((prev) => (prev === id ? null : id))}
            />

            <div className="space-y-4">
              <ClientOverviewCard
                selectedClient={selectedClientData}
                canLaunch={canLaunch}
                launchDisabledReason={launchDisabledReason}
                isLaunching={isLaunching}
                gameBusyState={gameBusyState}
                onLaunch={handleLaunch}
                onOpenDetails={() => setDetailsOpen(true)}
                onOpenLinks={() => setLinksOpen(true)}
                onOpenGtaSettings={() => setGtaSettingsOpen(true)}
                onOpenTools={() => setToolsOpen(true)}
                clientStats={clientStats}
                clientStatsLoading={clientStatsLoading}
                lastPlayedText={lastPlayedText}
                storageText={formatBytes(clientStats?.totalBytes ?? 0)}
              />

              <LaunchProgress
                launchStatus={launchStatus}
                isLaunching={isLaunching}
                onDismiss={() => setLaunchStatus(null)}
              />

              <LogsPanel logs={logs} onClear={clearAllLogs} defaultSource="launch" />

              <ClientDetailsDialog
                open={detailsOpen}
                onOpenChange={setDetailsOpen}
                client={selectedClientData}
                clientStats={clientStats}
                clientStatsLoading={clientStatsLoading}
                lastPlayedText={lastPlayedText}
                storageText={formatBytes(clientStats?.totalBytes ?? 0)}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                onRename={handleRename}
                modsEntries={modsEntries}
                modsLoading={modsLoading}
                modsError={modsError}
                onOpenClientFolder={handleOpenFolder}
                onCreateShortcut={handleCreateShortcut}
                onDeleteClient={() => {
                  if (!selectedClientData) return
                  void handleDelete(selectedClientData.id)
                }}
              />

              <LinkOptionsDialog
                open={linksOpen}
                onOpenChange={setLinksOpen}
                client={selectedClientData}
                onToggleLink={handleToggleLink}
                onSetPluginsMode={handleSetPluginsMode}
              />

              <RefsDialog
                open={toolsOpen}
                onOpenChange={setToolsOpen}
                client={selectedClientData}
                onOpenClientFolder={handleOpenFolder}
                onOpenClientPluginsFolder={() => {
                  if (!selectedClientData) return
                  window.api.openClientPluginsFolder(selectedClientData.id)
                }}
                onOpenFiveMFolder={() => window.api.openFiveMFolder()}
                onOpenFiveMPluginsFolder={() => window.api.openFiveMPluginsFolder()}
                onOpenCitizenFxFolder={() => window.api.openCitizenFxFolder()}
              />

              <GtaSettingsDialog
                open={gtaSettingsOpen}
                onOpenChange={setGtaSettingsOpen}
                selectedClientId={selectedClientData?.id ?? null}
                rootName={gtaSettingsRoot}
                items={gtaSettingsItems}
                loading={gtaSettingsLoading}
                error={gtaSettingsError}
                dirty={gtaSettingsDirty}
                onImportFromGame={handleImportGtaSettings}
                onLoadFullExample={handleLoadFullExample}
                onSave={handleSaveGtaSettings}
                onUpdateAttribute={handleUpdateGtaAttribute}
              />
            </div>
          </div>
        </div>

        <AppFooter
          repoUrl={repoUrl}
          commitInfo={commitInfo}
          updateStatus={updateStatus}
          onResetFirstRun={handleResetFirstRun}
          showDevResetFirstRun={import.meta.env.DEV}
        />
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App

import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Settings as SettingsIcon,
  Plus,
  Play,
  Info,
  Link2,
  Wrench,
  FolderOpen,
  Save,
  Minus,
  Square,
  X
} from 'lucide-react'
import type {
  ClientProfile,
  LinkOptions,
  GtaSettingsItem,
  ClientStats,
  AppLogEntry,
  GameBusyState
} from '@/types'
import { getSettingDefinition, SETTING_CATEGORIES, type SettingOption } from '@shared/gtaSettingsMap'
import appLogo from '../../../resources/Logo.png'
import { LogsPanel } from '@/components/LogsPanel'

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
  const selectedClientData = clients.find((c) => c.id === selectedClient) || null

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

  const renderLaunchProgress = () => {
    if (!launchStatus) return null

    const isError = launchStatus.startsWith('Error:')
    const isWaitingForSync = /Waiting for plugins sync/i.test(launchStatus)

    const steps = [
      { key: 'prepare', label: 'Prepare', match: /Preparing/i },
      { key: 'wait', label: 'Wait', match: /Waiting for plugins sync/i },
      { key: 'link', label: 'Link', match: /Linking/i },
      { key: 'settings', label: 'Settings', match: /(Applying GTA settings|GTA Settings|Finalizing settings)/i },
      { key: 'start', label: 'Start', match: /Starting FiveM/i },
      { key: 'done', label: 'Done', match: /Launched!/i }
    ]

    const currentIndex = isError
      ? -1
      : Math.max(
          0,
          steps.findIndex((s) => s.match.test(launchStatus))
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
                  {steps.slice(0, 5).map((step, idx) => {
                    const completed = idx < currentIndex
                    const active = idx === currentIndex
                    const base = 'h-2.5 w-2.5 rounded-full transition-colors'

                    if (isDone) {
                      return (
                        <div
                          key={step.key}
                          className={`${base} bg-emerald-500/90`}
                          title={step.label}
                        />
                      )
                    }

                    if (completed) {
                      return (
                        <div
                          key={step.key}
                          className={`${base} bg-primary/80`}
                          title={step.label}
                        />
                      )
                    }

                    if (active) {
                      return (
                        <div
                          key={step.key}
                          className={`${base} bg-primary animate-pulse`}
                          title={step.label}
                        />
                      )
                    }

                    return (
                      <div
                        key={step.key}
                        className={`${base} bg-muted`}
                        title={step.label}
                      />
                    )
                  })}
                </div>
              )}

              {isError && (
                <div className="h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
              {isDone && (
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              )}

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
              onClick={() => setLaunchStatus(null)}
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
    const updated: LinkOptions = {
      ...selectedClientData.linkOptions,
      [key]: !selectedClientData.linkOptions[key]
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    const value = bytes / 1024 ** index
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
  }

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

  const renderAttributeInput = (
    item: GtaSettingsItem,
    settingName: string,
    attrKey: string,
    value: string,
    showLabel = true
  ) => {
    const settingDef = getSettingDefinition(settingName)

    // If we have a definition with options, use a select dropdown
    if (settingDef?.type === 'select' && settingDef.options) {
      return (
        <div className="flex flex-col gap-1">
          {showLabel && <span className="text-xs font-medium text-muted-foreground">{humanizeKey(settingName)}</span>}
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={value}
            onChange={(e) => handleUpdateGtaAttribute(item.id, attrKey, e.target.value)}
          >
            {settingDef.options.map((opt: SettingOption) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )
    }

    // If it's a slider, render range input
    if (settingDef?.type === 'slider') {
      const numValue = parseFloat(value) || 0
      return (
        <div className="flex flex-col gap-1">
          {showLabel && <span className="text-xs font-medium text-muted-foreground">{humanizeKey(settingName)}</span>}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={settingDef.min}
              max={settingDef.max}
              step={settingDef.step}
              value={numValue}
              className="flex-1"
              onChange={(e) => handleUpdateGtaAttribute(item.id, attrKey, e.target.value)}
            />
            <span className="text-xs font-mono text-muted-foreground w-12 text-right">
              {numValue.toFixed(2)}
            </span>
          </div>
        </div>
      )
    }

    // Fallback to text/number input for unmapped settings
    const numeric = Number(value)
    const isNumeric = !Number.isNaN(numeric) && value.trim() !== ''
    const step = Number.isInteger(numeric) ? 1 : 0.01

    return (
      <div className="flex flex-col gap-1">
        {showLabel && <span className="text-xs font-medium text-muted-foreground">{humanizeKey(settingName)}</span>}
        <Input
          type={isNumeric ? 'number' : 'text'}
          value={value}
          step={isNumeric ? step : undefined}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            handleUpdateGtaAttribute(item.id, attrKey, e.target.value)
          }
        />
      </div>
    )
  }

  const humanizeKey = (value: string) =>
    value
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()

  // Group settings by category from the settings map
  const categorizedSettings = useMemo(() => {
    const categories: Record<string, GtaSettingsItem[]> = {}

    gtaSettingsItems.forEach((item) => {
      const parts = item.path.split('/').filter(Boolean)
      const settingName = parts[parts.length - 1]

      // Get the first attribute key to look up the setting definition
      const firstAttrKey = Object.keys(item.attributes)[0]
      const settingDef = getSettingDefinition(settingName || firstAttrKey)

      const category = settingDef?.category || 'Other'

      if (!categories[category]) {
        categories[category] = []
      }
      categories[category].push(item)
    })

    // Sort categories by predefined order
    const sorted: Record<string, GtaSettingsItem[]> = {}
    SETTING_CATEGORIES.forEach((cat: string) => {
      if (categories[cat] && categories[cat].length > 0) {
        sorted[cat] = categories[cat]
      }
    })

    // Add any uncategorized at the end
    if (categories['Other'] && categories['Other'].length > 0) {
      sorted['Other'] = categories['Other']
    }

    return sorted
  }, [gtaSettingsItems])

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
        <div className="titlebar fixed left-0 top-0 z-50 flex h-12 w-full items-center justify-between border-b border-border bg-card px-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <img
              src={appLogo}
              alt="FiveLaunch"
              className="h-5 w-auto opacity-90 brightness-0 invert"
            />
            <span>FiveLaunch</span>
          </div>
          <div className="flex items-center gap-1">
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
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
                  <DialogDescription>
                    Set the default FiveM game data location (FiveM.app).
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-3">
                  <Input
                    placeholder="C:\\Users\\...\\AppData\\Local\\FiveM\\FiveM.app"
                    value={gamePath}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGamePath(e.target.value)}
                  />

                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={minimizeToTrayOnGameLaunch}
                      onChange={(e) => setMinimizeToTrayOnGameLaunch(e.target.checked)}
                    />
                    <div className="space-y-0.5">
                      <div className="font-medium text-foreground">
                        Minimize to system tray on game launch
                      </div>
                      <div className="text-xs text-muted-foreground">
                        When you launch a client, FiveLaunch will hide to the tray. Click the tray icon to restore.
                      </div>
                    </div>
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="secondary" onClick={handleBrowseGamePath}>
                          <FolderOpen className="h-4 w-4" />
                          Browse
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Pick your FiveM.app folder</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={handleSaveGamePath} disabled={!gamePath.trim()}>
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
                  onClick={() => window.api.windowMinimize()}
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
                  onClick={() => window.api.windowToggleMaximize()}
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
                  onClick={() => window.api.windowClose()}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-h-screen flex-col pt-12">
        <Dialog
          open={firstRunOpen}
          onOpenChange={(open) => {
            if (!open) {
              localStorage.setItem('fivelaunch.firstRunAck', 'true')
            }
            setFirstRunOpen(open)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Welcome to FiveLaunch</DialogTitle>
              <DialogDescription>
                Before linking files, please back up your original FiveM data. We will rename
                existing folders and settings files the first time you link a client.
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
                    GTA V settings: <span className="text-foreground">%USERPROFILE%\Documents\Rockstar Games\GTA V\settings.xml</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="secondary" onClick={() => window.api.openCitizenFxFolder()}>
                        <FolderOpen className="h-4 w-4" />
                        Open CitizenFX Folder
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Opens %APPDATA%\\CitizenFX</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="secondary" onClick={() => window.api.openFiveMFolder()}>
                        <FolderOpen className="h-4 w-4" />
                        Open FiveM Folder
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Opens %LOCALAPPDATA%\\FiveM\\FiveM.app</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button onClick={handleFirstRunContinue}>I Understand</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-6 pt-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">FiveLaunch Clients</h1>
              <p className="text-sm text-muted-foreground">
                Create profiles, manage links, and launch FiveM.
              </p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                  <DialogDescription>
                    Give your client a name. You can edit details later.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="New client name"
                    value={newClientName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setNewClientName(e.target.value)
                    }
                  />
                  <Button onClick={handleCreate} disabled={!newClientName.trim()}>
                    Create
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Client List</CardTitle>
                    <CardDescription>Search and select a profile.</CardDescription>
                  </div>
                  <div className="rounded-full border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                    {clients.length} total
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <Input
                  placeholder="Search by name or id…"
                  value={clientQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientQuery(e.target.value)}
                />

                {clients.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No clients yet. Create one to get started.
                  </div>
                )}

                {clients.length > 0 && filteredClients.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    No matches for “{clientQuery.trim()}”.
                  </div>
                )}

                <div className="space-y-2">
                  {filteredClients.map((client) => {
                    const selected = selectedClient === client.id
                    return (
                      <button
                        key={client.id}
                        className={`group w-full rounded-md border px-3 py-2 text-left text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? 'border-primary/60 bg-primary/10 text-foreground shadow-sm'
                            : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/30 hover:text-foreground'
                        }`}
                        onClick={() => setSelectedClient((prev) => (prev === client.id ? null : client.id))}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{client.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{client.id}</div>
                          </div>
                          <div
                            className={`h-2.5 w-2.5 rounded-full transition-colors ${
                              selected ? 'bg-primary' : 'bg-muted group-hover:bg-primary/70'
                            }`}
                            aria-hidden="true"
                          />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Launch</CardTitle>
                  <CardDescription>
                    {selectedClientData ? 'Select options from the buttons below.' : 'Select a client to launch.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!selectedClientData ? (
                    <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                      <div className="font-medium text-foreground">No client selected</div>
                      <div className="mt-1">Pick a client from the list on the left.</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1">
                        <div className="text-lg font-semibold text-foreground">{selectedClientData.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{selectedClientData.id}</div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button disabled={!canLaunch} onClick={handleLaunch}>
                                <Play className="h-4 w-4" />
                                Launch
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {launchDisabledReason ?? 'Launch FiveM using this client'}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="secondary" onClick={() => setDetailsOpen(true)}>
                              <Info className="h-4 w-4" />
                              Details
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Rename, stats, delete</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="secondary" onClick={() => setLinksOpen(true)}>
                              <Link2 className="h-4 w-4" />
                              Link Options
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Choose what gets linked into FiveM.app</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="secondary" onClick={() => setToolsOpen(true)}>
                              <Wrench className="h-4 w-4" />
                              Tools
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Utilities (folders, shortcuts, etc.)</TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Files: {clientStatsLoading ? 'Loading…' : `${clientStats?.fileCount ?? 0}`}
                        {' · '}Storage: {clientStatsLoading ? 'Loading…' : formatBytes(clientStats?.totalBytes ?? 0)}
                        {' · '}Last played: {lastPlayedText}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {renderLaunchProgress()}

              <LogsPanel logs={logs} onClear={clearAllLogs} defaultSource="launch" />

              <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Client Details</DialogTitle>
                    <DialogDescription>Rename, view stats, and delete the client.</DialogDescription>
                  </DialogHeader>

                  {!selectedClientData ? (
                    <div className="mt-4 text-sm text-muted-foreground">Select a client first.</div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-md border border-border p-4 text-sm">
                        <div className="grid gap-2 text-muted-foreground">
                          <div>
                            <span className="text-foreground">Name:</span> {selectedClientData.name}
                          </div>
                          <div>
                            <span className="text-foreground">Client ID:</span>{' '}
                            <span className="font-mono text-xs">{selectedClientData.id}</span>
                          </div>
                          <div>
                            <span className="text-foreground">Files:</span>{' '}
                            {clientStatsLoading ? 'Loading…' : `${clientStats?.fileCount ?? 0} files`}
                          </div>
                          <div>
                            <span className="text-foreground">Storage:</span>{' '}
                            {clientStatsLoading ? 'Loading…' : formatBytes(clientStats?.totalBytes ?? 0)}
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
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value)}
                        />
                        <Button
                          variant="secondary"
                          onClick={handleRename}
                          disabled={!renameValue.trim()}
                        >
                          Rename
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button variant="secondary" onClick={() => setDetailsOpen(false)}>
                          Close
                        </Button>
                        <Button variant="destructive" onClick={() => handleDelete(selectedClientData.id)}>
                          Delete Client
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              <Dialog open={linksOpen} onOpenChange={setLinksOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Link Options</DialogTitle>
                    <DialogDescription>Choose what is linked into FiveM.app when launching.</DialogDescription>
                  </DialogHeader>

                  {!selectedClientData ? (
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
                        const enabled = !!selectedClientData.linkOptions?.[key]
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleToggleLink(key)}
                            className={`flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              enabled
                                ? 'border-primary/50 bg-primary/10'
                                : 'border-border bg-card hover:bg-muted/30'
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

                      {!!selectedClientData.linkOptions?.plugins && (
                        <div className="mt-2 rounded-md border border-border bg-card px-3 py-2">
                          <div className="text-sm font-medium text-foreground">Plugins mode</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Use <span className="text-foreground">Copy/Sync</span> if you want ReShade to work directly
                            under <span className="text-foreground">%LOCALAPPDATA%\FiveM\FiveM.app\plugins</span> (so
                            the in-game “Open folder” points there). Junction is faster, but Windows apps often resolve
                            the junction to the client folder.
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleSetPluginsMode('junction')}
                              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                                (selectedClientData.linkOptions.pluginsMode ?? 'junction') === 'junction'
                                  ? 'border-primary/60 bg-primary/10 text-foreground'
                                  : 'border-border bg-card hover:bg-muted/30 text-muted-foreground'
                              }`}
                            >
                              Junction (fast)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetPluginsMode('sync')}
                              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                                (selectedClientData.linkOptions.pluginsMode ?? 'junction') === 'sync'
                                  ? 'border-primary/60 bg-primary/10 text-foreground'
                                  : 'border-border bg-card hover:bg-muted/30 text-muted-foreground'
                              }`}
                            >
                              Copy/Sync (ReShade uses FiveM.app path)
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex justify-end">
                        <Button variant="secondary" onClick={() => setLinksOpen(false)}>
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Tools</DialogTitle>
                    <DialogDescription>Utilities for the selected client.</DialogDescription>
                  </DialogHeader>

                  <div className="mt-4 flex flex-col gap-2">
                    <Button
                      variant="secondary"
                      disabled={!selectedClientData}
                      onClick={handleOpenFolder}
                    >
                      Open Client Folder
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!selectedClientData}
                      onClick={handleCreateShortcut}
                    >
                      Create Desktop Shortcut
                    </Button>

                    <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                      If <span className="text-foreground">Plugins</span> is linked, then
                      <span className="text-foreground"> %LOCALAPPDATA%\FiveM\FiveM.app\plugins</span> is a
                      junction pointing at this client&apos;s plugins folder. ReShade&apos;s in-game
                      “Open folder” will often open the real client folder.
                    </div>

                    <Button variant="secondary" onClick={() => window.api.openFiveMPluginsFolder()}>
                      Open FiveM Plugins Folder
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!selectedClientData}
                      onClick={() =>
                        selectedClientData ? window.api.openClientPluginsFolder(selectedClientData.id) : undefined
                      }
                    >
                      Open Client Plugins Folder
                    </Button>
                    <Button variant="secondary" onClick={() => window.api.openFiveMFolder()}>
                      Open FiveM Folder
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!selectedClientData}
                      onClick={() => {
                        setToolsOpen(false)
                        setGtaSettingsOpen(true)
                      }}
                    >
                      Edit GTA Settings
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={gtaSettingsOpen} onOpenChange={setGtaSettingsOpen}>
                <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>GTA V Settings Editor</DialogTitle>
                    <DialogDescription>
                      Edit this client&apos;s settings.xml. These values are saved in the
                      client folder and copied into Documents when you launch with GTA
                      Settings enabled.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>Root element:</span>
                      <span className="font-medium text-foreground">{gtaSettingsRoot}</span>
                      <span className="text-muted-foreground">·</span>
                      <span>{gtaSettingsItems.length} entries</span>
                    </div>

                    {gtaSettingsError && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                        {gtaSettingsError}
                      </div>
                    )}

                    {!gtaSettingsLoading && !gtaSettingsError && (
                      <div className="space-y-4">
                        {Object.keys(categorizedSettings).length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                            No settings found in settings.xml.
                          </div>
                        ) : (
                          Object.entries(categorizedSettings).map(([category, items]) => (
                            <div key={category} className="rounded-md border border-border p-4">
                              <div className="mb-3 flex items-center gap-2">
                                <div className="h-1 w-1 rounded-full bg-primary" />
                                <div className="text-sm font-semibold text-foreground">{category}</div>
                                <div className="text-xs text-muted-foreground">({items.length})</div>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                {items.map((item) => {
                                  const parts = item.path.split('/').filter(Boolean)
                                  const settingName = parts[parts.length - 1]
                                  const entries = Object.entries(item.attributes)

                                  return entries.map(([attrKey, value]) => (
                                    <div
                                      key={`${item.id}-${attrKey}`}
                                      className="rounded-md border border-border bg-card p-3"
                                    >
                                      {renderAttributeInput(item, settingName, attrKey, value, true)}
                                    </div>
                                  ))
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          disabled={!selectedClientData || gtaSettingsLoading}
                          onClick={handleImportGtaSettings}
                        >
                          Import from Game
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!selectedClientData || gtaSettingsLoading}
                          onClick={handleLoadFullExample}
                        >
                          Load Full Example
                        </Button>
                        <Button
                          variant="default"
                          disabled={!selectedClientData || !gtaSettingsDirty || gtaSettingsLoading}
                          onClick={handleSaveGtaSettings}
                        >
                          Save Changes
                        </Button>
                      </div>
                      <Button variant="secondary" onClick={() => setGtaSettingsOpen(false)}>
                        Close
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        <footer className="mx-auto mt-auto flex w-full max-w-5xl flex-col items-start justify-between gap-2 border-t border-border px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
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
                  updateStatus.latestVersion
                    ? `Update available: v${updateStatus.latestVersion}`
                    : 'Update available'
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
            {import.meta.env.DEV && (
              <button
                onClick={handleResetFirstRun}
                className="hover:text-foreground"
                type="button"
              >
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
              Commit {commitInfo.shortSha} ·{' '}
              {commitInfo.date ? new Date(commitInfo.date).toLocaleDateString() : '—'}
            </a>
          ) : (
            <span className="text-muted-foreground">Commit info available in build</span>
          )}
        </footer>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App

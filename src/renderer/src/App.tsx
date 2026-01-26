import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import type { ClientProfile, LinkOptions, GtaSettingsItem, ClientStats } from '@/types'
import { getSettingDefinition, SETTING_CATEGORIES, type SettingOption } from '@shared/gtaSettingsMap'
import appLogo from '../../../resources/Logo.png'

function App(): JSX.Element {
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [newClientName, setNewClientName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [firstRunOpen, setFirstRunOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [gamePath, setGamePath] = useState('')
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
  const selectedClientData = clients.find((c) => c.id === selectedClient) || null

  useEffect(() => {
    if (!window.api) return
    loadClients()
  }, [])

  useEffect(() => {
    const acknowledged = localStorage.getItem('fivelaunch.firstRunAck')
    if (!acknowledged) {
      setFirstRunOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!window.api) return
    window.api.getSettings().then((settings) => {
      setGamePath(settings.gamePath || '')
    })
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
      if (status === 'Launched!') {
        setTimeout(() => {
          setLaunchStatus(null)
          setIsLaunching(false)
        }, 2000)
      }
    })
    return () => unsubscribe()
  }, [])

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

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
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

  const handleOpenFolder = async () => {
    if (!selectedClient) return
    await window.api.openClientFolder(selectedClient)
  }

  const handleBrowseGamePath = async () => {
    const selected = await window.api.browseGamePath()
    if (selected) setGamePath(selected)
  }

  const handleSaveGamePath = async () => {
    if (!gamePath.trim()) return
    await window.api.setGamePath(gamePath.trim())
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

  const handleToggleLink = async (key: keyof LinkOptions) => {
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
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                aria-label="Settings"
              >
                ⚙
              </Button>
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
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={handleBrowseGamePath}>
                    Browse
                  </Button>
                  <Button onClick={handleSaveGamePath} disabled={!gamePath.trim()}>
                    Save
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => window.api.windowMinimize()}
          >
            —
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => window.api.windowToggleMaximize()}
          >
            □
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => window.api.windowClose()}
          >
            ✕
          </Button>
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
                  <Button variant="secondary" onClick={() => window.api.openCitizenFxFolder()}>
                    Open CitizenFX Folder
                  </Button>
                  <Button variant="secondary" onClick={() => window.api.openFiveMFolder()}>
                    Open FiveM Folder
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button onClick={handleFirstRunContinue}>I Understand</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pb-6 pt-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">FiveLaunch Clients</h1>
              <p className="text-sm text-muted-foreground">
                Create profiles, manage links, and launch FiveM.
              </p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" aria-label="Create client">
                  + New Client
                </Button>
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

          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client List</CardTitle>
                <CardDescription>Pick a client to view details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {clients.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No clients yet. Create one to get started.
                  </div>
                )}
                {clients.map((client) => (
                  <button
                    key={client.id}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedClient === client.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() =>
                      setSelectedClient((prev) => (prev === client.id ? null : client.id))
                    }
                  >
                    <div className="font-medium text-foreground">{client.name}</div>
                    <div className="text-xs text-muted-foreground">{client.id}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client Overview</CardTitle>
                <CardDescription>Review and launch your selected client.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border border-border p-4 text-sm">
                  <div className="grid gap-2 text-muted-foreground">
                    <div>
                      <span className="text-foreground">Name:</span>{' '}
                      {selectedClientData?.name || '—'}
                    </div>
                    <div>
                      <span className="text-foreground">Files:</span>{' '}
                      {clientStatsLoading
                        ? 'Loading...'
                        : selectedClientData
                          ? `${clientStats?.fileCount ?? 0} files`
                          : '—'}
                    </div>
                    <div>
                      <span className="text-foreground">Storage:</span>{' '}
                      {clientStatsLoading
                        ? 'Loading...'
                        : selectedClientData
                          ? formatBytes(clientStats?.totalBytes ?? 0)
                          : '—'}
                    </div>
                    <div>
                      <span className="text-foreground">Last Played:</span> {lastPlayedText}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="secondary" disabled={!selectedClientData}>
                        Client Options
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Client Options</DialogTitle>
                        <DialogDescription>
                          Configure links, rename the client, or open the client folder.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="mt-4 space-y-4">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            placeholder="Rename client"
                            value={renameValue}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setRenameValue(e.target.value)
                            }
                            disabled={!selectedClientData}
                          />
                          <Button
                            variant="secondary"
                            onClick={handleRename}
                            disabled={!selectedClientData || !renameValue.trim()}
                          >
                            Rename
                          </Button>
                        </div>

                        <div className="rounded-md border border-border p-4 text-sm">
                          <div className="font-medium">Link Options</div>
                          <div className="mt-3 grid gap-2 text-muted-foreground">
                            {(
                              [
                                ['mods', 'Mods'],
                                ['plugins', 'Plugins'],
                                ['citizen', 'Citizen'],
                                ['gtaSettings', 'GTA Settings (settings.xml in Documents)'],
                                ['citizenFxIni', 'CitizenFX.ini']
                              ] as const
                            ).map(([key, label]) => (
                              <label key={key} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-primary"
                                  disabled={!selectedClientData}
                                  checked={!!selectedClientData?.linkOptions?.[key]}
                                  onChange={() => handleToggleLink(key)}
                                />
                                <span>{label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            disabled={!selectedClientData}
                            onClick={handleOpenFolder}
                          >
                            Open Client Folder
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!selectedClientData}
                            onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
                              selectedClientData && handleDelete(selectedClientData.id, e)
                            }
                          >
                            Delete Client
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={gtaSettingsOpen} onOpenChange={setGtaSettingsOpen}>
                    <DialogTrigger asChild>
                      <Button variant="secondary" disabled={!selectedClientData}>
                        Edit GTA Settings
                      </Button>
                    </DialogTrigger>
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
                                    <div className="text-sm font-semibold text-foreground">
                                      {category}
                                    </div>
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

                  <Button disabled={!selectedClientData || isLaunching} onClick={handleLaunch}>
                    Launch Game
                  </Button>
                  {launchStatus && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {isLaunching && launchStatus !== 'Launched!' && (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      )}
                      <span>{launchStatus}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <footer className="mx-auto mt-auto flex w-full max-w-5xl flex-col items-start justify-between gap-2 border-t border-border px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <span>© {new Date().getFullYear()} FiveLaunch</span>
            <a href={repoUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
              Open Source
            </a>
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
  )
}

export default App

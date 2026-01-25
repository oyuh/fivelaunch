import { useState, useEffect } from 'react'
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
import type { ClientProfile, LinkOptions } from '@/types'

function App(): JSX.Element {
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [newClientName, setNewClientName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [firstRunOpen, setFirstRunOpen] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    const acknowledged = localStorage.getItem('fivelaunch.firstRunAck')
    if (!acknowledged) {
      setFirstRunOpen(true)
    }
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

  const handleLaunch = () => {
    if (selectedClient) {
      console.log(`Launching client: ${selectedClient}`)
      window.api.launchClient(selectedClient)
    }
  }

  const handleOpenFolder = async () => {
    if (!selectedClient) return
    await window.api.openClientFolder(selectedClient)
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

  const selectedClientData = clients.find((c) => c.id === selectedClient) || null
  useEffect(() => {
    setRenameValue(selectedClientData?.name || '')
  }, [selectedClientData?.id])
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

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="titlebar fixed left-0 top-0 z-50 flex h-10 w-full items-center justify-between border-b border-border bg-card px-3">
        <div className="text-sm font-semibold">FiveLaunch</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => window.api.windowMinimize()}>
            _
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.api.windowToggleMaximize()}>
            □
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.api.windowClose()}>
            ×
          </Button>
        </div>
      </div>

      <div className="p-6 pt-16">
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
                  <li>GTA settings: gta5_settings.xml</li>
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
        <div className="mx-auto max-w-5xl">
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
                      <span className="text-foreground">ID:</span>{' '}
                      {selectedClientData?.id || '—'}
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
                                ['gtaSettings', 'GTA Settings (gta5_settings.xml)'],
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

                  <Button disabled={!selectedClientData} onClick={handleLaunch}>
                    Launch Game
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <footer className="mx-auto mt-8 flex max-w-5xl flex-col items-start justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
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

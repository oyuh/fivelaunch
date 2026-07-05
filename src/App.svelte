<script lang="ts">
  import { onMount } from 'svelte'
  import TitleBar from './lib/components/TitleBar.svelte'
  import SettingsDialog from './lib/components/SettingsDialog.svelte'
  import FirstRunDialog from './lib/components/FirstRunDialog.svelte'
  import RefsDialog from './lib/components/RefsDialog.svelte'
  import ClientDetailsDialog from './lib/components/ClientDetailsDialog.svelte'
  import GtaSettingsDialog from './lib/components/GtaSettingsDialog.svelte'
  import HistoryDialog from './lib/components/HistoryDialog.svelte'
  import LogsPanel from './lib/components/LogsPanel.svelte'
  import { api } from './lib/api'
  import { formatBytes } from './lib/format'
  import { applyPrimaryHexToRoot, DEFAULT_PRIMARY_HEX } from './lib/theme'
  import type { AppLogEntry, ClientProfile, ClientStats, UpdateStatus } from './lib/types'

  const FIRST_RUN_ACK_KEY = 'fivelaunch.firstRunAck'

  let clients = $state<ClientProfile[]>([])
  let selectedId = $state<string | null>(null)
  let query = $state('')
  let newName = $state('')
  let renameValue = $state('')
  let renaming = $state(false)
  let confirmingDelete = $state(false)
  let stats = $state<ClientStats | null>(null)
  let appVersion = $state('')
  let resolvedGamePath = $state<string | null>(null)
  let error = $state<string | null>(null)
  let launching = $state(false)
  let launchStatus = $state<string | null>(null)
  let pluginsSyncBusy = $state(false)

  // Dialogs / panels
  let settingsOpen = $state(false)
  let firstRunOpen = $state(false)
  let refsOpen = $state(false)
  let detailsOpen = $state(false)
  let gtaSettingsOpen = $state(false)
  let historyOpen = $state(false)
  let logsOpen = $state(false)

  // Log store: launch-status events + main-process logs (app-log events).
  let logs = $state<AppLogEntry[]>([])
  let logSeq = 0
  let updateStatus = $state<UpdateStatus | null>(null)

  function pushLog(message: string): void {
    logSeq += 1
    const level: AppLogEntry['level'] = message.startsWith('WARNING')
      ? 'warn'
      : message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')
        ? 'error'
        : 'info'
    logs = [...logs, { id: logSeq, ts: Date.now(), level, message, source: 'launch' }]
    if (logs.length > 1000) logs = logs.slice(logs.length - 1000)
  }

  function pushMainLog(entry: { id: number; ts: number; level: AppLogEntry['level']; message: string }): void {
    // Main-process ids are their own sequence; offset to keep keys unique.
    logs = [...logs, { ...entry, id: entry.ts + entry.id, source: 'main' }]
    if (logs.length > 1600) logs = logs.slice(logs.length - 1600)
  }

  async function clearLogs(): Promise<void> {
    logs = []
    try {
      await api.clearAppLogs()
    } catch {
      // ignore
    }
  }

  const filtered = $derived(
    clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  )
  const selected = $derived(clients.find((c) => c.id === selectedId) ?? null)

  type LinkKey = 'mods' | 'plugins' | 'citizen' | 'gtaSettings' | 'citizenFxIni'

  const linkChips = $derived.by(() => {
    if (!selected) return []
    const o = selected.linkOptions
    const chips: { key: LinkKey; label: string; on: boolean; hint: string }[] = [
      { key: 'mods', label: 'Mods', on: o.mods, hint: 'Link the mods folder' },
      {
        key: 'plugins',
        label: `Plugins${o.plugins ? ` (${o.pluginsMode ?? 'sync'})` : ''}`,
        on: o.plugins,
        hint: 'Click to cycle: off → sync (copy) → junction → off'
      },
      { key: 'citizen', label: 'Citizen', on: o.citizen, hint: 'Link the citizen folder (advanced)' },
      {
        key: 'gtaSettings',
        label: 'GTA settings',
        on: o.gtaSettings,
        hint: 'Apply + enforce this client’s gta5_settings.xml'
      },
      {
        key: 'citizenFxIni',
        label: 'CitizenFX.ini',
        on: o.citizenFxIni,
        hint: 'Seed + sync this client’s CitizenFX.ini'
      }
    ]
    return chips
  })

  async function toggleLink(key: LinkKey): Promise<void> {
    if (!selected) return
    const o = { ...selected.linkOptions }
    if (key === 'plugins') {
      // Cycle: off -> sync (copy) -> junction -> off
      if (!o.plugins) {
        o.plugins = true
        o.pluginsMode = 'sync'
      } else if ((o.pluginsMode ?? 'sync') === 'sync') {
        o.pluginsMode = 'junction'
      } else {
        o.plugins = false
      }
    } else {
      o[key] = !o[key]
    }
    try {
      await api.updateClientLinks(selected.id, o)
      await refresh()
    } catch (e) {
      error = String(e)
    }
  }

  async function refresh(): Promise<void> {
    clients = await api.getClients()
    if (selectedId && !clients.some((c) => c.id === selectedId)) {
      selectedId = null
    }
  }

  onMount(() => {
    firstRunOpen = localStorage.getItem(FIRST_RUN_ACK_KEY) !== 'true'

    let unlistenFn: (() => void) | null = null
    api
      .onLaunchStatus((status) => {
        launchStatus = status
        pushLog(status)
      })
      .then((fn) => (unlistenFn = fn))
      .catch(() => {})

    let unlistenAppLog: (() => void) | null = null
    api
      .onAppLog((entry) => pushMainLog(entry))
      .then((fn) => (unlistenAppLog = fn))
      .catch(() => {})

    // Backfill main-process logs from before the UI was ready, then check
    // for updates (notify-only, cached 15 minutes backend-side).
    api
      .getAppLogs()
      .then((entries) => entries.forEach((e) => pushMainLog(e)))
      .catch(() => {})
    api
      .getUpdateStatus()
      .then((status) => (updateStatus = status))
      .catch(() => {})

    const pollBusy = () => {
      api
        .getGameBusyState()
        .then((s) => (pluginsSyncBusy = s.pluginsSyncBusy))
        .catch(() => {})
    }
    pollBusy()
    const busyTimer = setInterval(pollBusy, 3000)

    void (async () => {
      try {
        const settings = await api.getSettings()
        applyPrimaryHexToRoot(settings.themePrimaryHex ?? DEFAULT_PRIMARY_HEX)
        ;[appVersion, resolvedGamePath] = await Promise.all([
          api.getAppVersion(),
          api.getResolvedGamePath()
        ])
        await refresh()
      } catch (e) {
        error = String(e)
      }
    })()

    return () => {
      clearInterval(busyTimer)
      unlistenFn?.()
      unlistenAppLog?.()
    }
  })

  async function launchSelected(): Promise<void> {
    if (!selected || launching) return
    launching = true
    launchStatus = 'Preparing launch...'
    try {
      await api.launchClient(selected.id)
    } catch (e) {
      error = String(e)
      launchStatus = null
    } finally {
      launching = false
    }
  }

  $effect(() => {
    const id = selectedId
    stats = null
    confirmingDelete = false
    renaming = false
    if (!id) return
    api
      .getClientStats(id)
      .then((s) => {
        if (selectedId === id) stats = s
      })
      .catch(() => {})
  })

  async function createClient(): Promise<void> {
    const name = newName.trim()
    if (!name) return
    try {
      const created = await api.createClient(name)
      newName = ''
      await refresh()
      selectedId = created.id
    } catch (e) {
      error = String(e)
    }
  }

  async function applyRename(): Promise<void> {
    if (!selected) return
    const name = renameValue.trim()
    if (!name || name === selected.name) {
      renaming = false
      return
    }
    try {
      await api.renameClient(selected.id, name)
      renaming = false
      await refresh()
    } catch (e) {
      error = String(e)
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selected) return
    if (!confirmingDelete) {
      confirmingDelete = true
      return
    }
    try {
      await api.deleteClient(selected.id)
      confirmingDelete = false
      await refresh()
    } catch (e) {
      error = String(e)
    }
  }

  function formatLastPlayed(ts?: number): string {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleString()
  }

  function acknowledgeFirstRun(): void {
    localStorage.setItem(FIRST_RUN_ACK_KEY, 'true')
    firstRunOpen = false
  }

  async function refreshResolvedPath(): Promise<void> {
    try {
      resolvedGamePath = await api.getResolvedGamePath()
    } catch {
      // ignore
    }
  }
</script>

<div class="flex h-screen flex-col bg-background text-foreground">
  <TitleBar {appVersion} onOpenSettings={() => (settingsOpen = true)} />

  <main class="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-4 p-4">
    <!-- Client list -->
    <section class="flex min-h-0 flex-col rounded-lg border border-border bg-card">
      <div class="border-b border-border p-3">
        <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Clients
        </h2>
        <input
          class="w-full rounded-md border border-input bg-secondary/40 px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          placeholder="Search clients..."
          bind:value={query}
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        {#if filtered.length === 0}
          <p class="px-2 py-6 text-center text-sm text-muted-foreground">
            {clients.length === 0 ? 'No clients yet. Create one below.' : 'No matches.'}
          </p>
        {:else}
          {#each filtered as client (client.id)}
            <button
              class="mb-1 flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors {selectedId ===
              client.id
                ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                : 'hover:bg-secondary/60'}"
              onclick={() => (selectedId = client.id)}
            >
              <span class="truncate text-sm font-medium">{client.name}</span>
              <span class="truncate text-xs text-muted-foreground">
                Last played: {formatLastPlayed(client.lastPlayed)}
              </span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="flex gap-2 border-t border-border p-3">
        <input
          class="min-w-0 flex-1 rounded-md border border-input bg-secondary/40 px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          placeholder="New client name"
          bind:value={newName}
          onkeydown={(e) => e.key === 'Enter' && createClient()}
        />
        <button
          class="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!newName.trim()}
          onclick={createClient}
        >
          Create
        </button>
      </div>
    </section>

    <!-- Overview -->
    <section class="flex min-h-0 flex-col rounded-lg border border-border bg-card">
      {#if !selected}
        <div class="flex flex-1 items-center justify-center">
          <p class="text-sm text-muted-foreground">Select a client to see its details.</p>
        </div>
      {:else}
        <div class="flex items-start justify-between border-b border-border p-4">
          <div class="min-w-0">
            {#if renaming}
              <div class="flex items-center gap-2">
                <input
                  class="rounded-md border border-input bg-secondary/40 px-3 py-1.5 text-lg font-semibold outline-none focus:ring-1 focus:ring-ring"
                  bind:value={renameValue}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') applyRename()
                    if (e.key === 'Escape') renaming = false
                  }}
                />
                <button
                  class="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
                  onclick={applyRename}
                >
                  Save
                </button>
              </div>
            {:else}
              <h1 class="truncate text-xl font-bold">{selected.name}</h1>
            {/if}
            <p class="mt-1 font-mono text-xs text-muted-foreground">{selected.id}</p>
          </div>

          <div class="flex shrink-0 gap-2 pl-4">
            <button
              class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onclick={() => {
                renameValue = selected?.name ?? ''
                renaming = true
              }}
            >
              Rename
            </button>
            <button
              class="rounded-md border px-3 py-1.5 text-sm transition-colors {confirmingDelete
                ? 'border-destructive bg-destructive text-destructive-foreground'
                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}"
              onclick={deleteSelected}
              onmouseleave={() => (confirmingDelete = false)}
            >
              {confirmingDelete ? 'Confirm delete?' : 'Delete'}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3 p-4">
          <div class="rounded-md border border-border bg-secondary/30 p-3">
            <p class="text-xs uppercase tracking-wider text-muted-foreground">Files</p>
            <p class="mt-1 text-lg font-semibold">
              {stats ? stats.fileCount.toLocaleString() : '…'}
            </p>
          </div>
          <div class="rounded-md border border-border bg-secondary/30 p-3">
            <p class="text-xs uppercase tracking-wider text-muted-foreground">Size</p>
            <p class="mt-1 text-lg font-semibold">{stats ? formatBytes(stats.totalBytes) : '…'}</p>
          </div>
          <div class="rounded-md border border-border bg-secondary/30 p-3">
            <p class="text-xs uppercase tracking-wider text-muted-foreground">Last played</p>
            <p class="mt-1 truncate text-lg font-semibold">
              {formatLastPlayed(selected.lastPlayed)}
            </p>
          </div>
        </div>

        <div class="px-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Linking
          </p>
          <div class="flex flex-wrap gap-2">
            {#each linkChips as chip (chip.key)}
              <button
                class="rounded-full border px-3 py-1 text-xs transition-colors {chip.on
                  ? 'border-primary/50 bg-primary/15 text-foreground hover:bg-primary/25'
                  : 'border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}"
                title={chip.hint}
                onclick={() => toggleLink(chip.key)}
              >
                {chip.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="mt-auto flex flex-wrap gap-2 p-4">
          <button
            class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onclick={() => (detailsOpen = true)}
          >
            Details
          </button>
          <button
            class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onclick={() => (gtaSettingsOpen = true)}
            title="Edit this client's gta5_settings.xml"
          >
            Edit GTA settings
          </button>
          <button
            class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onclick={() => (refsOpen = true)}
            title="Quick links to useful folders"
          >
            Refs
          </button>
          <button
            class="ml-auto rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={launching || pluginsSyncBusy}
            title={pluginsSyncBusy ? 'Waiting for the previous plugins sync to finish' : undefined}
            onclick={launchSelected}
          >
            {launching ? 'Launching…' : pluginsSyncBusy ? 'Sync busy…' : 'Launch'}
          </button>
        </div>

        {#if launchStatus}
          <div class="flex items-center gap-2 border-t border-border px-4 py-2">
            {#if launching}
              <span
                class="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary"
              ></span>
            {/if}
            <p
              class="truncate text-xs {launchStatus.startsWith('WARNING')
                ? 'text-destructive-foreground'
                : 'text-muted-foreground'}"
            >
              {launchStatus}
            </p>
          </div>
        {/if}
      {/if}
    </section>
  </main>

  {#if logsOpen}
    <div class="px-4 pb-2">
      <LogsPanel {logs} onClear={clearLogs} />
    </div>
  {/if}

  {#if error}
    <div class="mx-4 mb-2 rounded-md border border-destructive bg-destructive/20 px-3 py-2 text-sm">
      {error}
      <button class="ml-2 underline" onclick={() => (error = null)}>dismiss</button>
    </div>
  {/if}

  <footer
    class="flex h-8 shrink-0 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground"
  >
    <span class="flex items-center gap-2">
      FiveLaunch v{appVersion || '…'} (Tauri)
      {#if pluginsSyncBusy}
        <span class="rounded-full border border-primary/50 bg-primary/15 px-2 py-0.5 text-[10px]">
          plugins sync running
        </span>
      {/if}
      <button
        class="rounded px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground {logsOpen
          ? 'text-foreground'
          : ''}"
        onclick={() => (logsOpen = !logsOpen)}
      >
        Logs{logs.length ? ` (${logs.length})` : ''}
      </button>
      <button
        class="rounded px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground"
        title="Backups moved out of FiveM.app live here"
        onclick={() => (historyOpen = true)}
      >
        History
      </button>
      {#if updateStatus?.isUpdateAvailable && updateStatus.latestUrl}
        <button
          class="rounded-full border border-primary/50 bg-primary/15 px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-primary/25"
          title="Open the release page"
          onclick={() => updateStatus?.latestUrl && api.openUrl(updateStatus.latestUrl).catch(() => {})}
        >
          Update available: v{updateStatus.latestVersion}
        </button>
      {/if}
    </span>
    <span class="truncate pl-4 font-mono">
      {resolvedGamePath ?? 'FiveM not found — set the game path in settings'}
    </span>
  </footer>

  <SettingsDialog bind:open={settingsOpen} onSaved={refreshResolvedPath} />
  <FirstRunDialog bind:open={firstRunOpen} onContinue={acknowledgeFirstRun} />
  <RefsDialog bind:open={refsOpen} client={selected} />
  <ClientDetailsDialog bind:open={detailsOpen} client={selected} {stats} onChanged={refresh} />
  <GtaSettingsDialog bind:open={gtaSettingsOpen} clientId={selectedId} />
  <HistoryDialog bind:open={historyOpen} />
</div>

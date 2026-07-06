<script lang="ts">
  import { onMount } from 'svelte'
  import TitleBar from './lib/components/TitleBar.svelte'
  import SettingsDialog from './lib/components/SettingsDialog.svelte'
  import FirstRunDialog from './lib/components/FirstRunDialog.svelte'
  import ClientDetailsDialog from './lib/components/ClientDetailsDialog.svelte'
  import GtaSettingsDialog from './lib/components/GtaSettingsDialog.svelte'
  import HistoryDialog from './lib/components/HistoryDialog.svelte'
  import CreateClientDialog from './lib/components/CreateClientDialog.svelte'
  import UpdateDialog from './lib/components/UpdateDialog.svelte'
  import LogsPanel from './lib/components/LogsPanel.svelte'
  import Icon from './lib/components/ui/Icon.svelte'
  import IconButton from './lib/components/ui/IconButton.svelte'
  import Button from './lib/components/ui/Button.svelte'
  import Switch from './lib/components/ui/Switch.svelte'
  import Menu from './lib/components/ui/Menu.svelte'
  import MenuItem from './lib/components/ui/MenuItem.svelte'
  import ConfirmDialog from './lib/components/ui/ConfirmDialog.svelte'
  import StatItem from './lib/components/ui/StatItem.svelte'
  import { CLIENT_ICONS, DEFAULT_CLIENT_ICON, clientIconSvg } from './lib/components/ui/icons'
  import { tooltip } from './lib/actions/tooltip'
  import { api } from './lib/api'
  import { formatBytes } from './lib/format'
  import { applyPrimaryHexToRoot, DEFAULT_PRIMARY_HEX } from './lib/theme'
  import type { AppLogEntry, ClientProfile, ClientStats, UpdateStatus } from './lib/types'

  const FIRST_RUN_ACK_KEY = 'fivelaunch.firstRunAck'

  let clients = $state<ClientProfile[]>([])
  let selectedId = $state<string | null>(null)
  let query = $state('')
  let searchOpen = $state(false)
  let createOpen = $state(false)
  let renameValue = $state('')
  let renaming = $state(false)
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
  let detailsOpen = $state(false)
  let gtaSettingsOpen = $state(false)
  let historyOpen = $state(false)
  let deleteConfirmOpen = $state(false)
  let updateOpen = $state(false)
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

  type BoolLink = 'mods' | 'citizen' | 'gtaSettings' | 'citizenFxIni'
  type PluginsState = 'off' | 'sync' | 'junction'

  // Simple on/off linking toggles + their one-line explanations.
  const boolLinks: { key: BoolLink; label: string; hint: string }[] = [
    { key: 'mods', label: 'Mods', hint: 'Share this client’s mods folder with the game.' },
    { key: 'citizen', label: 'Citizen', hint: 'Link the citizen folder (advanced).' },
    { key: 'gtaSettings', label: 'GTA settings', hint: 'Apply this client’s graphics settings on launch.' },
    { key: 'citizenFxIni', label: 'CitizenFX.ini', hint: 'Keep this client’s CitizenFX.ini in sync.' }
  ]

  const pluginsState = $derived<PluginsState>(
    !selected?.linkOptions.plugins ? 'off' : (selected.linkOptions.pluginsMode ?? 'sync')
  )

  const pluginsLabel = $derived(
    pluginsState === 'off' ? 'Off' : pluginsState === 'junction' ? 'Junction' : 'Sync (copy)'
  )

  async function updateLinks(next: ClientProfile['linkOptions']): Promise<void> {
    if (!selected) return
    try {
      await api.updateClientLinks(selected.id, next)
      await refresh()
    } catch (e) {
      error = String(e)
    }
  }

  function setLinkBool(key: BoolLink, value: boolean): void {
    if (!selected) return
    void updateLinks({ ...selected.linkOptions, [key]: value })
  }

  function setPlugins(mode: PluginsState): void {
    if (!selected) return
    const o = { ...selected.linkOptions }
    if (mode === 'off') {
      o.plugins = false
    } else {
      o.plugins = true
      o.pluginsMode = mode
    }
    void updateLinks(o)
  }

  /** Open a folder (from the Folders dropdown), surfacing any error. */
  function openRef(action: Promise<void>): void {
    action.catch((e) => (error = String(e)))
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
    renaming = false
    if (!id) return
    api
      .getClientStats(id)
      .then((s) => {
        if (selectedId === id) stats = s
      })
      .catch(() => {})
  })

  async function onClientCreated(created: ClientProfile): Promise<void> {
    await refresh()
    selectedId = created.id
  }

  async function setIcon(key: string): Promise<void> {
    if (!selected) return
    try {
      await api.setClientIcon(selected.id, key)
      await refresh()
    } catch (e) {
      error = String(e)
    }
  }

  function startRename(): void {
    if (!selected) return
    renameValue = selected.name
    renaming = true
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
    try {
      await api.deleteClient(selected.id)
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
    <section class="flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface-1">
      <div class="flex items-center gap-1.5 border-b border-divider px-3 py-2.5">
        <h2 class="mr-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Clients
        </h2>
        <IconButton
          icon="search"
          label="Search clients"
          size="sm"
          active={searchOpen}
          onclick={() => {
            searchOpen = !searchOpen
            if (!searchOpen) query = ''
          }}
        />
        <IconButton icon="plus" label="New client" size="sm" onclick={() => (createOpen = true)} />
      </div>

      {#if searchOpen}
        <div class="border-b border-divider p-2">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="w-full rounded-md border border-input bg-surface-2 px-3 py-1.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
            placeholder="Search clients…"
            autofocus
            bind:value={query}
          />
        </div>
      {/if}

      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        {#if filtered.length === 0}
          <p class="px-2 py-6 text-center text-sm text-muted-foreground">
            {clients.length === 0 ? 'No clients yet. Click + to add one.' : 'No matches.'}
          </p>
        {:else}
          {#each filtered as client (client.id)}
            <button
              class="mb-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors {selectedId ===
              client.id
                ? 'bg-accent-wash ring-1 ring-primary/40'
                : 'hover:bg-surface-3'}"
              onclick={() => (selectedId = client.id)}
            >
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md {selectedId ===
                client.id
                  ? 'bg-primary/20 text-primary'
                  : 'bg-surface-2 text-muted-foreground'}"
              >
                <Icon svg={clientIconSvg(client.icon)} size={18} />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{client.name}</span>
                <span class="block truncate text-xs text-muted-foreground">
                  {formatLastPlayed(client.lastPlayed)}
                </span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <!-- Overview -->
    <section class="flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface-1">
      {#if !selected}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span class="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
            <Icon name="play" size={26} />
          </span>
          <p class="text-sm text-muted-foreground">Select a client to see its details.</p>
        </div>
      {:else}
        <!-- Header: icon (click to change) + editable name + action icons -->
        <div class="flex shrink-0 items-start gap-4 border-b border-divider p-4">
          <Menu align="start" width="w-64">
            {#snippet trigger({ toggle })}
              <button
                class="group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-primary transition hover:brightness-110"
                use:tooltip={'Change icon'}
                aria-label="Change client icon"
                onclick={toggle}
              >
                <Icon svg={clientIconSvg(selected.icon)} size={24} />
                <span
                  class="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-surface-1 bg-surface-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Icon name="pencil" size={9} />
                </span>
              </button>
            {/snippet}
            {#snippet children({ close })}
              <p class="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Icon
              </p>
              <div class="grid grid-cols-5 gap-1">
                {#each CLIENT_ICONS as ic (ic.key)}
                  <button
                    class="flex aspect-square items-center justify-center rounded-md transition-colors {(selected.icon ??
                      DEFAULT_CLIENT_ICON) === ic.key
                      ? 'bg-accent-wash text-primary ring-1 ring-primary/50'
                      : 'text-muted-foreground hover:bg-surface-3 hover:text-foreground'}"
                    use:tooltip={ic.label}
                    aria-label={ic.label}
                    onclick={() => {
                      close()
                      setIcon(ic.key)
                    }}
                  >
                    <Icon svg={ic.svg} size={18} />
                  </button>
                {/each}
              </div>
            {/snippet}
          </Menu>

          <div class="min-w-0 flex-1">
            {#if renaming}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="w-full max-w-sm rounded-md border border-input bg-surface-2 px-2 py-1 font-display text-2xl font-bold outline-none focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
                bind:value={renameValue}
                autofocus
                onblur={applyRename}
                onkeydown={(e) => {
                  if (e.key === 'Enter') applyRename()
                  if (e.key === 'Escape') renaming = false
                }}
              />
            {:else}
              <button
                class="group flex max-w-full items-center gap-2 text-left"
                use:tooltip={'Click to rename'}
                onclick={startRename}
              >
                <h1 class="truncate font-display text-2xl font-bold tracking-tight">
                  {selected.name}
                </h1>
                <Icon
                  name="pencil"
                  size={15}
                  class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            {/if}
            <p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">{selected.id}</p>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" icon="info" onclick={() => (detailsOpen = true)}>
              Details
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon="sliders"
              onclick={() => (gtaSettingsOpen = true)}
            >
              GTA settings
            </Button>
            <Menu align="end" width="w-56">
              {#snippet trigger({ toggle })}
                <Button variant="outline" size="sm" icon="folder" onclick={toggle}>Folders</Button>
              {/snippet}
              {#snippet children({ close })}
                <MenuItem
                  icon="folder"
                  label="Client folder"
                  onclick={() => {
                    close()
                    if (selected) openRef(api.openClientFolder(selected.id))
                  }}
                />
                <MenuItem
                  icon="folder"
                  label="Client plugins"
                  onclick={() => {
                    close()
                    if (selected) openRef(api.openClientPluginsFolder(selected.id))
                  }}
                />
                <MenuItem
                  icon="folderOpen"
                  label="FiveM folder"
                  onclick={() => {
                    close()
                    openRef(api.openFiveMFolder())
                  }}
                />
                <MenuItem
                  icon="folderOpen"
                  label="FiveM plugins"
                  onclick={() => {
                    close()
                    openRef(api.openFiveMPluginsFolder())
                  }}
                />
                <MenuItem
                  icon="externalLink"
                  label="CitizenFX folder"
                  onclick={() => {
                    close()
                    openRef(api.openCitizenFxFolder())
                  }}
                />
              {/snippet}
            </Menu>
          </div>
        </div>

        <!-- Scrollable body: launch + linking -->
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <Button
            variant="hero"
            size="lg"
            full
            icon="play"
            class="h-14 text-lg"
            disabled={launching || pluginsSyncBusy}
            loading={launching}
            title={pluginsSyncBusy ? 'Waiting for the previous plugins sync to finish' : undefined}
            onclick={launchSelected}
          >
            {launching ? 'Launching…' : pluginsSyncBusy ? 'Sync busy…' : `Launch ${selected.name}`}
          </Button>

          {#if launchStatus}
            <div class="mt-2 flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              {#if launching}
                <span
                  class="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-surface-3 border-t-primary"
                ></span>
              {/if}
              <p
                class="truncate text-xs {launchStatus.startsWith('WARNING')
                  ? 'text-destructive'
                  : 'text-muted-foreground'}"
              >
                {launchStatus}
              </p>
            </div>
          {/if}

          <!-- Linking -->
          <div class="mt-6">
            <div class="mb-2 flex items-baseline gap-2">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Linking
              </p>
              <span class="text-xs text-muted-foreground">· what gets shared with FiveM on launch</span>
            </div>

            <div class="divide-y divide-divider overflow-hidden rounded-lg bg-surface-2/50">
              <!-- Plugins (has modes) -->
              <div class="flex items-center gap-3 px-3 py-2.5">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium">Plugins</p>
                  <p class="text-xs text-muted-foreground">How per-client plugins get into FiveM.</p>
                </div>
                <Menu align="end" width="w-64">
                  {#snippet trigger({ toggle })}
                    <button
                      class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface-3"
                      onclick={toggle}
                    >
                      <span
                        class="h-1.5 w-1.5 rounded-full {pluginsState === 'off'
                          ? 'bg-muted-foreground'
                          : 'bg-primary'}"
                      ></span>
                      {pluginsLabel}
                      <Icon name="chevronDown" size={14} class="text-muted-foreground" />
                    </button>
                  {/snippet}
                  {#snippet children({ close })}
                    <MenuItem
                      label="Off"
                      description="Don’t touch the plugins folder."
                      active={pluginsState === 'off'}
                      onclick={() => {
                        close()
                        setPlugins('off')
                      }}
                    />
                    <MenuItem
                      label="Sync (copy)"
                      description="Copy plugins in, keep them synced while playing."
                      active={pluginsState === 'sync'}
                      onclick={() => {
                        close()
                        setPlugins('sync')
                      }}
                    />
                    <MenuItem
                      label="Junction"
                      description="Point FiveM’s plugins folder at this client (advanced)."
                      active={pluginsState === 'junction'}
                      onclick={() => {
                        close()
                        setPlugins('junction')
                      }}
                    />
                  {/snippet}
                </Menu>
              </div>

              <!-- Simple on/off toggles -->
              {#each boolLinks as link (link.key)}
                <div class="flex items-center gap-3 px-3 py-2.5">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{link.label}</p>
                    <p class="text-xs text-muted-foreground">{link.hint}</p>
                  </div>
                  <Switch
                    label={link.label}
                    checked={selected.linkOptions[link.key]}
                    onchange={(v) => setLinkBool(link.key, v)}
                  />
                </div>
              {/each}
            </div>
          </div>
        </div>

        <!-- Stats (decardified) + delete, pinned to the bottom -->
        <div class="shrink-0 border-t border-divider p-4">
          <div class="flex items-center gap-10">
            <StatItem label="Files" value={stats ? stats.fileCount.toLocaleString() : '…'} />
            <StatItem label="Size" value={stats ? formatBytes(stats.totalBytes) : '…'} />
            <StatItem label="Last played" value={formatLastPlayed(selected.lastPlayed)} mono={false} />
          </div>
          <div class="mt-4">
            <Button
              variant="destructive"
              icon="trash"
              onclick={() => (deleteConfirmOpen = true)}
            >
              Delete client
            </Button>
          </div>
        </div>
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
    class="flex h-8 shrink-0 items-center justify-between gap-4 border-t border-divider px-4 text-xs text-muted-foreground"
  >
    <div class="flex shrink-0 items-center gap-2">
      <button
        class="font-medium text-foreground/80 transition-colors hover:text-foreground"
        use:tooltip={'Check for updates'}
        onclick={() => (updateOpen = true)}
      >
        FiveLaunch v{appVersion || '…'}
      </button>
      {#if pluginsSyncBusy}
        <span class="rounded-full bg-accent-wash px-2 py-0.5 text-[10px] text-primary">
          plugins sync running
        </span>
      {/if}
      <span class="text-divider">·</span>
      <button
        class="rounded px-1.5 py-0.5 transition-colors hover:bg-surface-3 hover:text-foreground {logsOpen
          ? 'text-foreground'
          : ''}"
        onclick={() => (logsOpen = !logsOpen)}
      >
        Logs{logs.length ? ` (${logs.length})` : ''}
      </button>
      <button
        class="rounded px-1.5 py-0.5 transition-colors hover:bg-surface-3 hover:text-foreground"
        use:tooltip={'Backups moved out of FiveM.app live here'}
        onclick={() => (historyOpen = true)}
      >
        History
      </button>
      {#if updateStatus?.isUpdateAvailable}
        <button
          class="rounded-full bg-accent-wash px-2 py-0.5 text-[10px] text-primary transition-[filter] hover:brightness-110"
          use:tooltip={'View and install the update'}
          onclick={() => (updateOpen = true)}
        >
          Update available: v{updateStatus.latestVersion}
        </button>
      {/if}
    </div>

    <div class="flex min-w-0 items-center gap-3">
      <span
        class="min-w-0 truncate font-mono text-muted-foreground/70"
        use:tooltip={resolvedGamePath ?? undefined}
      >
        {resolvedGamePath ?? 'FiveM not found · set the game path in settings'}
      </span>
      <span class="shrink-0 text-divider">·</span>
      <button
        class="shrink-0 font-medium transition-colors hover:text-primary"
        onclick={() => api.openUrl('https://fivelaunch.help').catch(() => {})}
      >
        fivelaunch.help
      </button>
      <span class="shrink-0 text-muted-foreground/70">© {new Date().getFullYear()} FiveLaunch</span>
    </div>
  </footer>

  <SettingsDialog bind:open={settingsOpen} onSaved={refreshResolvedPath} />
  <FirstRunDialog bind:open={firstRunOpen} onContinue={acknowledgeFirstRun} />
  <ClientDetailsDialog bind:open={detailsOpen} client={selected} {stats} onChanged={refresh} />
  <GtaSettingsDialog bind:open={gtaSettingsOpen} clientId={selectedId} />
  <HistoryDialog bind:open={historyOpen} />
  <CreateClientDialog bind:open={createOpen} onCreated={onClientCreated} />
  <UpdateDialog bind:open={updateOpen} />
  <ConfirmDialog
    bind:open={deleteConfirmOpen}
    title="Delete client?"
    message={`This permanently removes "${selected?.name ?? ''}" and its linked files. This cannot be undone.`}
    confirmLabel="Delete client"
    onConfirm={deleteSelected}
  />
</div>

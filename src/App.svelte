<script lang="ts">
  import { onMount } from 'svelte'
  import TitleBar from './lib/components/TitleBar.svelte'
  import SettingsDialog from './lib/components/SettingsDialog.svelte'
  import FirstRunDialog from './lib/components/FirstRunDialog.svelte'
  import ClientDetailsDialog from './lib/components/ClientDetailsDialog.svelte'
  import GtaSettingsDialog from './lib/components/GtaSettingsDialog.svelte'
  import HistoryDialog from './lib/components/HistoryDialog.svelte'
  import CreateClientDialog from './lib/components/CreateClientDialog.svelte'
  import DuplicateClientDialog from './lib/components/DuplicateClientDialog.svelte'
  import UpdateDialog from './lib/components/UpdateDialog.svelte'
  import LogsPanel from './lib/components/LogsPanel.svelte'
  import Icon from './lib/components/ui/Icon.svelte'
  import IconButton from './lib/components/ui/IconButton.svelte'
  import Button from './lib/components/ui/Button.svelte'
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
  let duplicateOpen = $state(false)
  let restoreOffConfirmOpen = $state(false)

  // Snapshot ("My Setup") — the baseline client every session returns to.
  let snapshotClientId = $state<string | null>(null)
  let updateOpen = $state(false)
  let logsOpen = $state(false)

  // Log store: launch-status events + main-process logs (app-log events).
  let logs = $state<AppLogEntry[]>([])
  let logSeq = 0
  let updateStatus = $state<UpdateStatus | null>(null)

  // Appends mutate the $state array in place (deeply reactive) — re-spreading
  // the whole history on every entry would be O(n) per log line.
  function pushLog(message: string): void {
    logSeq += 1
    const lower = message.toLowerCase()
    const level: AppLogEntry['level'] = message.startsWith('WARNING')
      ? 'warn'
      : lower.includes('error') || lower.includes('failed')
        ? 'error'
        : 'info'
    logs.push({ id: logSeq, ts: Date.now(), level, message, source: 'launch' })
    if (logs.length > 1000) logs.splice(0, logs.length - 1000)
  }

  function toMainLog(entry: { id: number; ts: number; level: AppLogEntry['level']; message: string }): AppLogEntry {
    // Main-process ids are their own sequence; offset to keep keys unique.
    return { ...entry, id: entry.ts + entry.id, source: 'main' }
  }

  function pushMainLog(entry: { id: number; ts: number; level: AppLogEntry['level']; message: string }): void {
    logs.push(toMainLog(entry))
    if (logs.length > 1600) logs.splice(0, logs.length - 1600)
  }

  async function clearLogs(): Promise<void> {
    logs = []
    try {
      await api.clearAppLogs()
    } catch {
      // ignore
    }
  }

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients
  })

  // Drag-to-reorder. Only enabled with no active search — a filtered list's
  // indices don't map to positions in the full `clients` array. When
  // `reorderable` is true, `filtered === clients`, so row indices are canonical.
  const reorderable = $derived(!query.trim())
  let dragIndex = $state<number | null>(null)
  let dropIndex = $state<number | null>(null)

  function onDragStart(e: DragEvent, index: number): void {
    dragIndex = index
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      // Some engines require data to be set for a drag to begin.
      e.dataTransfer.setData('text/plain', String(index))
    }
  }

  function onDragOver(e: DragEvent, index: number): void {
    if (dragIndex === null) return
    e.preventDefault() // allow the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dropIndex = index
  }

  function onDrop(e: DragEvent, index: number): void {
    e.preventDefault()
    const from = dragIndex
    dragIndex = null
    dropIndex = null
    if (from === null || from === index) return
    void applyReorder(from, index)
  }

  function onDragEnd(): void {
    dragIndex = null
    dropIndex = null
  }

  /** Move a client and persist the new order (optimistic, reverts on error). */
  async function applyReorder(from: number, to: number): Promise<void> {
    const next = [...clients]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    clients = next
    try {
      await api.reorderClients(next.map((c) => c.id))
    } catch (e) {
      error = String(e)
      await refresh()
    }
  }
  const selected = $derived(clients.find((c) => c.id === selectedId) ?? null)
  const restoreOnCloseEnabled = $derived(selected?.restoreOnClose !== false)

  type BoolLink = 'mods' | 'citizen' | 'gtaSettings' | 'citizenFxIni'
  type PluginsState = 'off' | 'sync' | 'junction'

  // Simple on/off linking toggles, shown as square tiles.
  const boolLinks: { key: BoolLink; label: string; hint: string; icon: string }[] = [
    { key: 'mods', label: 'Mods', hint: 'Share this client’s mods folder with the game.', icon: 'folder' },
    { key: 'citizen', label: 'Citizen', hint: 'Link the citizen folder (advanced).', icon: 'link' },
    { key: 'gtaSettings', label: 'GTA settings', hint: 'Apply this client’s graphics settings on launch.', icon: 'sliders' },
    { key: 'citizenFxIni', label: 'CitizenFX.ini', hint: 'Keep this client’s CitizenFX.ini in sync.', icon: 'settings' }
  ]

  // Plugins is a mode picker (like pure mode), shown as a large segmented control.
  const pluginOptions: { value: PluginsState; label: string; hint: string }[] = [
    { value: 'off', label: 'Off', hint: 'Don’t touch the plugins folder.' },
    { value: 'sync', label: 'Sync (copy)', hint: 'Copy plugins in, keep them synced while you play.' },
    { value: 'junction', label: 'Junction', hint: 'Point FiveM’s plugins folder at this client (advanced).' }
  ]

  const pluginsState = $derived<PluginsState>(
    !selected?.linkOptions.plugins ? 'off' : (selected.linkOptions.pluginsMode ?? 'sync')
  )

  const pluginsHint = $derived(
    pluginOptions.find((o) => o.value === pluginsState)?.hint ?? ''
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

    // Backfill main-process logs from before the UI was ready in one batch
    // (per-entry pushes would re-trigger reactivity for each of up to 800
    // ring-buffer entries), then check for updates (notify-only, cached 15
    // minutes backend-side).
    api
      .getAppLogs()
      .then((entries) => {
        if (entries.length === 0) return
        logs.push(...entries.map(toMainLog))
        if (logs.length > 1600) logs.splice(0, logs.length - 1600)
      })
      .catch(() => {})
    api
      .getUpdateStatus()
      .then((status) => (updateStatus = status))
      .catch(() => {})

    // Busy state only matters when someone can see the launch button — skip
    // ticks while hidden (minimized to tray) and catch up on re-show.
    const pollBusy = () => {
      if (document.hidden) return
      api
        .getGameBusyState()
        .then((s) => (pluginsSyncBusy = s.pluginsSyncBusy))
        .catch(() => {})
    }
    pollBusy()
    const busyTimer = setInterval(pollBusy, 3000)
    document.addEventListener('visibilitychange', pollBusy)

    // Independent reads — issue them together instead of as a waterfall so
    // the first paint with data needs one IPC round trip, not four.
    void (async () => {
      try {
        const [settings, version, clientList, storedSelection] = await Promise.all([
          api.getSettings(),
          api.getAppVersion(),
          api.getClients(),
          api.getSelectedClientId().catch(() => null)
        ])
        applyPrimaryHexToRoot(settings.themePrimaryHex ?? DEFAULT_PRIMARY_HEX)
        snapshotClientId = settings.snapshotClientId ?? null
        appVersion = version
        clients = clientList
        // Reselect the client that was launched last (persisted backend-side).
        if (!selectedId && storedSelection && clientList.some((c) => c.id === storedSelection)) {
          selectedId = storedSelection
        }
      } catch (e) {
        error = String(e)
      }
    })()

    return () => {
      clearInterval(busyTimer)
      document.removeEventListener('visibilitychange', pollBusy)
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
      // The launch bumped last_played backend-side; pull it so the UI shows it.
      await refresh()
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

  /** Reload settings-derived state (snapshot id) + the client list. */
  async function refreshMeta(): Promise<void> {
    try {
      const settings = await api.getSettings()
      snapshotClientId = settings.snapshotClientId ?? null
      await refresh()
    } catch {
      // ignore
    }
  }

  function onRestoreToggle(value: boolean): void {
    if (!selected) return
    if (!value) {
      // Turning restore OFF is the dangerous direction — confirm first.
      restoreOffConfirmOpen = true
      return
    }
    api
      .setClientRestoreOnClose(selected.id, true)
      .then(refresh)
      .catch((e) => (error = String(e)))
  }

  async function disableRestoreOnClose(): Promise<void> {
    if (!selected) return
    try {
      await api.setClientRestoreOnClose(selected.id, false)
      await refresh()
    } catch (e) {
      error = String(e)
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
        <Button
          variant="primary"
          size="sm"
          icon="plus"
          ariaLabel="New client"
          onclick={() => (createOpen = true)}
        >
          New
        </Button>
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
          {#each filtered as client, i (client.id)}
            <button
              class="group/row relative mb-1 flex w-full items-center gap-3 rounded-md py-2 pr-2 text-left transition-[padding,background-color,box-shadow,opacity] {reorderable
                ? 'pl-2 hover:pl-7'
                : 'pl-2'} {selectedId ===
              client.id
                ? 'bg-accent-wash ring-1 ring-primary/40'
                : 'hover:bg-surface-3'} {dragIndex === i ? 'opacity-40' : ''} {dropIndex === i &&
              dragIndex !== null &&
              dragIndex !== i
                ? 'ring-1 ring-primary/60'
                : ''}"
              draggable={reorderable}
              onclick={() => (selectedId = client.id)}
              ondragstart={(e) => onDragStart(e, i)}
              ondragover={(e) => onDragOver(e, i)}
              ondrop={(e) => onDrop(e, i)}
              ondragend={onDragEnd}
            >
              {#if reorderable}
                <!-- Grip is an absolute overlay so it never reserves space:
                     rows sit flush until hover slides them right to reveal it. -->
                <span
                  class="pointer-events-none absolute inset-y-0 left-1 flex items-center text-muted-foreground/40 opacity-0 transition-opacity group-hover/row:opacity-100"
                  aria-hidden="true"
                >
                  <Icon name="gripVertical" size={14} />
                </span>
              {/if}
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md {selectedId ===
                client.id
                  ? 'bg-primary/20 text-primary'
                  : 'bg-surface-2 text-muted-foreground'}"
              >
                <Icon svg={clientIconSvg(client.icon)} size={18} />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-semibold">{client.name}</span>
                  {#if client.id === snapshotClientId}
                    <span
                      class="shrink-0 rounded-full bg-accent-wash px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-primary"
                      use:tooltip={'Your snapshot — the baseline FiveM returns to after every session'}
                    >
                      snapshot
                    </span>
                  {/if}
                </span>
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

          <div class="flex shrink-0 items-center">
            <button
              class="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground shadow-btn transition-all hover:-translate-y-px hover:border-white/15 hover:bg-surface-3 hover:text-foreground hover:shadow-btn-hover active:translate-y-0"
              use:tooltip={'Client details'}
              aria-label="Client details"
              onclick={() => (detailsOpen = true)}
            >
              <Icon name="info" size={24} />
            </button>
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
          <div class="mt-5">
            <div class="mb-2 flex items-baseline gap-2">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Linking
              </p>
              <span class="text-xs text-muted-foreground">· what gets shared with FiveM on launch</span>
            </div>

            <!-- Plugins: large mode picker (like pure mode) -->
            <div class="rounded-xl bg-surface-2/50 p-3">
              <div class="mb-2 flex items-center gap-1.5">
                <p class="text-sm font-medium">Plugins</p>
                <span
                  class="cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                  use:tooltip={'How per-client plugins get into FiveM.'}
                >
                  <Icon name="info" size={12} />
                </span>
              </div>
              <div class="grid grid-cols-3 gap-1.5 rounded-lg border border-border bg-surface-2 p-1">
                {#each pluginOptions as opt (opt.value)}
                  <button
                    type="button"
                    class="rounded-md px-3 py-2.5 text-sm font-medium transition-colors
                      {pluginsState === opt.value
                      ? 'bg-primary text-primary-foreground shadow-btn'
                      : 'text-muted-foreground hover:bg-surface-3 hover:text-foreground'}"
                    onclick={() => setPlugins(opt.value)}
                  >
                    {opt.label}
                  </button>
                {/each}
              </div>
              <p class="mt-2 text-xs text-muted-foreground">{pluginsHint}</p>
            </div>

            <!-- The rest: square on/off tiles -->
            <div class="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {#each boolLinks as link (link.key)}
                {@const on = selected.linkOptions[link.key]}
                <button
                  type="button"
                  use:tooltip={link.hint}
                  aria-pressed={on}
                  aria-label={link.label}
                  class="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-all
                    {on
                    ? 'border-primary/60 bg-primary/10 text-foreground shadow-btn'
                    : 'border-border bg-surface-2/50 text-muted-foreground hover:-translate-y-px hover:border-white/15 hover:bg-surface-3'}"
                  onclick={() => setLinkBool(link.key, !on)}
                >
                  <span
                    class="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full transition-colors
                      {on ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-transparent'}"
                  >
                    <Icon name="check" size={11} />
                  </span>
                  <Icon
                    name={link.icon}
                    size={26}
                    class={on ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}
                  />
                  <span class="text-sm font-medium leading-tight">{link.label}</span>
                </button>
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
          <div class="mt-4 grid grid-cols-4 gap-2">
            <Button variant="outline" icon="copy" full onclick={() => (duplicateOpen = true)}>
              Duplicate
            </Button>
            <Button variant="outline" icon="sliders" full onclick={() => (gtaSettingsOpen = true)}>
              GTA settings
            </Button>
            <Menu align="end" direction="up" width="w-60" class="block w-full">
              {#snippet trigger({ toggle })}
                <Button variant="outline" icon="folder" full onclick={toggle}>Folders</Button>
              {/snippet}
              {#snippet children({ close })}
                <!-- Opens upward; ordered so items read bottom-to-top with the
                     primary "Client folder" nearest the button. -->
                <MenuItem
                  icon="externalLink"
                  label="CitizenFX folder"
                  onclick={() => {
                    close()
                    openRef(api.openCitizenFxFolder())
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
                  icon="folderOpen"
                  label="FiveM folder"
                  onclick={() => {
                    close()
                    openRef(api.openFiveMFolder())
                  }}
                />
                <div class="my-1 border-t border-divider"></div>
                <MenuItem
                  icon="folder"
                  label="Client plugins"
                  onclick={() => {
                    close()
                    if (selected) openRef(api.openClientPluginsFolder(selected.id))
                  }}
                />
                <MenuItem
                  icon="folder"
                  label="Client folder"
                  prominent
                  onclick={() => {
                    close()
                    if (selected) openRef(api.openClientFolder(selected.id))
                  }}
                />
              {/snippet}
            </Menu>
            <Button
              variant="destructive"
              icon="trash"
              full
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
      <button
        class="flex shrink-0 items-center gap-1.5 font-medium transition-colors hover:text-primary"
        use:tooltip={'Get help & support'}
        onclick={() => api.openUrl('https://fivelaunch.help/support').catch(() => {})}
      >
        <Icon name="lifeBuoy" size={13} />
        Support
      </button>
      <span class="shrink-0 text-muted-foreground/70">© {new Date().getFullYear()} FiveLaunch</span>
    </div>
  </footer>

  <SettingsDialog bind:open={settingsOpen} onSaved={refreshMeta} />
  <FirstRunDialog
    bind:open={firstRunOpen}
    onContinue={acknowledgeFirstRun}
    onSnapshotCreated={() => void refreshMeta()}
  />
  <ClientDetailsDialog
    bind:open={detailsOpen}
    client={selected}
    {stats}
    hasSnapshot={!!snapshotClientId}
    restoreEnabled={snapshotClientId ? restoreOnCloseEnabled : false}
    {onRestoreToggle}
    onChanged={refresh}
  />
  <GtaSettingsDialog bind:open={gtaSettingsOpen} clientId={selectedId} />
  <HistoryDialog bind:open={historyOpen} />
  <CreateClientDialog bind:open={createOpen} onCreated={onClientCreated} />
  <DuplicateClientDialog bind:open={duplicateOpen} client={selected} onDuplicated={onClientCreated} />
  <UpdateDialog bind:open={updateOpen} />
  <ConfirmDialog
    bind:open={deleteConfirmOpen}
    title="Delete client?"
    message={`This permanently removes "${selected?.name ?? ''}" and its linked files. This cannot be undone.${
      selected?.id === snapshotClientId
        ? ' Warning: this is your SNAPSHOT client — deleting it disables restore-on-close for every client until you create a new snapshot in settings.'
        : ''
    }`}
    confirmLabel="Delete client"
    onConfirm={deleteSelected}
  />
  <ConfirmDialog
    bind:open={restoreOffConfirmOpen}
    title="Turn off restore on close?"
    message={`Dangerous: with restore off, everything "${selected?.name ?? ''}" swaps in stays in FiveM after you close the game — its mods, plugins, and settings won't go back to your snapshot until another client launches or you restore manually from settings. Playing FiveM outside FiveLaunch will use this client's files.`}
    confirmLabel="Turn off restore"
    onConfirm={disableRestoreOnClose}
  />
</div>

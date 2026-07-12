<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Icon from './ui/Icon.svelte'
  import Switch from './ui/Switch.svelte'
  import SegmentedControl from './ui/SegmentedControl.svelte'
  import { tooltip } from '../actions/tooltip'
  import { api } from '../api'
  import { formatBytes } from '../format'
  import type { ClientProfile, ClientStats } from '../types'

  const PURE_MODE_HELP =
    'FiveM pure mode makes your client match the server exactly, blocking client-side mods so you can join anti-cheat / pure servers without the in-launch prompt. Level 1 is strict (files must match). Level 2 is more lenient (allows some textures/sounds). Off launches normally.'

  const RESTORE_HELP =
    'When the game closes, everything this client swapped in (mods, plugins, citizen, GTA settings, CitizenFX.ini) goes back to your snapshot ("My Setup").'

  let {
    open = $bindable(false),
    client,
    stats,
    hasSnapshot = false,
    restoreEnabled = false,
    onRestoreToggle,
    onChanged
  }: {
    open?: boolean
    client: ClientProfile | null
    stats: ClientStats | null
    /** Whether a snapshot client exists (restore-on-close requires one). */
    hasSnapshot?: boolean
    /** Current restore-on-close state for this client. */
    restoreEnabled?: boolean
    /** Toggle restore-on-close (App owns the confirm-before-off flow). */
    onRestoreToggle?: (value: boolean) => void
    /** Called after rename so App can refresh. */
    onChanged: () => void
  } = $props()

  let renameValue = $state('')
  let mods = $state<string[]>([])
  let modsLoading = $state(false)
  let modsError = $state<string | null>(null)
  let error = $state<string | null>(null)
  let shortcutFlash = $state(false)

  async function createShortcut(): Promise<void> {
    if (!client) return
    try {
      await api.createClientShortcut(client.id)
      shortcutFlash = true
      setTimeout(() => (shortcutFlash = false), 1500)
    } catch (e) {
      error = String(e)
    }
  }

  $effect(() => {
    if (!open || !client) return
    renameValue = client.name
    modsLoading = true
    modsError = null
    const id = client.id
    api
      .listClientMods(id)
      .then((entries) => {
        if (client?.id === id) mods = entries
      })
      .catch((e) => (modsError = String(e)))
      .finally(() => (modsLoading = false))
  })

  async function rename(): Promise<void> {
    if (!client) return
    const name = renameValue.trim()
    if (!name || name === client.name) return
    try {
      await api.renameClient(client.id, name)
      onChanged()
    } catch (e) {
      error = String(e)
    }
  }

  const pureValue = $derived(client?.pureMode ? String(client.pureMode) : 'off')

  async function setPureMode(v: string): Promise<void> {
    if (!client) return
    try {
      await api.setClientPureMode(client.id, v === 'off' ? null : Number(v))
      onChanged()
    } catch (e) {
      error = String(e)
    }
  }

  function formatLastPlayed(ts?: number): string {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleString()
  }
</script>

<Modal
  bind:open
  title="Client details"
  description="Stats, rename, mods, and a desktop shortcut for this client."
  icon="info"
  size="lg"
>
  {#if !client}
    <div class="text-sm text-muted-foreground">Select a client first.</div>
  {:else}
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4 rounded-lg bg-surface-2/60 p-4 sm:grid-cols-4">
        <div>
          <p class="text-xs text-muted-foreground">Name</p>
          <p class="truncate text-sm font-medium">{client.name}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">Files</p>
          <p class="font-mono text-sm font-medium">{stats ? stats.fileCount.toLocaleString() : '…'}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">Storage</p>
          <p class="font-mono text-sm font-medium">{stats ? formatBytes(stats.totalBytes) : '…'}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">Last played</p>
          <p class="truncate text-sm font-medium">{formatLastPlayed(client.lastPlayed)}</p>
        </div>
      </div>
      <p class="truncate font-mono text-xs text-muted-foreground">{client.id}</p>

      <div class="flex gap-2">
        <Input
          bind:value={renameValue}
          placeholder="Rename client"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && rename()}
        />
        <Button
          variant="outline"
          disabled={!renameValue.trim() || renameValue.trim() === client.name}
          onclick={rename}
        >
          Rename
        </Button>
      </div>

      <div class="flex items-center justify-between gap-3 rounded-lg bg-surface-2/60 p-4">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium">Pure mode</span>
            <span class="cursor-help text-muted-foreground" use:tooltip={PURE_MODE_HELP}>
              <Icon name="info" size={14} />
            </span>
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Launch this client straight into a FiveM pure-mode level.
          </p>
        </div>
        <SegmentedControl
          value={pureValue}
          onchange={setPureMode}
          options={[
            { value: 'off', label: 'Off' },
            { value: '1', label: 'Level 1' },
            { value: '2', label: 'Level 2' }
          ]}
        />
      </div>

      <div class="flex items-center justify-between gap-3 rounded-lg bg-surface-2/60 p-4">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium">Restore my setup on close</span>
            <span class="cursor-help text-muted-foreground" use:tooltip={RESTORE_HELP}>
              <Icon name="info" size={14} />
            </span>
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {#if !hasSnapshot}
              No snapshot yet — create one in global settings to enable this.
            {:else if restoreEnabled}
              After you close the game, FiveM goes back to your snapshot.
            {:else}
              Off: this client's files stay in FiveM after the game closes.
            {/if}
          </p>
        </div>
        <Switch
          label="Restore my setup on close"
          checked={hasSnapshot ? restoreEnabled : false}
          disabled={!hasSnapshot}
          onchange={(v) => onRestoreToggle?.(v)}
        />
      </div>

      <div class="rounded-lg bg-surface-2/60 p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium">Mods folder</div>
            <div class="text-xs text-muted-foreground">Entries inside this client's mods folder.</div>
          </div>
          <div class="text-xs text-muted-foreground">
            {modsLoading ? 'Loading…' : `${mods.length} item(s)`}
          </div>
        </div>

        {#if modsError}
          <div class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {modsError}
          </div>
        {:else}
          <div class="mt-3 max-h-48 overflow-auto rounded-md bg-background/60 p-3">
            {#if modsLoading}
              <div class="text-sm text-muted-foreground">Loading…</div>
            {:else if mods.length === 0}
              <div class="text-sm text-muted-foreground">No mods found.</div>
            {:else}
              <div class="space-y-1 font-mono text-xs">
                {#each mods as name (name)}
                  <div class="truncate text-foreground/90">{name}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          icon="folder"
          onclick={() => client && api.openClientFolder(client.id).catch((e) => (error = String(e)))}
        >
          Open client folder
        </Button>
        <Button variant="outline" icon="externalLink" onclick={createShortcut}>
          {shortcutFlash ? 'Shortcut created!' : 'Create desktop shortcut'}
        </Button>
      </div>

      {#if error}
        <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
  {/snippet}
</Modal>

<script lang="ts">
  import Dialog from './ui/Dialog.svelte'
  import { api } from '../api'
  import { formatBytes } from '../format'
  import type { ClientProfile, ClientStats } from '../types'

  let {
    open = $bindable(false),
    client,
    stats,
    onChanged
  }: {
    open?: boolean
    client: ClientProfile | null
    stats: ClientStats | null
    /** Called after rename/delete so App can refresh. */
    onChanged: () => void
  } = $props()

  let renameValue = $state('')
  let mods = $state<string[]>([])
  let modsLoading = $state(false)
  let modsError = $state<string | null>(null)
  let confirmingDelete = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    if (!open || !client) return
    renameValue = client.name
    confirmingDelete = false
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

  async function deleteClient(): Promise<void> {
    if (!client) return
    if (!confirmingDelete) {
      confirmingDelete = true
      return
    }
    try {
      await api.deleteClient(client.id)
      open = false
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

<Dialog
  bind:open
  title="Client Details"
  description="Rename, view stats, delete, and see this client's mods folder."
>
  {#if !client}
    <div class="mt-3 text-sm text-muted-foreground">Select a client first.</div>
  {:else}
    <div class="mt-3 space-y-4">
      <div class="rounded-md border border-border p-4 text-sm">
        <div class="grid gap-2 text-muted-foreground">
          <div><span class="text-foreground">Name:</span> {client.name}</div>
          <div>
            <span class="text-foreground">Client ID:</span>
            <span class="font-mono text-xs">{client.id}</span>
          </div>
          <div>
            <span class="text-foreground">Files:</span>
            {stats ? `${stats.fileCount.toLocaleString()} files` : 'Loading…'}
          </div>
          <div>
            <span class="text-foreground">Storage:</span>
            {stats ? formatBytes(stats.totalBytes) : 'Loading…'}
          </div>
          <div>
            <span class="text-foreground">Last Played:</span>
            {formatLastPlayed(client.lastPlayed)}
          </div>
        </div>
      </div>

      <div class="flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-input bg-secondary/40 px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          placeholder="Rename client"
          bind:value={renameValue}
          onkeydown={(e) => e.key === 'Enter' && rename()}
        />
        <button
          class="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          disabled={!renameValue.trim() || renameValue.trim() === client.name}
          onclick={rename}
        >
          Rename
        </button>
      </div>

      <div class="rounded-md border border-border p-4">
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
          <div class="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-secondary/20 p-3">
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
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onclick={() => client && api.openClientFolder(client.id).catch((e) => (error = String(e)))}
        >
          Open Client Folder
        </button>
        <button
          class="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground/50"
          title="Desktop shortcuts arrive in Phase 6"
          disabled
        >
          Create Desktop Shortcut
        </button>
      </div>

      {#if error}
        <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      {/if}

      <div class="flex flex-wrap items-center justify-between gap-2">
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onclick={() => (open = false)}
        >
          Close
        </button>
        <button
          class="rounded-md border px-3 py-1.5 text-sm transition-colors {confirmingDelete
            ? 'border-destructive bg-destructive text-destructive-foreground'
            : 'border-destructive/50 text-destructive-foreground/80 hover:bg-destructive/20'}"
          onclick={deleteClient}
          onmouseleave={() => (confirmingDelete = false)}
        >
          {confirmingDelete ? 'Confirm delete?' : 'Delete Client'}
        </button>
      </div>
    </div>
  {/if}
</Dialog>

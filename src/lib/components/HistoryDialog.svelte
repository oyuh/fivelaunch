<script lang="ts">
  import Dialog from './ui/Dialog.svelte'
  import { api } from '../api'
  import { formatBytes } from '../format'
  import type { BackupEntry } from '../types'

  let {
    open = $bindable(false)
  }: {
    open?: boolean
  } = $props()

  let entries = $state<BackupEntry[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let confirmingDelete = $state<string | null>(null)

  $effect(() => {
    if (!open) return
    void reload()
  })

  async function reload(): Promise<void> {
    loading = true
    error = null
    confirmingDelete = null
    try {
      entries = await api.listBackups()
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  async function deleteEntry(name: string): Promise<void> {
    if (confirmingDelete !== name) {
      confirmingDelete = name
      return
    }
    try {
      await api.deleteBackup(name)
      await reload()
    } catch (e) {
      error = String(e)
    }
  }

  function formatDate(ms: number): string {
    if (!ms) return 'Unknown date'
    return new Date(ms).toLocaleString()
  }

  function describe(entry: BackupEntry): string {
    const size = formatBytes(entry.totalBytes)
    return entry.isDir ? `${entry.fileCount.toLocaleString()} files · ${size}` : size
  }
</script>

<Dialog
  bind:open
  title="Backup History"
  description="Everything FiveLaunch moved aside lives here instead of cluttering FiveM.app — original folders, isolated plugin sets, and replaced settings files."
  maxWidth="max-w-2xl"
>
  <div class="mt-3 space-y-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted-foreground">
        {loading ? 'Loading…' : `${entries.length} backup(s) stored`}
      </span>
      <button
        class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        onclick={() => api.openBackupsFolder().catch((e) => (error = String(e)))}
      >
        Open backups folder
      </button>
    </div>

    {#if error}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        {error}
      </div>
    {/if}

    {#if !loading && entries.length === 0}
      <div class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No backups yet. When a launch needs to move an existing folder or settings file aside,
        it shows up here.
      </div>
    {:else}
      <div class="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
        {#each entries as entry (entry.name)}
          <div class="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/20 p-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{entry.kind}</div>
              <div class="truncate text-xs text-muted-foreground">
                {formatDate(entry.createdMs)} · {describe(entry)}
              </div>
            </div>
            <button
              class="shrink-0 rounded-md border px-3 py-1 text-xs transition-colors {confirmingDelete ===
              entry.name
                ? 'border-destructive bg-destructive text-destructive-foreground'
                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}"
              onclick={() => deleteEntry(entry.name)}
              onmouseleave={() => (confirmingDelete = null)}
            >
              {confirmingDelete === entry.name ? 'Confirm delete?' : 'Delete'}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</Dialog>

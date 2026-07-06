<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Icon from './ui/Icon.svelte'
  import { updater, type UpdateInfo, type DownloadProgress } from '../updater'
  import { formatBytes } from '../format'

  let {
    open = $bindable(false)
  }: {
    open?: boolean
  } = $props()

  type Phase = 'checking' | 'available' | 'downloading' | 'ready' | 'uptodate' | 'error'

  let phase = $state<Phase>('checking')
  let info = $state<UpdateInfo | null>(null)
  let progress = $state<DownloadProgress>({ downloaded: 0, total: null, done: false })
  let error = $state<string | null>(null)

  // Re-check every time the dialog is opened.
  $effect(() => {
    if (open) void runCheck()
  })

  async function runCheck(): Promise<void> {
    phase = 'checking'
    error = null
    info = null
    try {
      const found = await updater.check()
      if (found) {
        info = found
        phase = 'available'
      } else {
        phase = 'uptodate'
      }
    } catch (e) {
      error = String(e)
      phase = 'error'
    }
  }

  async function install(): Promise<void> {
    phase = 'downloading'
    progress = { downloaded: 0, total: null, done: false }
    try {
      await updater.downloadAndInstall((p) => (progress = p))
      phase = 'ready'
    } catch (e) {
      error = String(e)
      phase = 'error'
    }
  }

  async function restart(): Promise<void> {
    try {
      await updater.restart()
    } catch (e) {
      error = String(e)
      phase = 'error'
    }
  }

  const pct = $derived(
    progress.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null
  )

  const noteLines = $derived((info?.notes ?? '').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean))
</script>

<Modal bind:open title="Software update" icon="download" size="md">
  {#if phase === 'checking'}
    <div class="flex items-center gap-3 py-4 text-sm text-muted-foreground">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-surface-3 border-t-primary"></span>
      Checking for updates…
    </div>
  {:else if phase === 'uptodate'}
    <div class="flex items-center gap-3 py-4">
      <span class="flex h-9 w-9 items-center justify-center rounded-full bg-accent-wash text-primary">
        <Icon name="check" size={18} />
      </span>
      <div>
        <p class="text-sm font-medium">You're on the latest version.</p>
        <p class="text-xs text-muted-foreground">FiveLaunch checks again automatically.</p>
      </div>
    </div>
  {:else if phase === 'available' && info}
    <div class="space-y-4">
      <div>
        <p class="text-sm">
          Version <span class="font-mono font-semibold text-primary">v{info.version}</span> is
          available.
        </p>
        <p class="text-xs text-muted-foreground">
          It downloads and installs in the background, then restarts FiveLaunch.
        </p>
      </div>
      {#if noteLines.length}
        <div class="rounded-lg bg-surface-2/60 p-3">
          <p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What's new
          </p>
          <ul class="space-y-1 text-sm">
            {#each noteLines as line (line)}
              <li class="flex gap-2">
                <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary"></span>
                <span>{line}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {:else if phase === 'downloading'}
    <div class="space-y-3 py-2">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium">Downloading update…</span>
        <span class="font-mono text-xs text-muted-foreground">
          {#if progress.total}
            {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
          {:else}
            {formatBytes(progress.downloaded)}
          {/if}
        </span>
      </div>
      <div class="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-150"
          style="width: {pct ?? 30}%"
        ></div>
      </div>
    </div>
  {:else if phase === 'ready'}
    <div class="flex items-center gap-3 py-4">
      <span class="flex h-9 w-9 items-center justify-center rounded-full bg-accent-wash text-primary">
        <Icon name="check" size={18} />
      </span>
      <div>
        <p class="text-sm font-medium">Update installed.</p>
        <p class="text-xs text-muted-foreground">Restart FiveLaunch to finish updating.</p>
      </div>
    </div>
  {:else if phase === 'error'}
    <div class="space-y-2 py-2">
      <div class="flex items-center gap-2 text-sm font-medium text-destructive">
        <Icon name="alert" size={16} /> Update failed
      </div>
      <p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">{error}</p>
    </div>
  {/if}

  {#snippet footer()}
    {#if phase === 'available'}
      <Button variant="ghost" onclick={() => (open = false)}>Later</Button>
      <Button variant="primary" icon="download" onclick={install}>Download & install</Button>
    {:else if phase === 'downloading'}
      <Button variant="ghost" disabled>Please wait…</Button>
    {:else if phase === 'ready'}
      <Button variant="ghost" onclick={() => (open = false)}>Later</Button>
      <Button variant="primary" icon="refresh" onclick={restart}>Restart now</Button>
    {:else if phase === 'error'}
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
      <Button variant="primary" icon="refresh" onclick={runCheck}>Retry</Button>
    {:else}
      <Button variant="primary" onclick={() => (open = false)}>Close</Button>
    {/if}
  {/snippet}
</Modal>

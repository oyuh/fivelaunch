<script lang="ts">
  import type { AppLogEntry } from '../types'

  let {
    logs,
    onClear
  }: {
    logs: AppLogEntry[]
    onClear: () => void
  } = $props()

  let query = $state('')
  let copied = $state(false)
  let scroller = $state<HTMLDivElement | null>(null)

  const MAX_RENDERED = 250

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((l) => l.message.toLowerCase().includes(q))
  })

  const rendered = $derived(
    filtered.length <= MAX_RENDERED ? filtered : filtered.slice(filtered.length - MAX_RENDERED)
  )

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  // Auto-scroll when new logs arrive if the user is near the bottom.
  $effect(() => {
    void rendered.length
    const el = scroller
    if (!el) return
    const bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (bottomGap < 80) {
      el.scrollTop = el.scrollHeight
    }
  })

  function levelClass(level: AppLogEntry['level']): string {
    switch (level) {
      case 'error':
        return 'text-red-300'
      case 'warn':
        return 'text-amber-300'
      default:
        return 'text-emerald-200'
    }
  }

  async function copyVisible(): Promise<void> {
    const text = rendered
      .map((l) => `${timeFmt.format(l.ts)} [${l.level}] ${l.message}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch {
      // clipboard unavailable
    }
  }
</script>

<section class="rounded-lg border border-border bg-card p-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-sm font-semibold">Logs</h3>
      <p class="text-xs text-muted-foreground">Launch progress and status messages.</p>
    </div>
    <div class="flex items-center gap-2">
      <input
        class="w-44 rounded-md border border-input bg-secondary/40 px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        placeholder="Filter logs…"
        bind:value={query}
      />
      <span class="text-xs text-muted-foreground">{rendered.length}/{filtered.length}</span>
      <button
        class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        onclick={copyVisible}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        onclick={onClear}
      >
        Clear
      </button>
    </div>
  </div>

  <div
    bind:this={scroller}
    class="mt-2 h-40 overflow-y-auto rounded-md border border-border bg-secondary/20 p-2"
  >
    {#if filtered.length === 0}
      <div class="text-sm text-muted-foreground">No logs yet.</div>
    {:else}
      <div class="space-y-0.5 font-mono text-xs">
        {#each rendered as l (l.id)}
          <div class="flex min-w-0 gap-3">
            <span class="w-[72px] shrink-0 text-muted-foreground">{timeFmt.format(l.ts)}</span>
            <span class="shrink-0 uppercase {levelClass(l.level)}">{l.level}</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">
              {l.message}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

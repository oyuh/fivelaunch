<script lang="ts">
  import type { AppLogEntry, AppLogLevel } from '../types'
  import SegmentedControl from './ui/SegmentedControl.svelte'
  import Button from './ui/Button.svelte'

  let {
    logs,
    onClear
  }: {
    logs: AppLogEntry[]
    onClear: () => void
  } = $props()

  // Logs live in the parent for the whole app session, so this panel shows the
  // full history every time it opens. Default to the combined view.
  let source = $state<'all' | AppLogEntry['source']>('all')
  let level = $state<'all' | AppLogLevel>('all')
  let query = $state('')
  let copied = $state(false)
  let scroller = $state<HTMLDivElement | null>(null)

  const MAX_RENDERED = 300

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return logs
      .filter((l) => source === 'all' || l.source === source)
      .filter((l) => level === 'all' || l.level === level)
      .filter((l) => !q || l.message.toLowerCase().includes(q))
      .sort((a, b) => a.ts - b.ts || a.id - b.id)
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
    if (bottomGap < 80) el.scrollTop = el.scrollHeight
  })

  function levelClass(l: AppLogLevel): string {
    switch (l) {
      case 'error':
        return 'text-red-300'
      case 'warn':
        return 'text-amber-300'
      case 'debug':
        return 'text-sky-300/80'
      default:
        return 'text-emerald-200'
    }
  }

  function sourceClass(s: AppLogEntry['source']): string {
    return s === 'launch' ? 'text-primary/80' : 'text-violet-300/80'
  }

  async function copyVisible(): Promise<void> {
    const text = rendered
      .map((l) => `${timeFmt.format(l.ts)} [${l.source}/${l.level}] ${l.message}`)
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

<section class="rounded-lg bg-surface-1 p-3">
  <div class="flex flex-wrap items-center gap-2">
    <div class="mr-auto">
      <h3 class="font-display text-sm font-bold">Logs</h3>
      <p class="text-xs text-muted-foreground">Kept for the whole session, until you close FiveLaunch.</p>
    </div>

    <SegmentedControl
      bind:value={source}
      options={[
        { value: 'all', label: 'All' },
        { value: 'launch', label: 'Launch' },
        { value: 'main', label: 'App' }
      ]}
    />
    <SegmentedControl
      bind:value={level}
      options={[
        { value: 'all', label: 'All' },
        { value: 'info', label: 'Info' },
        { value: 'warn', label: 'Warn' },
        { value: 'error', label: 'Error' },
        { value: 'debug', label: 'Debug' }
      ]}
    />

    <input
      class="w-40 rounded-md border border-input bg-surface-2 px-2 py-1 text-xs outline-none transition placeholder:text-muted-foreground focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
      placeholder="Filter…"
      bind:value={query}
    />
    <span class="font-mono text-xs text-muted-foreground">{rendered.length}/{filtered.length}</span>
    <Button variant="subtle" size="sm" onclick={copyVisible}>{copied ? 'Copied' : 'Copy'}</Button>
    <Button variant="subtle" size="sm" onclick={onClear}>Clear</Button>
  </div>

  <div
    bind:this={scroller}
    class="mt-2 h-44 overflow-y-auto rounded-md bg-background/60 p-2"
  >
    {#if filtered.length === 0}
      <div class="px-1 py-2 text-sm text-muted-foreground">No matching logs.</div>
    {:else}
      <div class="space-y-0.5 font-mono text-xs">
        {#each rendered as l (l.id)}
          <div class="flex min-w-0 gap-3">
            <span class="w-[64px] shrink-0 text-muted-foreground/70">{timeFmt.format(l.ts)}</span>
            <span class="w-12 shrink-0 uppercase {sourceClass(l.source)}">
              {l.source === 'launch' ? 'launch' : 'app'}
            </span>
            <span class="w-10 shrink-0 uppercase {levelClass(l.level)}">{l.level}</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">
              {l.message}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

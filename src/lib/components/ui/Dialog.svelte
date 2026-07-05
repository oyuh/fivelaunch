<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    open = $bindable(false),
    title,
    description = '',
    maxWidth = 'max-w-lg',
    children
  }: {
    open?: boolean
    title: string
    description?: string
    maxWidth?: string
    children: Snippet
  } = $props()

  function close(): void {
    open = false
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') close()
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      onclick={close}
      aria-label="Close dialog"
      tabindex="-1"
    ></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class="relative flex max-h-[85vh] w-full {maxWidth} flex-col rounded-lg border border-border bg-card p-5 shadow-2xl"
    >
      <header class="mb-1 flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">{title}</h2>
          {#if description}
            <p class="mt-1 text-sm text-muted-foreground">{description}</p>
          {/if}
        </div>
        <button
          class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onclick={close}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="2" y1="2" x2="12" y2="12" />
            <line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto pr-1">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fly } from 'svelte/transition'

  let {
    open = $bindable(false),
    align = 'start',
    width = 'w-60',
    trigger,
    children
  }: {
    open?: boolean
    align?: 'start' | 'end'
    width?: string
    /** Receives { toggle, open }: render your trigger button. */
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>
    /** Receives { close }: render menu content. */
    children: Snippet<[{ close: () => void }]>
  } = $props()

  let root = $state<HTMLDivElement | null>(null)

  const toggle = (): void => {
    open = !open
  }
  const close = (): void => {
    open = false
  }

  function onDocClick(e: MouseEvent): void {
    if (open && root && !root.contains(e.target as Node)) open = false
  }
  function onKey(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') open = false
  }
</script>

<svelte:window onclick={onDocClick} onkeydown={onKey} />

<div bind:this={root} class="relative inline-block">
  {@render trigger({ toggle, open })}

  {#if open}
    <div
      class="absolute z-40 mt-2 {align === 'end' ? 'right-0' : 'left-0'} {width}
        rounded-lg border border-border bg-popover p-1.5 shadow-2xl"
      transition:fly={{ y: -6, duration: 130 }}
    >
      {@render children({ close })}
    </div>
  {/if}
</div>

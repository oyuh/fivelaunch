<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  let {
    icon,
    label,
    description = '',
    active = false,
    prominent = false,
    disabled = false,
    onclick,
    trailing
  }: {
    icon?: string
    label: string
    description?: string
    active?: boolean
    /** Highlighted, larger entry — for the primary action in a menu. */
    prominent?: boolean
    disabled?: boolean
    onclick?: (e: MouseEvent) => void
    trailing?: Snippet
  } = $props()
</script>

<button
  type="button"
  {disabled}
  style={prominent ? 'border-color: hsl(var(--primary) / 0.5)' : undefined}
  class="flex w-full items-start gap-3 rounded-md text-left transition-colors
    disabled:pointer-events-none disabled:opacity-45
    {prominent
    ? 'border bg-primary/15 px-3 py-3 hover:bg-primary/25'
    : active
      ? 'bg-accent-wash px-2.5 py-2 text-foreground'
      : 'px-2.5 py-2 text-foreground hover:bg-surface-3'}"
  {onclick}
>
  {#if icon}
    <Icon
      name={icon}
      size={prominent ? 18 : 16}
      class="mt-0.5 shrink-0 {prominent || active ? 'text-primary' : 'text-muted-foreground'}"
    />
  {/if}
  <span class="min-w-0 flex-1">
    <span
      class="block truncate font-medium {prominent ? 'text-[15px] font-semibold text-primary' : 'text-sm'}"
    >{label}</span>
    {#if description}
      <span class="mt-0.5 block text-xs text-muted-foreground">{description}</span>
    {/if}
  </span>
  {#if trailing}
    <span class="mt-0.5 shrink-0">{@render trailing()}</span>
  {/if}
</button>

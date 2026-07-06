<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  let {
    icon,
    label,
    description = '',
    active = false,
    disabled = false,
    onclick,
    trailing
  }: {
    icon?: string
    label: string
    description?: string
    active?: boolean
    disabled?: boolean
    onclick?: (e: MouseEvent) => void
    trailing?: Snippet
  } = $props()
</script>

<button
  type="button"
  {disabled}
  class="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors
    disabled:pointer-events-none disabled:opacity-45
    {active ? 'bg-accent-wash text-foreground' : 'text-foreground hover:bg-surface-3'}"
  {onclick}
>
  {#if icon}
    <Icon
      name={icon}
      size={16}
      class="mt-0.5 shrink-0 {active ? 'text-primary' : 'text-muted-foreground'}"
    />
  {/if}
  <span class="min-w-0 flex-1">
    <span class="block truncate text-sm font-medium">{label}</span>
    {#if description}
      <span class="mt-0.5 block text-xs text-muted-foreground">{description}</span>
    {/if}
  </span>
  {#if trailing}
    <span class="mt-0.5 shrink-0">{@render trailing()}</span>
  {/if}
</button>

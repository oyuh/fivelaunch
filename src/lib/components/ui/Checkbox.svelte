<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  let {
    checked = $bindable(false),
    label,
    disabled = false,
    children
  }: {
    checked?: boolean
    label?: string
    disabled?: boolean
    children?: Snippet
  } = $props()
</script>

<button
  type="button"
  role="checkbox"
  aria-checked={checked}
  {disabled}
  class="flex items-start gap-3 text-left transition-opacity disabled:opacity-45"
  onclick={() => (checked = !checked)}
>
  <span
    class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors
      {checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2'}"
  >
    {#if checked}<Icon name="check" size={13} stroke={3} />{/if}
  </span>
  <span class="text-sm">
    {#if children}{@render children()}{:else}{label}{/if}
  </span>
</button>

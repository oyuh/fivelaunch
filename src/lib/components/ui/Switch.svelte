<script lang="ts">
  let {
    checked = false,
    disabled = false,
    label,
    onchange
  }: {
    checked?: boolean
    disabled?: boolean
    /** Accessible label. */
    label: string
    onchange?: (checked: boolean) => void
  } = $props()
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
    focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45
    {checked ? 'bg-primary' : 'bg-surface-3'}"
  onclick={() => onchange?.(!checked)}
>
  <span
    class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
      {checked ? 'translate-x-4' : 'translate-x-0.5'}"
  ></span>
</button>

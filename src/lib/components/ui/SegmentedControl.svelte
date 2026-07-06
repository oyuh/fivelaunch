<script lang="ts">
  type Option = { value: string; label: string }

  let {
    value = $bindable(''),
    options,
    onchange
  }: {
    value?: string
    options: Option[]
    onchange?: (value: string) => void
  } = $props()

  function select(v: string): void {
    value = v
    onchange?.(v)
  }
</script>

<div class="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
  {#each options as opt (opt.value)}
    <button
      type="button"
      class="rounded px-2.5 py-1 text-xs font-medium transition-colors
        {value === opt.value
        ? 'bg-surface-3 text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => select(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

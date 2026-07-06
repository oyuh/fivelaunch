<script lang="ts">
  let {
    value = $bindable(''),
    mono = false,
    size = 'md',
    class: klass = '',
    ...rest
  }: {
    value?: string
    /** Use the pixel/mono font (paths, hex, etc.). */
    mono?: boolean
    size?: 'sm' | 'md'
    class?: string
    [key: string]: unknown
  } = $props()

  const sizes = { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3 text-sm' }
</script>

<input
  bind:value
  class="w-full rounded-md border border-input bg-surface-2 text-foreground outline-none
    transition placeholder:text-muted-foreground focus:border-ring/40 focus:ring-2 focus:ring-ring/60
    {sizes[size]} {mono ? 'font-mono' : ''} {klass}"
  {...rest}
/>

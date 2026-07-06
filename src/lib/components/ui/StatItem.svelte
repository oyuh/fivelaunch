<script lang="ts">
  // Decardified stat: a small uppercase label above a prominent pixel-font value.
  let {
    label,
    value,
    mono = true,
    class: klass = ''
  }: {
    label: string
    value: string
    mono?: boolean
    class?: string
  } = $props()
</script>

<div class={klass}>
  <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
  <p class="mt-1 truncate text-lg font-semibold text-foreground {mono ? 'font-mono' : ''}">
    {value}
  </p>
</div>

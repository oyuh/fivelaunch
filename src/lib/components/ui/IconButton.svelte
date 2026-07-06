<script lang="ts">
  import Icon from './Icon.svelte'
  import { tooltip } from '../../actions/tooltip'

  let {
    icon,
    iconSvg,
    label,
    title,
    size = 'md',
    active = false,
    disabled = false,
    onclick
  }: {
    icon?: string
    iconSvg?: string
    /** Accessible label (icon-only button). */
    label: string
    title?: string
    size?: 'sm' | 'md'
    active?: boolean
    disabled?: boolean
    onclick?: (e: MouseEvent) => void
  } = $props()

  const box = $derived(size === 'sm' ? 'h-7 w-7' : 'h-9 w-9')
  const glyph = $derived(size === 'sm' ? 15 : 17)
</script>

<button
  type="button"
  use:tooltip={title ?? label}
  {disabled}
  aria-label={label}
  aria-pressed={active}
  class="inline-flex shrink-0 items-center justify-center rounded-md transition-colors
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
    disabled:pointer-events-none disabled:opacity-45 {box}
    {active
      ? 'bg-accent-wash text-primary'
      : 'text-muted-foreground hover:bg-surface-3 hover:text-foreground'}"
  {onclick}
>
  <Icon name={icon} svg={iconSvg} size={glyph} />
</button>

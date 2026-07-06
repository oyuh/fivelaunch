<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'
  import { tooltip } from '../../actions/tooltip'

  type Variant = 'primary' | 'hero' | 'destructive' | 'outline' | 'ghost' | 'subtle'
  type Size = 'sm' | 'md' | 'lg'

  let {
    variant = 'subtle',
    size = 'md',
    icon,
    iconSvg,
    loading = false,
    disabled = false,
    full = false,
    type = 'button',
    title,
    ariaLabel,
    class: klass = '',
    onclick,
    children
  }: {
    variant?: Variant
    size?: Size
    /** UI_ICONS key for a leading icon. */
    icon?: string
    /** Raw inner SVG for a leading icon (overrides `icon`). */
    iconSvg?: string
    loading?: boolean
    disabled?: boolean
    full?: boolean
    type?: 'button' | 'submit'
    title?: string
    ariaLabel?: string
    /** Extra classes appended last (can override size/height). */
    class?: string
    onclick?: (e: MouseEvent) => void
    children?: Snippet
  } = $props()

  // Shared: rounded, flex, font, transition, focus ring, disabled handling.
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap ' +
    'transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
    'disabled:pointer-events-none disabled:opacity-45'

  // Flat fills with a "shadow-that-looks-like-a-border" (shadow-btn) and a small
  // hover lift (no glow).
  const variants: Record<Variant, string> = {
    primary:
      'bg-primary text-primary-foreground shadow-btn hover:-translate-y-px hover:brightness-105 hover:shadow-btn-hover active:translate-y-0 active:brightness-95',
    hero:
      'bg-primary text-primary-foreground shadow-btn hover:-translate-y-px hover:brightness-105 hover:shadow-btn-hover active:translate-y-0 active:brightness-95',
    destructive:
      'bg-destructive text-destructive-foreground shadow-btn hover:-translate-y-px hover:brightness-110 hover:shadow-btn-hover active:translate-y-0 active:brightness-95',
    outline:
      'border border-border bg-surface-2 text-foreground shadow-btn hover:-translate-y-px hover:border-white/15 hover:bg-surface-3 hover:shadow-btn-hover active:translate-y-0',
    ghost: 'text-muted-foreground hover:bg-surface-3 hover:text-foreground',
    subtle:
      'bg-surface-2 text-foreground shadow-btn hover:-translate-y-px hover:bg-surface-3 hover:shadow-btn-hover active:translate-y-0'
  }

  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-12 px-7 text-base'
  }

  const iconSize = $derived(size === 'lg' ? 20 : size === 'sm' ? 14 : 16)
  const cls = $derived(
    [base, variants[variant], sizes[size], full ? 'w-full' : '', klass].join(' ')
  )
</script>

<button
  {type}
  use:tooltip={title}
  class={cls}
  disabled={disabled || loading}
  aria-label={ariaLabel}
  aria-busy={loading}
  {onclick}
>
  {#if loading}
    <span
      class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    ></span>
  {:else if iconSvg}
    <Icon svg={iconSvg} size={iconSize} class="shrink-0" />
  {:else if icon}
    <Icon name={icon} size={iconSize} class="shrink-0" />
  {/if}
  {#if children}{@render children()}{/if}
</button>

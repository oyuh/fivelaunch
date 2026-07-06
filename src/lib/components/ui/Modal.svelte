<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import Icon from './Icon.svelte'
  import { tooltip } from '../../actions/tooltip'

  let {
    open = $bindable(false),
    title,
    description = '',
    icon,
    iconSvg,
    size = 'md',
    onClose,
    footer,
    children
  }: {
    open?: boolean
    title: string
    description?: string
    /** UI_ICONS key shown in an accent tile beside the title. */
    icon?: string
    iconSvg?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    onClose?: () => void
    footer?: Snippet
    children: Snippet
  } = $props()

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  }

  function close(): void {
    open = false
    onClose?.()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') close()
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
      onclick={close}
      aria-label="Close dialog"
      tabindex="-1"
      transition:fade={{ duration: 130 }}
    ></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class="relative flex max-h-[86vh] w-full {widths[size]} flex-col overflow-hidden rounded-lg
        border border-border bg-surface-1 shadow-2xl"
      transition:scale={{ duration: 150, start: 0.97, opacity: 0 }}
    >
      <header class="flex items-start justify-between gap-4 border-b border-divider p-5">
        <div class="flex min-w-0 items-start gap-3">
          {#if icon || iconSvg}
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-wash text-primary"
            >
              <Icon name={icon} svg={iconSvg} size={18} />
            </span>
          {/if}
          <div class="min-w-0">
            <h2 class="font-display text-lg font-bold leading-tight tracking-tight">{title}</h2>
            {#if description}
              <p class="mt-1 text-sm text-muted-foreground">{description}</p>
            {/if}
          </div>
        </div>
        <button
          class="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          onclick={close}
          aria-label="Close"
          use:tooltip={'Close'}
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        {@render children()}
      </div>

      {#if footer}
        <footer class="flex items-center justify-end gap-2 border-t border-divider bg-surface-2/40 p-4">
          {@render footer()}
        </footer>
      {/if}
    </div>
  </div>
{/if}

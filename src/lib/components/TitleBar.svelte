<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { api } from '../api'
  import { tooltip } from '../actions/tooltip'
  import logo from '../../assets/logo.png'

  let {
    appVersion = '',
    onOpenSettings
  }: {
    appVersion?: string
    onOpenSettings: () => void
  } = $props()

  const appWindow = getCurrentWindow()
</script>

<header
  data-tauri-drag-region
  class="flex h-11 shrink-0 select-none items-center justify-between border-b border-divider bg-surface-1"
>
  <div data-tauri-drag-region class="flex items-center gap-2.5 pl-3.5">
    <span
      class="pointer-events-none block h-6 shrink-0 bg-foreground"
      style="width: 2.55rem; -webkit-mask: url('{logo}') center / contain no-repeat; mask: url('{logo}') center / contain no-repeat;"
      role="img"
      aria-label="FiveLaunch"
    ></span>
    <span class="pointer-events-none font-display text-[15px] font-bold tracking-tight">
      FiveLaunch
    </span>
    {#if appVersion}
      <span
        class="pointer-events-none rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      >
        v{appVersion}
      </span>
    {/if}
  </div>

  <div class="flex h-full">
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={onOpenSettings}
      aria-label="Settings"
      use:tooltip={'Global settings'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => api.windowMinimize().catch(() => appWindow.minimize())}
      aria-label="Minimize"
      use:tooltip={'Minimize'}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="1" y1="6" x2="11" y2="6" />
      </svg>
    </button>
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => appWindow.toggleMaximize()}
      aria-label="Maximize"
      use:tooltip={'Maximize'}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      </svg>
    </button>
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
      onclick={() => appWindow.close()}
      aria-label="Close"
      use:tooltip={'Close'}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" />
        <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" />
      </svg>
    </button>
  </div>
</header>

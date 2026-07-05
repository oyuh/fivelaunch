<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import logo from '../../assets/logo.png'

  const appWindow = getCurrentWindow()
</script>

<header
  data-tauri-drag-region
  class="flex h-10 shrink-0 select-none items-center justify-between border-b border-border bg-background"
>
  <div data-tauri-drag-region class="flex items-center gap-2 pl-3">
    <img src={logo} alt="" class="pointer-events-none h-5 w-5" draggable="false" />
    <span class="pointer-events-none text-sm font-semibold tracking-wide">FiveLaunch</span>
  </div>

  <div class="flex h-full">
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => appWindow.minimize()}
      aria-label="Minimize"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="1" y1="6" x2="11" y2="6" />
      </svg>
    </button>
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => appWindow.toggleMaximize()}
      aria-label="Maximize"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      </svg>
    </button>
    <button
      class="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
      onclick={() => appWindow.close()}
      aria-label="Close"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" />
        <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" />
      </svg>
    </button>
  </div>
</header>

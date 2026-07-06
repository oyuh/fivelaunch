<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Switch from './ui/Switch.svelte'
  import Icon from './ui/Icon.svelte'
  import { tooltip } from '../actions/tooltip'
  import { api } from '../api'
  import {
    applyPrimaryHexToRoot,
    DEFAULT_PRIMARY_HEX,
    hexToHsl,
    hslToHex,
    isHexColor,
    type Hsl
  } from '../theme'

  let {
    open = $bindable(false),
    onSaved
  }: {
    open?: boolean
    /** Called after any setting persisted (App refreshes derived state). */
    onSaved?: () => void
  } = $props()

  let gamePath = $state('')
  let minimizeToTray = $state(false)
  let hexDraft = $state(DEFAULT_PRIMARY_HEX)
  let hsl = $state<Hsl>(hexToHsl(DEFAULT_PRIMARY_HEX))
  let saveError = $state<string | null>(null)
  let savedFlash = $state(false)

  // (Re)load settings each time the dialog opens.
  $effect(() => {
    if (!open) return
    void (async () => {
      try {
        const settings = await api.getSettings()
        gamePath = settings.gamePath ?? ''
        minimizeToTray = settings.minimizeToTrayOnGameLaunch
        const hex = settings.themePrimaryHex ?? DEFAULT_PRIMARY_HEX
        hexDraft = hex
        hsl = hexToHsl(hex)
      } catch (e) {
        saveError = String(e)
      }
    })()
  })

  const hueTrack =
    'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
  const satTrack = $derived(
    `linear-gradient(to right, hsl(${hsl.h} 0% ${hsl.l}%), hsl(${hsl.h} 100% ${hsl.l}%))`
  )
  const lightTrack = $derived(
    `linear-gradient(to right, hsl(${hsl.h} ${hsl.s}% 0%), hsl(${hsl.h} ${hsl.s}% 50%), hsl(${hsl.h} ${hsl.s}% 100%))`
  )
  const currentHex = $derived(hslToHex(hsl))

  function applyHex(hex: string): void {
    applyPrimaryHexToRoot(hex)
    api.setThemePrimaryHex(hex).catch((e) => (saveError = String(e)))
  }

  function setHslAndApply(next: Hsl): void {
    hsl = {
      h: Math.max(0, Math.min(360, Math.round(next.h))),
      s: Math.max(0, Math.min(100, Math.round(next.s))),
      l: Math.max(0, Math.min(100, Math.round(next.l)))
    }
    const hex = hslToHex(hsl)
    hexDraft = hex
    applyHex(hex)
  }

  function onHexInput(): void {
    const trimmed = hexDraft.trim()
    if (isHexColor(trimmed)) {
      hsl = hexToHsl(trimmed)
      applyHex(trimmed.toLowerCase())
    }
  }

  function resetTheme(): void {
    hexDraft = DEFAULT_PRIMARY_HEX
    hsl = hexToHsl(DEFAULT_PRIMARY_HEX)
    applyPrimaryHexToRoot(DEFAULT_PRIMARY_HEX)
    api.setThemePrimaryHex(null).catch((e) => (saveError = String(e)))
  }

  async function browse(): Promise<void> {
    try {
      const picked = await api.browseGamePath()
      if (picked) gamePath = picked
    } catch (e) {
      saveError = String(e)
    }
  }

  async function saveGamePath(): Promise<void> {
    try {
      await api.setGamePath(gamePath.trim())
      savedFlash = true
      setTimeout(() => (savedFlash = false), 1200)
      onSaved?.()
    } catch (e) {
      saveError = String(e)
    }
  }

  async function setTray(value: boolean): Promise<void> {
    minimizeToTray = value
    try {
      await api.setMinimizeToTrayOnGameLaunch(value)
      onSaved?.()
    } catch (e) {
      saveError = String(e)
    }
  }
</script>

<Modal
  bind:open
  title="Global settings"
  description="Set the default FiveM game data location (FiveM.app)."
  icon="settings"
>
  <div class="space-y-4">
    <div class="space-y-1.5">
      <div class="flex items-center gap-1.5">
        <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          FiveM.app location
        </p>
        <span
          class="cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          use:tooltip={"The folder where FiveM keeps its data (FiveM.app). FiveLaunch swaps each client's files in and out of here on launch. Usually %LOCALAPPDATA%\\FiveM\\FiveM.app."}
        >
          <Icon name="info" size={12} />
        </span>
      </div>
      <div class="flex gap-2">
        <Input
          mono
          bind:value={gamePath}
          placeholder="C:\Users\...\AppData\Local\FiveM\FiveM.app"
        />
        <Button variant="outline" onclick={browse} title="Pick your FiveM.app folder">Browse</Button>
        <Button variant="primary" disabled={!gamePath.trim()} onclick={saveGamePath}>
          {savedFlash ? 'Saved!' : 'Save'}
        </Button>
      </div>
    </div>

    <div class="flex items-center gap-3 rounded-lg bg-surface-2/60 p-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <p class="text-sm font-medium">Minimize to tray on launch</p>
          <span
            class="cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            use:tooltip={'Hides FiveLaunch to the system tray when you launch a client, so it stays out of your way while you play. Click the tray icon to restore it.'}
          >
            <Icon name="info" size={12} />
          </span>
        </div>
        <p class="text-xs text-muted-foreground">
          When you launch a client, FiveLaunch hides to the system tray. Click the tray icon to
          restore.
        </p>
      </div>
      <Switch
        label="Minimize to tray on game launch"
        checked={minimizeToTray}
        onchange={setTray}
      />
    </div>

    <div class="rounded-lg bg-surface-2/60 p-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-1.5">
            <div class="text-sm font-medium">Theme color</div>
            <span
              class="cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              use:tooltip={'Sets the accent color used on buttons, highlights, and the launch button. Pick any color; Reset returns to the default gold.'}
            >
              <Icon name="info" size={12} />
            </span>
          </div>
          <div class="text-xs text-muted-foreground">
            Changes the app primary color (buttons, highlights).
          </div>
        </div>
        <button
          class="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          onclick={resetTheme}
        >
          Reset
        </button>
      </div>

      <div class="mt-3 flex items-center gap-3">
        <div
          class="h-9 w-12 shrink-0 rounded-md border border-border"
          style="background-color: {currentHex}"
          aria-label="Current theme color"
        ></div>
        <input
          class="min-w-0 flex-1 rounded-md border border-input bg-surface-2 px-3 py-1.5 font-mono text-sm outline-none transition focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
          placeholder="#rrggbb"
          bind:value={hexDraft}
          oninput={onHexInput}
        />
      </div>

      <div class="mt-3 flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="w-20 font-mono text-xs text-muted-foreground">Hue</span>
          <input
            type="range"
            min="0"
            max="360"
            value={hsl.h}
            class="theme-slider flex-1"
            style="--theme-slider-track: {hueTrack}"
            aria-label="Hue"
            oninput={(e) => setHslAndApply({ ...hsl, h: Number(e.currentTarget.value) })}
          />
          <span class="w-12 text-right font-mono text-xs text-muted-foreground">{hsl.h}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-20 font-mono text-xs text-muted-foreground">Saturation</span>
          <input
            type="range"
            min="0"
            max="100"
            value={hsl.s}
            class="theme-slider flex-1"
            style="--theme-slider-track: {satTrack}"
            aria-label="Saturation"
            oninput={(e) => setHslAndApply({ ...hsl, s: Number(e.currentTarget.value) })}
          />
          <span class="w-12 text-right font-mono text-xs text-muted-foreground">{hsl.s}%</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-20 font-mono text-xs text-muted-foreground">Lightness</span>
          <input
            type="range"
            min="0"
            max="100"
            value={hsl.l}
            class="theme-slider flex-1"
            style="--theme-slider-track: {lightTrack}"
            aria-label="Lightness"
            oninput={(e) => setHslAndApply({ ...hsl, l: Number(e.currentTarget.value) })}
          />
          <span class="w-12 text-right font-mono text-xs text-muted-foreground">{hsl.l}%</span>
        </div>
      </div>
    </div>

    {#if saveError}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        {saveError}
      </div>
    {/if}
  </div>
</Modal>

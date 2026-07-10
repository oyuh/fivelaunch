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

  // Snapshot ("My Setup") state
  let snapshotClient = $state<{ id: string; name: string } | null>(null)
  let snapshotBusy = $state(false)
  let snapshotFlash = $state<string | null>(null)
  let snapshotError = $state<string | null>(null)

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
        snapshotError = null
        snapshotFlash = null
        await loadSnapshotState(settings.snapshotClientId ?? null)
      } catch (e) {
        saveError = String(e)
      }
    })()
  })

  async function loadSnapshotState(id: string | null): Promise<void> {
    if (!id) {
      snapshotClient = null
      return
    }
    const clients = await api.getClients()
    const found = clients.find((c) => c.id === id)
    snapshotClient = found ? { id: found.id, name: found.name } : null
  }

  async function createSnapshot(): Promise<void> {
    if (snapshotBusy) return
    snapshotBusy = true
    snapshotError = null
    try {
      const created = await api.createSnapshotClient()
      snapshotClient = { id: created.id, name: created.name }
      snapshotFlash = 'Snapshot created!'
      setTimeout(() => (snapshotFlash = null), 2000)
      onSaved?.()
    } catch (e) {
      snapshotError = String(e)
    } finally {
      snapshotBusy = false
    }
  }

  async function restoreSnapshotNow(): Promise<void> {
    if (snapshotBusy) return
    snapshotBusy = true
    snapshotError = null
    try {
      await api.restoreSnapshotNow()
      snapshotFlash = 'Your setup is restored!'
      setTimeout(() => (snapshotFlash = null), 2000)
    } catch (e) {
      snapshotError = String(e)
    } finally {
      snapshotBusy = false
    }
  }

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

  // Uninstall flow
  let uninstallConfirmOpen = $state(false)
  let uninstalling = $state(false)
  let uninstallError = $state<string | null>(null)

  function openDataFolder(): void {
    api.openAppDataFolder().catch((e) => (uninstallError = String(e)))
  }

  async function uninstall(): Promise<void> {
    if (uninstalling) return
    uninstalling = true
    uninstallError = null
    try {
      // On success the app data is gone, the uninstaller starts, and the
      // app exits — this promise never resolves in that case.
      await api.uninstallApp()
    } catch (e) {
      uninstallError = String(e)
      uninstalling = false
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

    <!-- Snapshot -->
    <div class="rounded-lg bg-surface-2/60 p-3">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <p class="text-sm font-medium">Snapshot · My Setup</p>
            <span
              class="cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              use:tooltip={'Your baseline FiveM state, kept as a client. After every session (and on demand here), FiveM goes back to it — mods, plugins, citizen, GTA settings, CitizenFX.ini.'}
            >
              <Icon name="info" size={12} />
            </span>
          </div>
          <p class="text-xs text-muted-foreground">
            {#if snapshotClient}
              Baseline: <span class="font-medium text-foreground">{snapshotClient.name}</span> ·
              every session restores to it on close.
            {:else}
              No snapshot yet. Capture your current FiveM files as the baseline that every
              session returns to.
            {/if}
          </p>
        </div>
        {#if snapshotClient}
          <Button
            variant="outline"
            size="sm"
            icon="refresh"
            loading={snapshotBusy}
            onclick={restoreSnapshotNow}
            title="Put FiveM back to your snapshot right now"
          >
            {snapshotFlash ?? 'Restore now'}
          </Button>
        {:else}
          <Button
            variant="primary"
            size="sm"
            icon="copy"
            loading={snapshotBusy}
            onclick={createSnapshot}
          >
            {snapshotFlash ?? 'Create snapshot'}
          </Button>
        {/if}
      </div>
      {#if snapshotError}
        <div class="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          {snapshotError}
        </div>
      {/if}
    </div>

    <!-- Danger zone -->
    <div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">Uninstall FiveLaunch</p>
          <p class="text-xs text-muted-foreground">
            Removes the app and all of its data — every client, settings, and backups.
          </p>
        </div>
        <Button variant="destructive" icon="trash" onclick={() => (uninstallConfirmOpen = true)}>
          Uninstall…
        </Button>
      </div>
    </div>

    {#if saveError}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        {saveError}
      </div>
    {/if}
  </div>
</Modal>

<Modal
  bind:open={uninstallConfirmOpen}
  title="Uninstall FiveLaunch?"
  description="This removes the app and permanently deletes all of its data."
  icon="alert"
  size="md"
>
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-muted-foreground">
      Everything in <span class="font-mono text-xs">%APPDATA%\FiveLaunch</span> is deleted:
      every client (mods, plugins, settings), your app settings, and backup history. Then the
      Windows uninstaller runs to remove the app itself. This cannot be undone.
    </p>

    <div class="flex items-center gap-3 rounded-lg border border-primary/30 bg-accent-wash p-3">
      <Icon name="info" size={16} class="shrink-0 text-primary" />
      <p class="min-w-0 flex-1 text-sm leading-relaxed">
        Want to keep your clients? Copy the <span class="font-mono text-xs">clients</span> folder
        somewhere safe <span class="font-semibold">before</span> uninstalling.
      </p>
      <Button variant="outline" size="sm" icon="folderOpen" onclick={openDataFolder}>
        Open data folder
      </Button>
    </div>

    {#if uninstallError}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        {uninstallError}
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (uninstallConfirmOpen = false)}>Cancel</Button>
    <Button variant="destructive" icon="trash" loading={uninstalling} onclick={uninstall}>
      Delete everything & uninstall
    </Button>
  {/snippet}
</Modal>

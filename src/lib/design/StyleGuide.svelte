<script lang="ts">
  import Button from '../components/ui/Button.svelte'
  import Input from '../components/ui/Input.svelte'
  import IconButton from '../components/ui/IconButton.svelte'
  import Icon from '../components/ui/Icon.svelte'
  import Modal from '../components/ui/Modal.svelte'
  import ConfirmDialog from '../components/ui/ConfirmDialog.svelte'
  import Menu from '../components/ui/Menu.svelte'
  import MenuItem from '../components/ui/MenuItem.svelte'
  import SegmentedControl from '../components/ui/SegmentedControl.svelte'
  import StatItem from '../components/ui/StatItem.svelte'
  import { CLIENT_ICONS, UI_ICONS } from '../components/ui/icons'
  import { tooltip } from '../actions/tooltip'

  let demoModal = $state(false)
  let demoConfirm = $state(false)
  let seg = $state('launch')

  const pixelVariants = [
    { family: 'Geist Pixel Square', name: 'Square (default)' },
    { family: 'Geist Pixel Grid', name: 'Grid' },
    { family: 'Geist Pixel Circle', name: 'Circle' },
    { family: 'Geist Pixel Triangle', name: 'Triangle' },
    { family: 'Geist Pixel Line', name: 'Line' }
  ]

  const swatches = [
    { name: 'background', cls: 'bg-background' },
    { name: 'surface-1', cls: 'bg-surface-1' },
    { name: 'surface-2', cls: 'bg-surface-2' },
    { name: 'surface-3', cls: 'bg-surface-3' },
    { name: 'primary', cls: 'bg-primary' },
    { name: 'destructive', cls: 'bg-destructive' },
    { name: 'muted', cls: 'bg-muted' },
    { name: 'border', cls: 'bg-border' }
  ]

  const uiGlyphs = Object.keys(UI_ICONS)
</script>

<div class="min-h-screen bg-background px-8 py-10 text-foreground">
  <div class="mx-auto max-w-5xl space-y-14">
    <!-- Title -->
    <header>
      <p class="font-mono text-xs uppercase tracking-[0.2em] text-primary">Design System</p>
      <h1 class="mt-2 font-display text-4xl font-extrabold tracking-tight">FiveLaunch</h1>
      <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
        Tokens and reusable components that keep every surface consistent. View with
        <code class="font-mono text-primary">bun run ui</code> →
        <code class="font-mono text-primary">?screen=styleguide</code>.
      </p>
    </header>

    <!-- Typography -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Typography</h2>
      <div class="space-y-3 rounded-lg border border-divider bg-surface-1 p-6">
        <p class="font-display text-3xl font-extrabold">Archivo · super headers</p>
        <p class="font-sans text-base">
          Raleway · the body & UI typeface. The quick brown fox jumps over 13 lazy dogs.
        </p>
        <p class="font-sans text-sm font-semibold">Raleway Semibold · labels and buttons</p>
        <div class="border-t border-divider pt-3">
          <p class="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Geist Pixel · technical text (IDs, paths, logs, numbers). Compare variants:
          </p>
          <div class="space-y-2">
            {#each pixelVariants as v (v.family)}
              <div class="flex items-baseline gap-4">
                <span class="w-36 shrink-0 text-xs text-muted-foreground">{v.name}</span>
                <span class="text-sm" style="font-family: '{v.family}'">
                  0123456789 · C:\FiveM\FiveM.app · 6.4 GB
                </span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </section>

    <!-- Colors -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Colors & surfaces</h2>
      <div class="grid grid-cols-4 gap-3 sm:grid-cols-8">
        {#each swatches as s (s.name)}
          <div class="space-y-1.5">
            <div class="h-14 rounded-md border border-divider {s.cls}"></div>
            <p class="font-mono text-[10px] text-muted-foreground">{s.name}</p>
          </div>
        {/each}
      </div>
      <div class="flex items-center gap-4">
        <div class="h-14 flex-1 rounded-md bg-primary shadow-btn"></div>
        <p class="text-xs text-muted-foreground">
          Flat fills with <code class="font-mono text-primary">shadow-btn</code> · a shadow that reads
          like a border (no glow).
        </p>
      </div>
    </section>

    <!-- Buttons -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Buttons</h2>
      <div class="space-y-4 rounded-lg border border-divider bg-surface-1 p-6">
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="hero" size="lg" icon="play">Launch</Button>
          <Button variant="primary" icon="check">Primary</Button>
          <Button variant="destructive" icon="trash">Delete</Button>
          <Button variant="outline" icon="folder">Outline</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="ghost" icon="settings">Ghost</Button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="md">Medium</Button>
          <Button variant="primary" size="lg">Large</Button>
          <Button variant="primary" loading>Loading</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <IconButton icon="search" label="Search" />
          <IconButton icon="plus" label="Add" />
          <IconButton icon="settings" label="Settings" active />
          <IconButton icon="ellipsis" label="More" />
        </div>
      </div>
    </section>

    <!-- Inputs & controls -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Inputs & controls</h2>
      <div class="grid gap-4 rounded-lg border border-divider bg-surface-1 p-6 sm:grid-cols-2">
        <Input placeholder="Search clients…" />
        <Input mono placeholder="C:\Users\…\FiveM.app" />
        <SegmentedControl
          bind:value={seg}
          options={[
            { value: 'launch', label: 'Launch' },
            { value: 'app', label: 'App' }
          ]}
        />
        <Menu align="start">
          {#snippet trigger({ toggle, open })}
            <Button variant="outline" icon="link" onclick={toggle}>Menu {open ? '▲' : '▼'}</Button>
          {/snippet}
          {#snippet children({ close })}
            <MenuItem icon="folder" label="Client folder" description="Open on disk" onclick={close} />
            <MenuItem icon="folderOpen" label="FiveM folder" onclick={close} />
            <MenuItem icon="externalLink" label="Website" onclick={close} />
          {/snippet}
        </Menu>
      </div>
    </section>

    <!-- Stats -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Stats (decardified)</h2>
      <div class="flex gap-10 rounded-lg border border-divider bg-surface-1 p-6">
        <StatItem label="Files" value="3,284" />
        <StatItem label="Size" value="6.4 GB" />
        <StatItem label="Last played" value="2h ago" mono={false} />
      </div>
    </section>

    <!-- Client icons -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Client icons ({CLIENT_ICONS.length})</h2>
      <div class="grid grid-cols-5 gap-3 sm:grid-cols-10">
        {#each CLIENT_ICONS as ic (ic.key)}
          <div class="flex flex-col items-center gap-1.5">
            <div
              class="flex h-11 w-11 items-center justify-center rounded-md bg-accent-wash text-primary"
            >
              <Icon svg={ic.svg} size={20} />
            </div>
            <span class="text-[10px] text-muted-foreground">{ic.label}</span>
          </div>
        {/each}
      </div>
    </section>

    <!-- UI glyphs -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">UI glyphs</h2>
      <div class="grid grid-cols-6 gap-3 sm:grid-cols-12">
        {#each uiGlyphs as g (g)}
          <div class="flex flex-col items-center gap-1.5 text-muted-foreground">
            <div class="flex h-10 w-10 items-center justify-center rounded-md bg-surface-2">
              <Icon name={g} size={18} />
            </div>
            <span class="text-[9px]">{g}</span>
          </div>
        {/each}
      </div>
    </section>

    <!-- Overlays & tooltips -->
    <section class="space-y-4">
      <h2 class="font-display text-xl font-bold">Overlays & tooltips</h2>
      <div class="flex flex-wrap items-center gap-3">
        <Button variant="outline" icon="info" onclick={() => (demoModal = true)}>Open modal</Button>
        <Button variant="destructive" icon="trash" onclick={() => (demoConfirm = true)}>
          Confirm dialog
        </Button>
        <span
          class="cursor-default rounded-md bg-surface-2 px-3 py-2 text-sm text-muted-foreground"
          use:tooltip={'Custom themed tooltip · replaces the native one everywhere'}
        >
          Hover me for a tooltip
        </span>
      </div>
    </section>
  </div>
</div>

<Modal bind:open={demoModal} title="Example modal" description="Shared header, icon, and close." icon="info">
  <p class="text-sm text-muted-foreground">
    All dialogs use this component so headers, spacing, motion, and the close button stay identical.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (demoModal = false)}>Cancel</Button>
    <Button variant="primary" icon="check" onclick={() => (demoModal = false)}>Got it</Button>
  {/snippet}
</Modal>

<ConfirmDialog
  bind:open={demoConfirm}
  title="Delete client?"
  message="This permanently removes the client and its linked files. This cannot be undone."
  confirmLabel="Delete"
/>

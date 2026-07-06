<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Icon from './ui/Icon.svelte'
  import { tooltip } from '../actions/tooltip'
  import { api } from '../api'
  import {
    getSettingDefinition,
    getSettingHelp,
    humanizeKey,
    SETTING_CATEGORIES
  } from '../gtaSettingsMap'
  import type { GtaSettingsDocument, GtaSettingsItem } from '../types'

  let {
    open = $bindable(false),
    clientId
  }: {
    open?: boolean
    clientId: string | null
  } = $props()

  let doc = $state<GtaSettingsDocument>({ rootName: 'Settings', items: [] })
  let loading = $state(false)
  let dirty = $state(false)
  let error = $state<string | null>(null)
  let savedFlash = $state(false)
  let search = $state('')

  $effect(() => {
    if (!open || !clientId) return
    void load(clientId)
  })

  async function load(id: string): Promise<void> {
    loading = true
    error = null
    dirty = false
    search = ''
    try {
      doc = await api.getClientGtaSettings(id)
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  function settingNameFor(item: GtaSettingsItem): string {
    const parts = item.path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? item.path
  }

  const categorized = $derived.by(() => {
    const groups: Record<string, { item: GtaSettingsItem; index: number }[]> = {}
    doc.items.forEach((item, index) => {
      const name = settingNameFor(item)
      const def = getSettingDefinition(name)
      const category = def?.category || 'Other'
      ;(groups[category] ??= []).push({ item, index })
    })

    const sorted: [string, { item: GtaSettingsItem; index: number }[]][] = []
    for (const cat of SETTING_CATEGORIES) {
      if (groups[cat]?.length) sorted.push([cat, groups[cat]])
    }
    if (groups['Other']?.length) sorted.push(['Other', groups['Other']])
    return sorted
  })

  // Apply the search box across setting names within each category.
  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return categorized
    const out: [string, { item: GtaSettingsItem; index: number }[]][] = []
    for (const [cat, entries] of categorized) {
      const kept = entries.filter(({ item }) => {
        const name = settingNameFor(item)
        return humanizeKey(name).toLowerCase().includes(q) || name.toLowerCase().includes(q)
      })
      if (kept.length) out.push([cat, kept])
    }
    return out
  })

  function updateAttribute(index: number, attrKey: string, value: string): void {
    doc.items[index].attributes[attrKey] = value
    dirty = true
  }

  async function save(): Promise<void> {
    if (!clientId) return
    try {
      await api.saveClientGtaSettings(clientId, $state.snapshot(doc))
      dirty = false
      savedFlash = true
      setTimeout(() => (savedFlash = false), 1200)
    } catch (e) {
      error = String(e)
    }
  }

  async function importFromGame(): Promise<void> {
    if (!clientId) return
    loading = true
    error = null
    try {
      doc = await api.importGtaSettingsFromDocuments(clientId)
      dirty = false
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  async function loadTemplate(): Promise<void> {
    if (!clientId) return
    loading = true
    error = null
    try {
      doc = await api.importGtaSettingsFromTemplate(clientId)
      dirty = false
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }
</script>

<Modal
  bind:open
  title="GTA V settings"
  description="Edit this client's gta5_settings.xml · applied on launch when GTA settings is enabled."
  icon="sliders"
  size="xl"
>
  <div class="space-y-4">
    <!-- Toolbar: meta + search -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span class="rounded bg-surface-2 px-2 py-1 font-mono">{doc.rootName}</span>
        <span>{doc.items.length} entries</span>
        {#if loading}<span class="text-primary">· Loading…</span>{/if}
      </div>
      <div class="relative ml-auto w-56">
        <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          <Icon name="search" size={15} />
        </span>
        <input
          class="w-full rounded-md border border-input bg-surface-2 py-1.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
          placeholder="Search settings…"
          bind:value={search}
        />
      </div>
    </div>

    {#if error}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>
    {/if}

    {#if !loading}
      {#if visible.length === 0}
        <div class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {#if doc.items.length === 0}
            No settings yet. Import from the game or load the example template below.
          {:else}
            No settings match “{search}”.
          {/if}
        </div>
      {:else}
        {#each visible as [category, entries] (category)}
          <section class="overflow-hidden rounded-lg bg-surface-2/40">
            <header class="flex items-center gap-2 border-b border-divider px-4 py-2.5">
              <span class="h-2 w-2 rounded-full bg-primary"></span>
              <h3 class="text-sm font-semibold">{category}</h3>
              <span class="font-mono text-xs text-muted-foreground">{entries.length}</span>
            </header>

            <div class="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2">
              {#each entries as { item, index } (item.path + index)}
                {@const name = settingNameFor(item)}
                {@const def = getSettingDefinition(name)}
                {@const help = getSettingHelp(name)}
                {#each Object.entries(item.attributes) as [attrKey, value] (attrKey)}
                  <div class="space-y-1.5">
                    <div class="flex items-center gap-1.5">
                      <label class="text-xs font-medium text-muted-foreground" for="{item.path}-{attrKey}">
                        {humanizeKey(name)}
                      </label>
                      {#if help}
                        <span
                          class="cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                          use:tooltip={help}
                        >
                          <Icon name="info" size={12} />
                        </span>
                      {/if}
                    </div>

                    {#if def?.type === 'select' && def.options}
                      <select
                        id="{item.path}-{attrKey}"
                        class="h-9 w-full rounded-md border border-input bg-surface-2 px-3 text-sm outline-none transition focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
                        {value}
                        onchange={(e) => updateAttribute(index, attrKey, e.currentTarget.value)}
                      >
                        {#each def.options as opt (opt.value)}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    {:else if def?.type === 'slider'}
                      <div class="flex items-center gap-2">
                        <input
                          type="range"
                          min={def.min}
                          max={def.max}
                          step={def.step}
                          value={parseFloat(value) || 0}
                          class="theme-slider flex-1"
                          oninput={(e) => updateAttribute(index, attrKey, e.currentTarget.value)}
                        />
                        <span class="w-12 text-right font-mono text-xs text-muted-foreground">
                          {(parseFloat(value) || 0).toFixed(2)}
                        </span>
                      </div>
                    {:else}
                      <input
                        id="{item.path}-{attrKey}"
                        class="h-9 w-full rounded-md border border-input bg-surface-2 px-3 text-sm outline-none transition focus:border-ring/40 focus:ring-2 focus:ring-ring/60"
                        type={!Number.isNaN(Number(value)) && value.trim() !== '' ? 'number' : 'text'}
                        {value}
                        oninput={(e) => updateAttribute(index, attrKey, e.currentTarget.value)}
                      />
                    {/if}
                  </div>
                {/each}
              {/each}
            </div>
          </section>
        {/each}
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={importFromGame} disabled={!clientId || loading}>
      Import from game
    </Button>
    <Button variant="ghost" onclick={loadTemplate} disabled={!clientId || loading}>
      Load example
    </Button>
    <div class="flex-1"></div>
    <Button
      variant="primary"
      icon="check"
      onclick={save}
      disabled={!clientId || !dirty || loading}
    >
      {savedFlash ? 'Saved!' : 'Save changes'}
    </Button>
  {/snippet}
</Modal>

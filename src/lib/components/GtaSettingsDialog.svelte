<script lang="ts">
  import Dialog from './ui/Dialog.svelte'
  import { api } from '../api'
  import { getSettingDefinition, humanizeKey, SETTING_CATEGORIES } from '../gtaSettingsMap'
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

  $effect(() => {
    if (!open || !clientId) return
    void load(clientId)
  })

  async function load(id: string): Promise<void> {
    loading = true
    error = null
    dirty = false
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

<Dialog
  bind:open
  title="GTA V Settings Editor"
  description="Edit this client's gta5_settings.xml. Saved in the client folder and applied when you launch with GTA Settings enabled."
  maxWidth="max-w-3xl"
>
  <div class="mt-3 space-y-3">
    <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>Root element:</span>
      <span class="font-medium text-foreground">{doc.rootName}</span>
      <span>·</span>
      <span>{doc.items.length} entries</span>
      {#if loading}<span>· Loading…</span>{/if}
    </div>

    {#if error}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        {error}
      </div>
    {/if}

    {#if !loading}
      {#if categorized.length === 0}
        <div class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No settings found. Import from the game or load the example template below.
        </div>
      {:else}
        {#each categorized as [category, entries] (category)}
          <div class="rounded-md border border-border p-4">
            <div class="mb-3 flex items-center gap-2">
              <div class="h-1 w-1 rounded-full bg-primary"></div>
              <div class="text-sm font-semibold">{category}</div>
              <div class="text-xs text-muted-foreground">({entries.length})</div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              {#each entries as { item, index } (item.path + index)}
                {@const name = settingNameFor(item)}
                {@const def = getSettingDefinition(name)}
                {#each Object.entries(item.attributes) as [attrKey, value] (attrKey)}
                  <div class="rounded-md border border-border bg-card p-3">
                    <div class="flex flex-col gap-1">
                      <span class="text-xs font-medium text-muted-foreground">
                        {humanizeKey(name)}
                      </span>

                      {#if def?.type === 'select' && def.options}
                        <select
                          class="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
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
                          class="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                          type={!Number.isNaN(Number(value)) && value.trim() !== '' ? 'number' : 'text'}
                          {value}
                          oninput={(e) => updateAttribute(index, attrKey, e.currentTarget.value)}
                        />
                      {/if}
                    </div>
                  </div>
                {/each}
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    {/if}

    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          disabled={!clientId || loading}
          onclick={importFromGame}
        >
          Import from Game
        </button>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          disabled={!clientId || loading}
          onclick={loadTemplate}
        >
          Load Full Example
        </button>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!clientId || !dirty || loading}
          onclick={save}
        >
          {savedFlash ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
      <button
        class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        onclick={() => (open = false)}
      >
        Close
      </button>
    </div>
  </div>
</Dialog>

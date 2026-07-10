<script lang="ts">
  import Modal from './ui/Modal.svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Icon from './ui/Icon.svelte'
  import { api } from '../api'
  import type { ClientProfile, DuplicateOptions } from '../types'

  let {
    open = $bindable(false),
    client,
    onDuplicated
  }: {
    open?: boolean
    /** The client being duplicated. */
    client: ClientProfile | null
    /** Called with the new client so the caller can select it. */
    onDuplicated?: (created: ClientProfile) => void
  } = $props()

  let name = $state('')
  let options = $state<DuplicateOptions>({
    mods: true,
    plugins: true,
    citizen: true,
    settings: true,
    config: true
  })
  let duplicating = $state(false)
  let error = $state<string | null>(null)

  const parts: { key: keyof DuplicateOptions; label: string; hint: string }[] = [
    { key: 'mods', label: 'Mods', hint: 'Everything in the mods folder.' },
    { key: 'plugins', label: 'Plugins', hint: 'Everything in the plugins folder.' },
    { key: 'citizen', label: 'Citizen', hint: 'The citizen folder (advanced).' },
    {
      key: 'settings',
      label: 'Settings files',
      hint: 'GTA graphics settings and CitizenFX.ini.'
    },
    {
      key: 'config',
      label: 'Launch & linking options',
      hint: 'Linking toggles, plugins mode, and pure mode.'
    }
  ]

  // Reset each time the dialog opens.
  $effect(() => {
    if (open) {
      name = client ? `${client.name} (copy)` : ''
      options = { mods: true, plugins: true, citizen: true, settings: true, config: true }
      error = null
      duplicating = false
    }
  })

  async function duplicate(): Promise<void> {
    if (!client || duplicating) return
    const trimmed = name.trim()
    if (!trimmed) return
    duplicating = true
    error = null
    try {
      const created = await api.duplicateClient(client.id, trimmed, options)
      onDuplicated?.(created)
      open = false
    } catch (e) {
      error = String(e)
    } finally {
      duplicating = false
    }
  }
</script>

<Modal
  bind:open
  title="Duplicate client"
  description={client ? `Make a copy of "${client.name}". Pick what comes along.` : ''}
  icon="copy"
  size="md"
>
  <div class="space-y-5">
    <div class="space-y-1.5">
      <label
        for="duplicate-client-name"
        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        New client name
      </label>
      <Input
        id="duplicate-client-name"
        bind:value={name}
        placeholder="e.g. Main RP (copy)"
        autofocus
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && duplicate()}
      />
    </div>

    <div class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        What to duplicate
      </p>
      <div class="divide-y divide-divider overflow-hidden rounded-lg bg-surface-2/50">
        {#each parts as part (part.key)}
          <button
            type="button"
            role="checkbox"
            aria-checked={options[part.key]}
            class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-3/60"
            onclick={() => (options = { ...options, [part.key]: !options[part.key] })}
          >
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors
                {options[part.key]
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-surface-2'}"
            >
              {#if options[part.key]}<Icon name="check" size={13} stroke={3} />{/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{part.label}</span>
              <span class="block text-xs text-muted-foreground">{part.hint}</span>
            </span>
          </button>
        {/each}
      </div>
      <p class="text-xs text-muted-foreground">
        Anything left unchecked starts empty (or with defaults) in the copy.
      </p>
    </div>

    {#if error}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button
      variant="primary"
      icon="copy"
      disabled={!name.trim()}
      loading={duplicating}
      onclick={duplicate}
    >
      Duplicate client
    </Button>
  {/snippet}
</Modal>
